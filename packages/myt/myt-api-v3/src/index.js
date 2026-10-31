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
/**
 * 从镜像名解析安卓版本（旧 `parse_android_version`）。
 *
 * 例：`Q16_xxx` → 16，`Q14_xxx` → 14；无匹配返回 null。
 */
export function parseAndroidVersion(image) {
    const matched = /Q(\d+)/.exec(image ?? '');
    return matched ? Number(matched[1]) : null;
}
/** 从 portBindings 取宿主机端口（旧 `_get_host_port`）。 */
function hostPortOf(bindings, spec) {
    const list = bindings?.[spec];
    return list?.[0]?.HostPort ?? '';
}
/** v3 默认端口。 */
export const V3_DEFAULT_PORT = 8000;
/**
 * v3 客户端。
 *
 * 所有方法在 HTTP 非 2xx 时抛错（对齐旧 `resp.raise_for_status()`）；
 * 业务错误（`code !== 0`）由调用方按 `code` 判断。
 */
export class MytApiV3 extends Service {
    defaultPort;
    timeoutMs;
    constructor(ctx, config = {}) {
        super(ctx, 'mytHostV3');
        this.defaultPort = config.port ?? V3_DEFAULT_PORT;
        this.timeoutMs = config.timeoutMs ?? 30_000;
    }
    baseUrl(host) {
        return `http://${host}:${this.defaultPort}`;
    }
    /** GET，返回原始信封（`{code, message, data}`）。 */
    async getEnvelope(host, path, params = {}, timeoutMs) {
        const url = new URL(`${this.baseUrl(host)}${path}`);
        for (const [key, value] of Object.entries(params))
            url.searchParams.set(key, value);
        const res = await fetch(url.toString(), {
            signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
        });
        if (!res.ok)
            throw new Error(`v3 HTTP ${res.status} ${url.pathname}`);
        return (await res.json());
    }
    /** POST JSON，返回原始信封。 */
    async postEnvelope(host, path, body, timeoutMs) {
        const res = await fetch(`${this.baseUrl(host)}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
        });
        if (!res.ok)
            throw new Error(`v3 HTTP ${res.status} ${path}`);
        return (await res.json());
    }
    /**
     * 云机列表（旧 `get_android_list`）。
     *
     * @param filter.name 按名称过滤
     * @param filter.running `true` 只查运行中 / `false` 只查已停止
     * @param filter.indexNum 按实例位序号过滤
     */
    async listAndroids(host, filter = {}, timeoutMs) {
        const params = {};
        if (filter.name)
            params['name'] = filter.name;
        if (filter.running !== undefined)
            params['running'] = String(filter.running);
        if (filter.indexNum !== undefined)
            params['indexNum'] = String(filter.indexNum);
        const body = await this.getEnvelope(host, '/android', params, timeoutMs);
        if (body.code !== 0)
            return [];
        return body.data?.list ?? [];
    }
    /** 只返回运行中的云机（旧 `get_running_android`）。 */
    async listRunningAndroids(host, timeoutMs) {
        return this.listAndroids(host, { running: true }, timeoutMs);
    }
    /** 启动云机（旧 `start_android`）；返回 `code === 0`。 */
    async startAndroid(host, name, timeoutMs) {
        const body = await this.postEnvelope(host, '/android/start', { name }, timeoutMs);
        return body.code === 0;
    }
    /** 关闭云机（旧 `stop_android`）；返回 `code === 0`。 */
    async stopAndroid(host, name, timeoutMs) {
        const body = await this.postEnvelope(host, '/android/stop', { name }, timeoutMs);
        return body.code === 0;
    }
    /**
     * 宿主信息聚合（旧 `get_host_info`）。
     *
     * 一次请求拿到 ADB 地址、容器列表、地址到名称映射——
     * 旧版用它替代 v2 需要多次调用的开销。
     */
    async hostInfo(host, timeoutMs) {
        const list = await this.listAndroids(host, {}, timeoutMs);
        const adbAddrs = [];
        const containers = [];
        const nameMap = {};
        for (const item of list) {
            const bindings = item.portBindings ?? {};
            // v3 的 ADB 端口在 `5555/tcp` 的 HostPort（v2 是直接给 adb 字段）。
            const adbPort = hostPortOf(bindings, '5555/tcp');
            const apiPort = hostPortOf(bindings, '9082/tcp');
            const addr = adbPort ? `${host}:${adbPort}` : '';
            containers.push({
                addr,
                index: item.indexNum ?? null,
                name: item.name ?? '',
                state: item.status ?? '',
                apiPort,
                sdkType: item.androidType ?? '',
                androidType: parseAndroidVersion(item.image ?? ''),
            });
            if (item.status === 'running' && adbPort) {
                adbAddrs.push(addr);
                nameMap[addr] = item.name ?? '';
            }
        }
        // 旧版排序：容器按 (index, addr)，地址按字典序。
        containers.sort((a, b) => (a.index ?? 0) - (b.index ?? 0) || a.addr.localeCompare(b.addr));
        adbAddrs.sort();
        return { adbAddrs, containers, nameMap };
    }
    /** ADB 地址列表（旧 `get_adb_addrs`）。 */
    async adbAddrs(host, onlyRunning = true, timeoutMs) {
        const list = await this.listAndroids(host, {}, timeoutMs);
        const result = [];
        for (const item of list) {
            if (onlyRunning && item.status !== 'running')
                continue;
            const port = hostPortOf(item.portBindings ?? {}, '5555/tcp');
            if (!port)
                continue;
            result.push(`${host}:${port}`);
        }
        return result;
    }
    /** 线上机型列表（旧 `get_phone_model_list`）。`data.list` 每项含 `id` 与 `android_version`。 */
    async phoneModelList(host, timeoutMs) {
        const body = await this.getEnvelope(host, '/android/phoneModel', {}, timeoutMs);
        if (body.code !== 0)
            return [];
        return body.data?.list ?? [];
    }
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
    async switchModel(host, options) {
        const body = { name: options.name };
        if (options.modelId !== undefined)
            body['modelId'] = options.modelId;
        if (options.localModel !== undefined)
            body['localModel'] = options.localModel;
        if (options.modelStatic !== undefined)
            body['modelStatic'] = options.modelStatic;
        if (options.latitude !== undefined)
            body['latitude'] = options.latitude;
        if (options.longitude !== undefined)
            body['longitude'] = options.longitude;
        if (options.countryCode !== undefined)
            body['countryCode'] = options.countryCode;
        const result = await this.postEnvelope(host, '/android/switchModel', body, options.timeoutMs);
        return result.code === 0;
    }
    /**
     * 随机换机型（旧 `random_switch_model`）。
     *
     * 旧实现：拉机型列表 → 按 `android_version` 精确过滤 → 随机选一个 → `switchModel` →
     * **固定 `sleep(20)`**。这里把 sleep 交给调用方（用 `waitForStableAdb` 更可靠）。
     *
     * @returns `{ ok, model }`；无匹配机型时 `ok=false`
     */
    async randomSwitchModel(host, name, androidVersion, timeoutMs) {
        const models = await this.phoneModelList(host, timeoutMs);
        const wanted = String(androidVersion);
        const matched = models.filter((m) => String(m['android_version'] ?? '') === wanted);
        if (matched.length === 0)
            return { ok: false, model: null };
        const picked = matched[Math.floor(Math.random() * matched.length)];
        const modelId = picked['id'];
        if (modelId === undefined)
            return { ok: false, model: picked };
        const ok = await this.switchModel(host, {
            name,
            modelId: modelId,
            timeoutMs,
        });
        return { ok, model: picked };
    }
}
/** Cordis Loader 按包名导入时要求默认导出。 */
export default MytApiV3;
//# sourceMappingURL=index.js.map