import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Service } from '@deepseek-ai/cordis';
/** 文件名里不允许的字符（Windows 最严格，按它来）。 */
const ILLEGAL = /[\\/:*?"<>|]/g;
/** 把用户输入的名字净化成合法文件名。 */
export function sanitizeName(raw) {
    const cleaned = raw.replace(ILLEGAL, '_').trim();
    return cleaned.length === 0 ? '未命名流程' : cleaned.slice(0, 100);
}
/**
 * 流程图存储。
 *
 * 设计要点：
 * - **文件名 = 流程名**，`id` 在内容里 —— 用户可在资源管理器里直接改名/复制/删除
 * - 复制文件会产生重复 `id`，`list()` 时自动给后者重新分配（并写回）
 * - 单个文件损坏不影响其它流程，列表里标记为不可读
 */
export class WorkflowStore extends Service {
    dir;
    /** 内存缓存：fileName → 文档。`dir` 为空时作为唯一存储。 */
    cache = new Map();
    loaded = false;
    constructor(ctx, config = {}) {
        super(ctx, 'workflows');
        this.dir = config.dir;
    }
    /**
     * 列出全部流程（按修改时间倒序）。
     *
     * 会顺带修复两类问题：缺 `id` 的文件补 id；重复 `id` 的后出现者重新分配。
     */
    async list() {
        await this.ensureLoaded();
        const seen = new Set();
        const summaries = [];
        for (const [fileName, doc] of this.cache) {
            // 重复 id（用户复制了文件）→ 重新分配并写回
            if (seen.has(doc.id)) {
                doc.id = randomId();
                await this.persist(fileName, doc);
            }
            seen.add(doc.id);
            summaries.push({
                id: doc.id,
                name: fileName.replace(/\.json$/u, ''),
                fileName,
                nodeCount: Array.isArray(doc.nodes) ? doc.nodes.length : 0,
                updatedAt: await this.modifiedAt(fileName),
            });
        }
        return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    /** 读一个流程；不存在返回 `undefined`。 */
    async load(fileName) {
        await this.ensureLoaded();
        const key = withJson(fileName);
        return this.cache.get(key);
    }
    /** 按 id 找流程（前端路由用 id 时）。 */
    async loadById(id) {
        await this.ensureLoaded();
        return [...this.cache.values()].find((doc) => doc.id === id);
    }
    /**
     * 保存流程。
     *
     * `fileName` 可以是用户给的名字（不含扩展名），会被净化成合法文件名。
     * 返回实际使用的文件名（可能与传入不同，例如带非法字符时）。
     */
    async save(fileName, doc) {
        await this.ensureLoaded();
        const key = withJson(sanitizeName(fileName.replace(/\.json$/u, '')));
        const normalized = {
            ...doc,
            id: typeof doc.id === 'string' && doc.id.length > 0 ? doc.id : randomId(),
        };
        this.cache.set(key, normalized);
        await this.persist(key, normalized);
        return key;
    }
    /** 新建一张空白流程（只有 start + end）。 */
    async create(name) {
        const doc = {
            id: randomId(),
            nodes: [
                { id: 'start', type: 'start', meta: { position: { x: 400, y: 100 } }, data: { title: '开始' } },
                { id: 'end', type: 'end', meta: { position: { x: 400, y: 400 } }, data: { title: '结束' } },
            ],
            edges: [{ sourceNodeID: 'start', sourcePortID: 'out', targetNodeID: 'end' }],
        };
        const fileName = await this.save(name, doc);
        return { fileName, doc };
    }
    /**
     * 重命名：改磁盘文件名，`id` 不变。
     *
     * 目标名已存在时自动加序号（`名字 (2)`），不覆盖。
     */
    async rename(fileName, newName) {
        await this.ensureLoaded();
        const from = withJson(fileName);
        const doc = this.cache.get(from);
        if (!doc)
            throw new Error(`流程不存在：${fileName}`);
        const base = sanitizeName(newName.replace(/\.json$/u, ''));
        let target = withJson(base);
        let seq = 2;
        while (this.cache.has(target) && target !== from) {
            target = withJson(`${base} (${seq})`);
            seq += 1;
        }
        this.cache.delete(from);
        this.cache.set(target, doc);
        if (this.dir) {
            await mkdir(this.dir, { recursive: true });
            await rename(join(this.dir, from), join(this.dir, target));
        }
        return target;
    }
    /** 复制流程：内容照抄，`id` 换新。 */
    async duplicate(fileName) {
        await this.ensureLoaded();
        const doc = this.cache.get(withJson(fileName));
        if (!doc)
            throw new Error(`流程不存在：${fileName}`);
        const base = fileName.replace(/\.json$/u, '');
        let target = withJson(`${base} 副本`);
        let seq = 2;
        while (this.cache.has(target)) {
            target = withJson(`${base} 副本 (${seq})`);
            seq += 1;
        }
        const copy = { ...structuredClone(doc), id: randomId() };
        this.cache.set(target, copy);
        await this.persist(target, copy);
        return target;
    }
    /** 删除流程。 */
    async remove(fileName) {
        await this.ensureLoaded();
        const key = withJson(fileName);
        if (!this.cache.delete(key))
            return false;
        if (this.dir)
            await rm(join(this.dir, key), { force: true });
        return true;
    }
    // ── 内部 ──
    /** 首次访问时扫目录进内存。 */
    async ensureLoaded() {
        if (this.loaded || !this.dir) {
            this.loaded = true;
            return;
        }
        this.loaded = true;
        let entries;
        try {
            entries = await readdir(this.dir);
        }
        catch {
            return; // 目录不存在 = 空库
        }
        for (const fileName of entries) {
            if (!fileName.endsWith('.json'))
                continue;
            try {
                const raw = await readFile(join(this.dir, fileName), 'utf8');
                const parsed = JSON.parse(raw);
                const doc = {
                    ...parsed,
                    id: typeof parsed['id'] === 'string' && parsed['id'].length > 0 ? parsed['id'] : randomId(),
                    nodes: Array.isArray(parsed['nodes']) ? parsed['nodes'] : [],
                    edges: Array.isArray(parsed['edges']) ? parsed['edges'] : [],
                };
                this.cache.set(fileName, doc);
            }
            catch {
                // 单个文件损坏不影响其它流程
            }
        }
    }
    /** 原子写：先写 `.tmp` 再 rename，避免写一半断电留下残文件。 */
    async persist(fileName, doc) {
        if (!this.dir)
            return;
        const target = join(this.dir, fileName);
        await mkdir(dirname(target), { recursive: true });
        const tmp = `${target}.tmp`;
        await writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8');
        await rename(tmp, target);
    }
    /** 文件修改时间；内存模式下用当前时间。 */
    async modifiedAt(fileName) {
        if (!this.dir)
            return Date.now();
        try {
            const { stat } = await import('node:fs/promises');
            return (await stat(join(this.dir, fileName))).mtimeMs;
        }
        catch {
            return 0;
        }
    }
}
/** 补 `.json` 扩展名（幂等）。 */
function withJson(name) {
    return name.endsWith('.json') ? name : `${name}.json`;
}
/** 生成流程 id。 */
function randomId() {
    return crypto.randomUUID();
}
//# sourceMappingURL=index.js.map