import { Service } from '@deepseek-ai/cordis';
/**
 * 流程图持久化。
 *
 * 磁盘布局：一个流程一个 JSON 文件，**文件名就是用户可见的流程名**。
 * 身份标识是文件内容里的 `id`（uuid），不是文件名——
 * 用户可以在资源管理器里随意重命名文件，`id` 不变，历史记录仍然连着。
 *
 * ```
 * <dir>/
 * ├── 小红书发布图文.json   { id: "a3f8c21e-…", nodes, edges, globalVariable }
 * ├── 小红书发布视频.json   { id: "b7c2d94f-…", … }
 * └── 登录后养号.json
 * ```
 *
 * 为什么文件名不用 uuid：用户在资源管理器里看到 `a3f8c21e-9b4d-…json` 完全无法分辨。
 * 为什么身份不用文件名：用户改个名流程就"消失"了，那是把实现细节暴露给用户。
 */
/** 流程摘要（列表页用，不含节点数据）。 */
export interface WorkflowSummary {
    /** 流程身份（uuid，存在文件内容里）。 */
    id: string;
    /** 用户可见的名字（去掉 `.json` 的文件名）。 */
    name: string;
    /** 文件名（含 `.json`）。 */
    fileName: string;
    /** 节点数。 */
    nodeCount: number;
    /** 最后修改时间（毫秒）。 */
    updatedAt: number;
}
/** 完整的流程文档（画布 JSON）。 */
export interface WorkflowDocument {
    /** 流程身份。读盘时若缺失会自动补一个。 */
    id: string;
    /** 画布节点。 */
    nodes: readonly unknown[];
    /** 画布连线。 */
    edges: readonly unknown[];
    /** 业务配置（app / maxSteps 等）。 */
    [key: string]: unknown;
}
export interface WorkflowsConfig {
    /** 流程目录；缺省时只驻内存（测试用）。 */
    dir?: string;
}
/** 把用户输入的名字净化成合法文件名。 */
export declare function sanitizeName(raw: string): string;
/**
 * 流程图存储。
 *
 * 设计要点：
 * - **文件名 = 流程名**，`id` 在内容里 —— 用户可在资源管理器里直接改名/复制/删除
 * - 复制文件会产生重复 `id`，`list()` 时自动给后者重新分配（并写回）
 * - 单个文件损坏不影响其它流程，列表里标记为不可读
 */
export declare class WorkflowStore extends Service {
    private readonly dir;
    /** 内存缓存：fileName → 文档。`dir` 为空时作为唯一存储。 */
    private readonly cache;
    private loaded;
    constructor(ctx: ConstructorParameters<typeof Service>[0], config?: WorkflowsConfig);
    /**
     * 列出全部流程（按修改时间倒序）。
     *
     * 会顺带修复两类问题：缺 `id` 的文件补 id；重复 `id` 的后出现者重新分配。
     */
    list(): Promise<WorkflowSummary[]>;
    /** 读一个流程；不存在返回 `undefined`。 */
    load(fileName: string): Promise<WorkflowDocument | undefined>;
    /** 按 id 找流程（前端路由用 id 时）。 */
    loadById(id: string): Promise<WorkflowDocument | undefined>;
    /**
     * 保存流程。
     *
     * `fileName` 可以是用户给的名字（不含扩展名），会被净化成合法文件名。
     * 返回实际使用的文件名（可能与传入不同，例如带非法字符时）。
     */
    save(fileName: string, doc: WorkflowDocument): Promise<string>;
    /** 新建一张空白流程（只有 start + end）。 */
    create(name: string): Promise<{
        fileName: string;
        doc: WorkflowDocument;
    }>;
    /**
     * 重命名：改磁盘文件名，`id` 不变。
     *
     * 目标名已存在时自动加序号（`名字 (2)`），不覆盖。
     */
    rename(fileName: string, newName: string): Promise<string>;
    /** 复制流程：内容照抄，`id` 换新。 */
    duplicate(fileName: string): Promise<string>;
    /** 删除流程。 */
    remove(fileName: string): Promise<boolean>;
    /** 首次访问时扫目录进内存。 */
    private ensureLoaded;
    /** 原子写：先写 `.tmp` 再 rename，避免写一半断电留下残文件。 */
    private persist;
    /** 文件修改时间；内存模式下用当前时间。 */
    private modifiedAt;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        workflows: WorkflowStore;
    }
}
//# sourceMappingURL=index.d.ts.map