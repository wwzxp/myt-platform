import type { Context } from '@deepseek-ai/cordis'
import {
  MytHost,
  type ContainerInfo,
  type ContainerState,
  type HostSystemInfo,
} from '@myt/myt-host'

export interface MytApiV2Config {
  /** SDK 网关基址；旧项目里 7878 是本机转发到宿主的入口。 */
  baseUrl?: string
  timeoutMs?: number
}

interface Envelope<T> {
  code: number
  data: T
  message?: string | undefined
}

interface RawContainer {
  id?: string
  short_id?: string
  name?: string
  index?: number
  adb?: number
  ip?: string
  state?: string
  status?: string
  image?: string
}

/** 把 SDK 的 state 收敛到平台枚举；未知值保留原始串在 rawState。 */
function normalizeState(raw: string | undefined): ContainerState {
  if (raw === 'running' || raw === 'created' || raw === 'exited') return raw
  return 'unknown'
}

/**
 * 魔云腾 v2 SDK（`/dc_api/v1/*`，默认 7878）的宿主能力实现。
 *
 * 只做协议适配与字段收敛，不含业务判断；响应结构缺失时显式降级而非猜测。
 */
export class MytApiV2 extends MytHost {
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(ctx: Context, config: MytApiV2Config = {}) {
    super(ctx)
    this.baseUrl = (config.baseUrl ?? 'http://127.0.0.1:7878').replace(/\/+$/, '')
    this.timeoutMs = config.timeoutMs ?? 8000
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) })
    if (!res.ok) {
      throw new Error(`SDK HTTP ${res.status} ${url}`)
    }
    const body = (await res.json()) as Envelope<T>
    if (body.code !== 200) {
      throw new Error(`SDK code=${body.code} message=${body.message ?? ''} ${url}`)
    }
    return body.data
  }

  async listContainers(hostIp: string): Promise<ContainerInfo[]> {
    const rows = await this.get<RawContainer[]>(`/dc_api/v1/get/${hostIp}`)
    return rows.map((row) => ({
      externalId: row.id ?? '',
      name: row.name ?? '',
      slotIndex: row.index ?? 0,
      adbPort: row.adb ?? null,
      hostIp: row.ip ?? hostIp,
      state: normalizeState(row.state),
      rawState: row.state ?? '',
      status: row.status ?? '',
      image: row.image ?? '',
    }))
  }

  async hostVersion(hostIp: string): Promise<string> {
    return this.get<string>(`/dc_api/v1/get_host_ver/${hostIp}`)
  }

  async systemInfo(hostIp: string): Promise<HostSystemInfo> {
    // SDK 实测字段是 snake_case（disk_percent / mem_percent / mem_total / disk_total），
    // 文档未声明 schema；这里同时兼容 camelCase，避免版本差异导致静默归零。
    const raw = await this.get<Record<string, unknown>>(`/host_api/v1/get_systeminfo/${hostIp}`)
    const num = (snake: string, camel: string): number => {
      const value = raw[snake] ?? raw[camel]
      return typeof value === 'number' ? value : 0
    }
    return {
      cpu: num('cpu', 'cpu'),
      memTotal: num('mem_total', 'memTotal'),
      memPercent: num('mem_percent', 'memPercent'),
      diskTotal: num('disk_total', 'diskTotal'),
      diskPercent: num('disk_percent', 'diskPercent'),
      devCode: String(raw['devCode'] ?? raw['dev_code'] ?? ''),
    }
  }

  async startContainer(hostIp: string, name: string, options: { force?: boolean } = {}): Promise<void> {
    // 变更类接口：只调用一次，禁止自动重试（重放会抢占别人正在跑的容器）。
    const query = options.force ? '?force=1' : ''
    await this.get<unknown>(`/dc_api/v1/run/${hostIp}/${encodeURIComponent(name)}${query}`)
  }

  async stopContainer(hostIp: string, name: string): Promise<void> {
    await this.get<unknown>(`/dc_api/v1/stop/${hostIp}/${encodeURIComponent(name)}`)
  }

  /**
   * 设置 S5 代理（旧 `tools/myt_api.py:set_s5_proxy`）。
   *
   * 注意：这条**不走 SDK 网关**，直连容器自身的 `/proxy` 端点。
   * 响应是 JSON（非 SDK 信封），`code` 为 0 或 200 视为成功。
   */
  async setS5Proxy(options: {
    deviceIp: string
    apiPort: number
    proxyIp: string
    proxyPort: number
    username: string
    password: string
    proxyType?: 1 | 2
    timeoutMs?: number
  }): Promise<boolean> {
    const params = new URLSearchParams({
      cmd: '2',
      ip: options.proxyIp,
      port: String(options.proxyPort),
      usr: options.username,
      pwd: options.password,
    })
    if (options.proxyType !== undefined) params.set('type', String(options.proxyType))
    const url = `http://${options.deviceIp}:${options.apiPort}/proxy?${params.toString()}`
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 30_000) })
      if (!res.ok) return false
      const body = (await res.json()) as { code?: number }
      return body.code === 0 || body.code === 200
    } catch {
      // 容器内网不可达或超时：返回 false 由调用方决定是否终止链。
      return false
    }
  }

  /**
   * 容器 API 端口信息（旧 `myt_sdk_v2.get_api_info`）。
   *
   * `GET /and_api/v1/get_api_info/{ip}/{name}`，`data` 里含
   * ADB / API / HOST_RPA / RPC 四组地址。
   */
  async getApiInfo(hostIp: string, name: string, _timeoutMs?: number): Promise<Record<string, string>> {
    const body = await this.getRaw<Record<string, string>>(
      `/and_api/v1/get_api_info/${hostIp}/${encodeURIComponent(name)}`,
    )
    if (body.code !== 200) return {}
    return body.data ?? {}
  }

  /**
   * 查询 S5 代理状态（旧 `query_s5_proxy`）。
   *
   * **直连容器** `GET http://{ip}:{apiPort}/proxy`，不经 SDK 网关。
   */
  async queryS5Proxy(options: {
    deviceIp: string
    apiPort: number
    timeoutMs?: number
  }): Promise<Record<string, unknown> | null> {
    const url = `http://${options.deviceIp}:${options.apiPort}/proxy`
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) })
      if (!res.ok) return null
      return (await res.json()) as Record<string, unknown>
    } catch {
      return null
    }
  }

  /**
   * 停止 S5 代理（旧 `stop_s5_proxy`）。
   *
   * `GET http://{ip}:{apiPort}/proxy?cmd=3`。
   */
  async stopS5Proxy(options: {
    deviceIp: string
    apiPort: number
    timeoutMs?: number
  }): Promise<boolean> {
    const url = `http://${options.deviceIp}:${options.apiPort}/proxy?cmd=3`
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) })
      if (!res.ok) return false
      const body = (await res.json()) as { code?: number }
      return body.code === 0 || body.code === 200
    } catch {
      return false
    }
  }

  /**
   * 设置设备语言与国家（旧 `set_device_language_country`）。
   *
   * `GET http://{ip}:{apiPort}/modifydev?cmd=13&language=&country=`。
   */
  async setDeviceLanguageCountry(options: {
    deviceIp: string
    apiPort: number
    language: string
    country: string
    timeoutMs?: number
  }): Promise<boolean> {
    const params = new URLSearchParams({
      cmd: '13',
      language: options.language,
      country: options.country,
    })
    const url = `http://${options.deviceIp}:${options.apiPort}/modifydev?${params.toString()}`
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) })
      if (!res.ok) return false
      const body = (await res.json()) as { code?: number }
      return body.code === 0 || body.code === 200
    } catch {
      return false
    }
  }

  /**
   * 机型列表（品牌 → 型号 → modelid）。SDK `/and_api/v1/get_devinfo`。
   *
   * 实测返回 15 品牌 / 291 机型，与本地 `devices.json` 完全一致，但**多了 modelid**——
   * 换机型必须用它，不能靠本地文件名。
   */
  async listDeviceModels(): Promise<Record<string, Record<string, number>>> {
    return this.get<Record<string, Record<string, number>>>('/and_api/v1/get_devinfo')
  }

  /**
   * 异步**随机**换机型（`random_devinfo_async2`，推荐用法）。
   *
   * 换机型会改 MAC 导致网络中断，同步版请求可能拿不到结果；
   * 异步版分两段：`act=request` 发起、`act=query` 轮询，不会阻塞。
   *
   * **实测结论（2026-10-24）：`modelid` 参数被忽略。**
   * 传 `modelid=54`（HUAWEI DVC-AN00）后实际换成 `SM-A705F`（samsung）。
   * 端点名里的 `random` 就说明它只做随机；要指定机型必须用 `setPhoneModel`
   * （即 `set_custom_devinfo`，且需 oem_data 预置数据）。
   *
   * 状态码（据 SDK 文档）：
   * | code | 含义 |
   * |---|---|
   * | 200 | 成功 |
   * | 202 | 新机失败 |
   * | 203 | 任务查询中（继续轮询） |
   * | 204 | 当前任务正在执行中（继续轮询） |
   * | 205 | 当前没有任务 |
   * | 206 | 任务超时失败 |
   * | 0/1/2/3/4/5 | 容器不存在 / 主机不通 / 未运行 / 随机失败 / 取 api 失败 / 参数错误 |
   *
   * @returns true 表示最终成功；false 表示失败或超时。
   */
  async resetDeviceInfoAsync(options: {
    hostIp: string
    name: string
    /** 总超时（毫秒），默认 180s——网络中断后恢复通常需要 20-60s。 */
    timeoutMs?: number
    /** 轮询间隔（毫秒），默认 3s。 */
    pollMs?: number
    /** 进度回调（便于写入运行事件）。 */
    onProgress?: (message: string) => void
  }): Promise<boolean> {
    const base = `/and_api/v1/random_devinfo_async2/${options.hostIp}/${encodeURIComponent(options.name)}`
    const pollMs = options.pollMs ?? 3000
    const deadline = Date.now() + (options.timeoutMs ?? 180_000)

    // 1) 发起
    try {
      // 不传 modelid：实测该参数会被忽略，传了反而误导。
      await this.get<unknown>(`${base}/request`)
    } catch {
      return false
    }
    options.onProgress?.('已发起换机型请求，等待结果...')

    // 2) 轮询
    let lastCode = 0
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollMs))
      let code: number
      try {
        const body = await this.getRaw<unknown>(`${base}/query`)
        code = body.code
      } catch {
        // 查询本身失败（网络中断）：继续轮询，网络恢复后能拿到。
        continue
      }
      lastCode = code
      if (code === 200) return true
      if (code === 202 || code === 206) {
        options.onProgress?.(`换机型失败（code=${code}）`)
        return false
      }
      if (code === 205) {
        // 实测时序：204×N → 200（成功）→ 205…（任务已清空）。
        // 若**首次**查询就是 205，说明 request 没被登记（容器名错 / 并发冲突），判失败。
        if (lastCode === 0) {
          options.onProgress?.('换机型失败：任务未登记（code=205）')
          return false
        }
        options.onProgress?.(`换机型失败：任务已消失（code=205）`)
        return false
      }
      if (code === 0 || code === 1 || code === 2 || code === 3 || code === 4 || code === 5) {
        options.onProgress?.(`换机型失败（code=${code}）`)
        return false
      }
      // 203 查询中 / 204 执行中 → 继续
      options.onProgress?.(`换机型进行中（code=${code}）`)
    }
    options.onProgress?.(`换机型超时（最后状态 ${lastCode}）`)
    return false
  }

  /**
   * 取原始信封（`{code, message, data}`），失败不抛。
   *
   * 异步查询接口在「任务进行中」时返回 `code=203/204`，需要读原始 code 才能区分。
   */
  private async getRaw<T>(path: string): Promise<{ code: number; message?: string | undefined; data?: T | undefined }> {
    const url = `${this.baseUrl}${path}`
    const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) })
    // 实测异步接口的信封是 `{code, error, message, data}`，比普通接口多一个 error 字段。
    const body = (await res.json()) as {
      code?: number
      error?: string | null
      message?: string | undefined
      data?: T | undefined
    }
    return { code: body.code ?? -1, message: body.message ?? body.error ?? undefined, data: body.data }
  }
}

/** Cordis Loader 按包名导入时要求默认导出。 */
export default MytApiV2
