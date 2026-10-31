import { Service } from '@deepseek-ai/cordis';
import { HttpError } from '@myt/webserver';
/**
 * 流程图 HTTP 接口。
 *
 * **这是「插件自己挂路由」的范例**：内核不认识 `/api/workflows`，
 * 路径、方法、错误码全部在这里声明。
 *
 * 路由优先级由注册顺序决定：精确路由（`/rename`、`/duplicate`）
 * 必须在前缀路由（`/:file`）之前注册。
 */
export class WorkflowApi extends Service {
    /** 依赖：流程存储 + HTTP 路由服务。缺任何一个都无法注册路由。 */
    static inject = ['workflows', 'http'];
    constructor(ctx) {
        super(ctx, 'workflowApi');
    }
    /** 服务激活时注册路由（Cordis 生命周期）。 */
    [Service.init]() {
        const store = this.ctx.workflows;
        // ── 精确路由（必须先于前缀路由）──
        this.ctx.http.get('/api/workflows', () => store.list());
        this.ctx.http.post('/api/workflows', async (context) => {
            const name = String(context.body['name'] ?? '').trim() || '未命名流程';
            const created = await store.create(name);
            return { fileName: created.fileName, id: created.doc.id };
        });
        this.ctx.http.post('/api/workflows/rename', async (context) => {
            const fileName = String(context.body['fileName'] ?? '');
            const name = String(context.body['name'] ?? '');
            try {
                return { fileName: await store.rename(fileName, name) };
            }
            catch (error) {
                throw new HttpError(404, error instanceof Error ? error.message : String(error));
            }
        });
        this.ctx.http.post('/api/workflows/duplicate', async (context) => {
            try {
                return { fileName: await store.duplicate(String(context.body['fileName'] ?? '')) };
            }
            catch (error) {
                throw new HttpError(404, error instanceof Error ? error.message : String(error));
            }
        });
        // ── 前缀路由 ──
        this.ctx.http.prefix('GET', '/api/workflows/:file', async (context) => {
            const doc = await store.load(context.params['file']);
            if (!doc)
                throw new HttpError(404, `流程不存在：${context.params['file']}`);
            return doc;
        });
        this.ctx.http.prefix('PUT', '/api/workflows/:file', async (context) => {
            const fileName = context.params['file'];
            // body 就是完整画布 JSON（nodes + edges + globalVariable）
            return { fileName: await store.save(fileName, context.body) };
        });
        this.ctx.http.prefix('DELETE', '/api/workflows/:file', async (context) => ({
            removed: await store.remove(context.params['file']),
        }));
    }
}
//# sourceMappingURL=index.js.map