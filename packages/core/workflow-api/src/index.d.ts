import { Service } from '@deepseek-ai/cordis';
/**
 * 流程图 HTTP 接口。
 *
 * **这是「插件自己挂路由」的范例**：内核不认识 `/api/workflows`，
 * 路径、方法、错误码全部在这里声明。
 *
 * 路由优先级由注册顺序决定：精确路由（`/rename`、`/duplicate`）
 * 必须在前缀路由（`/:file`）之前注册。
 */
export declare class WorkflowApi extends Service {
    /** 依赖：流程存储 + HTTP 路由服务。缺任何一个都无法注册路由。 */
    static inject: string[];
    constructor(ctx: ConstructorParameters<typeof Service>[0]);
    /** 服务激活时注册路由（Cordis 生命周期）。 */
    [Service.init](): void;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        workflowApi: WorkflowApi;
    }
}
//# sourceMappingURL=index.d.ts.map