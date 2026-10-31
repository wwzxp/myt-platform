/**
 * 魔云腾 v3 API 客户端（**1:1 移植** `tools/MYT_V3_SDK.py`，275 行）。
 *
 * 与 v2 的根本差异：
 *
 * | 项 | v2（7878） | v3（8000） |
 * |---|---|---|
 * | 端口 | 7878 | **8000** |
 * | 路径前缀 | `/dc_api/v1`、`/and_api/v1` | `/android` |
 * | 成功判据 | `code === 200` | **`code === 0`** |
 * | 换机型 | `set_custom_devinfo`（需 oem_data） | **`switchModel`（不需要）** |
 * | ADB 端口 | 直给 `adb` 字段 | 从 `portBindings["5555/tcp"][0].HostPort` 取 |
 * | API 端口 | `api_port` | 从 `portBindings["9082/tcp"]` 取 |
 *
 * 因为成功码不同（0 vs 200），两个客户端不能共用 `get()`；这里独立实现。
 */
import { Service } from '@deepseek-ai/cordis';
/** v3 的容器条目（`GET /android` 的 `data.list[]`）。 */
export interface V3Android {
    /** 云机名称（= 容器名）。 */
    name: string;
    /** 实例位序号（`indexNum`）。 */
    indexNum: number | null;
    /** 状态：`running` / `stopped` 等。 */
    status: string;
    /** 镜像名（含 `Q14`/`Q16` 这类安卓版本标记）。 */
    image: string;
    /** `androidType` 字段（v3 的 SDK 类型标记）。 */
    androidType: string;
    /** 原始 portBindings。 */
    portBindings: Record<string, Array<{
        HostPort?: string;
    }>>;
    /** 原始条目（字段名可能随版本变化）。 */
    raw: Record<string, unknown>;
}
/** 归一化后的容器视图（旧 `get_host_info()["containers"]`）。 */
export interface V3Container {
    /** `host:adbPort`；无 ADB 端口时为空串。 */
    addr: string;
    index: number | null;
    name: string;
    state: string;
    apiPort: string;
    sdkType: string;
    /** 从镜像名解析的安卓版本；解析不出为 null。 */
    androidType: number | null;
}
/** 宿主信息聚合（旧 `get_host_info`）。 */
export interface V3HostInfo {
    /** 运行中云机的 ADB 地址。 */
    adbAddrs: string[];
    /** 全部云机（按 index、addr 排序）。 */
    containers: V3Container[];
    /** 运行中地址 → 名称。 */
    nameMap: Record<string, string>;
}
/** 换机型参数（旧 `switch_phone_model`）。 */
export interface SwitchModelOptions {
    name: string;
    /** 线上机型 id。 */
    modelId?: string | number | undefined;
    /** 本地机型名称。 */
    localModel?: string | undefined;
    /** 本地静态机型名称。 */
    modelStatic?: string | undefined;
    latitude?: number | undefined;
    longitude?: number | undefined;
    countryCode?: string | undefined;
    timeoutMs?: number | undefined | undefined;
}
/**
 * 从镜像名解析安卓版本（旧 `parse_android_version`）。
 *
 * 例：`Q16_xxx` → 16，`Q14_xxx` → 14；无匹配返回 null。
 */
export declare function parseAndroidVersion(image: string): number | null;
/** v3 默认端口。 */
export declare const V3_DEFAULT_PORT = 8000;
/**
 * v3 客户端。
 *
 * 所有方法在 HTTP 非 2xx 时抛错（对齐旧 `resp.raise_for_status()`）；
 * 业务错误（`code !== 0`）由调用方按 `code` 判断。
 */
export declare class MytApiV3 extends Service {
    private readonly defaultPort;
    private readonly timeoutMs;
    constructor(ctx: ConstructorParameters<typeof Service>[0], config?: {
        port?: number;
        timeoutMs?: number | undefined;
    });
    private baseUrl;
    /** GET，返回原始信封（`{code, message, data}`）。 */
    private getEnvelope;
    /** POST JSON，返回原始信封。 */
    private postEnvelope;
    /**
     * 云机列表（旧 `get_android_list`）。
     *
     * @param filter.name 按名称过滤
     * @param filter.running `true` 只查运行中 / `false` 只查已停止
     * @param filter.indexNum 按实例位序号过滤
     */
    listAndroids(host: string, filter?: {
        name?: string;
        running?: boolean;
        indexNum?: number;
    }, timeoutMs?: number | undefined | undefined): Promise<V3Android[]>;
    /** 只返回运行中的云机（旧 `get_running_android`）。 */
    listRunningAndroids(host: string, timeoutMs?: number | undefined): Promise<V3Android[]>;
    /** 启动云机（旧 `start_android`）；返回 `code === 0`。 */
    startAndroid(host: string, name: string, timeoutMs?: number | undefined): Promise<boolean>;
    /** 关闭云机（旧 `stop_android`）；返回 `code === 0`。 */
    stopAndroid(host: string, name: string, timeoutMs?: number | undefined): Promise<boolean>;
    /**
     * 宿主信息聚合（旧 `get_host_info`）。
     *
     * 一次请求拿到 ADB 地址、容器列表、地址到名称映射——
     * 旧版用它替代 v2 需要多次调用的开销。
     */
    hostInfo(host: string, timeoutMs?: number | undefined): Promise<V3HostInfo>;
    /** ADB 地址列表（旧 `get_adb_addrs`）。 */
    adbAddrs(host: string, onlyRunning?: boolean, timeoutMs?: number | undefined): Promise<string[]>;
    /** 线上机型列表（旧 `get_phone_model_list`）。`data.list` 每项含 `id` 与 `android_version`。 */
    phoneModelList(host: string, timeoutMs?: number | undefined | undefined): Promise<Array<Record<string, unknown>>>;
    /**
     * 换机型（旧 `switch_phone_model`）。
     *
     * 三个参数互斥/可选，全部原样透传：
     * - `modelId`：线上机型 id
     * - `localModel`：本地机型名称
     * - `modelStatic`：本地静态机型名称
     *
     * **这条路不需要 oem_data**——这正是 v3 相对 v2 `set_custom_devinfo` 的关键优势。
     */
    switchModel(host: string, options: SwitchModelOptions): Promise<boolean>;
    /**
     * 随机换机型（旧 `random_switch_model`）。
     *
     * 旧实现：拉机型列表 → 按 `android_version` 精确过滤 → 随机选一个 → `switchModel` →
     * **固定 `sleep(20)`**。这里把 sleep 交给调用方（用 `waitForStableAdb` 更可靠）。
     *
     * @returns `{ ok, model }`；无匹配机型时 `ok=false`
     */
    randomSwitchModel(host: string, name: string, androidVersion: string, timeoutMs?: number | undefined | undefined): Promise<{
        ok: boolean;
        model: Record<string, unknown> | null;
    }>;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** 魔云腾 v3 宿主能力（8000 端口，`code === 0` 判成功）。 */
        mytHostV3: MytApiV3;
    }
}
/** Cordis Loader 按包名导入时要求默认导出。 */
export default MytApiV3;
//# sourceMappingURL=index.d.ts.map