import { Service } from '@deepseek-ai/cordis'

/** 容器运行状态（SDK 的 state 字段，见 ADR-0002 实测）。 */
export type ContainerState = 'created' | 'running' | 'exited' | 'unknown'

/** 一次容器观测。字段名按 CONTEXT.md 术语：容器不是设备。 */
export interface ContainerInfo {
  /** Docker 容器 id（64 hex），rename 不变、重建变化——用于匹配 DeviceId。 */
  externalId: string
  /** 容器名，可随 rename 变化。 */
  name: string
  /** 坑位号（SDK 的 index），ADB 端点 = host:5000+slotIndex。 */
  slotIndex: number
  /** 观测到的 ADB 端口；缺失时为 null。 */
  adbPort: number | null
  /** 宿主 IP（SDK 响应里的 ip 字段实测就是宿主 IP）。 */
  hostIp: string
  state: ContainerState
  /** 原始 state 字符串，便于排查未知值。 */
  rawState: string
  /** Docker 的 status 文本，如 "Exited (127) 4 months ago"。 */
  status: string
  image: string
}

/** 宿主系统信息（GET /host_api/v1/get_systeminfo）。 */
export interface HostSystemInfo {
  cpu: number
  memTotal: number
  memPercent: number
  diskTotal: number
  diskPercent: number
  devCode: string
}

/**
 * 宿主能力接缝的服务定义。
 *
 * 消费方（流程步骤、UI）只依赖本类，不依赖具体的 SDK 方言；
 * v2(7878) 与 v3(8000) 是不同 Provider（见 ADR-0001 D2）。
 */
export abstract class MytHost extends Service {
  constructor(ctx: ConstructorParameters<typeof Service>[0]) {
    super(ctx, 'mytHost')
  }

  /** 列出宿主下的全部容器（含未运行）。 */
  abstract listContainers(hostIp: string): Promise<ContainerInfo[]>

  /** 宿主固件版本。 */
  abstract hostVersion(hostIp: string): Promise<string>

  /** 宿主系统信息。 */
  abstract systemInfo(hostIp: string): Promise<HostSystemInfo>

  /**
   * 启动容器。
   *
   * `force` 会先停掉同坑位正在运行的容器 —— 属于破坏性操作，调用方必须先确认。
   * 变更类接口不自动重试；调用方应在失败后回查 `listContainers` 确认最终状态。
   */
  abstract startContainer(hostIp: string, name: string, options?: { force?: boolean }): Promise<void>

  /** 停止容器。同样是变更类接口，不自动重试。 */
  abstract stopContainer(hostIp: string, name: string): Promise<void>

  /**
   * 设置容器的 S5 代理（旧 `tools/myt_api.py:set_s5_proxy`）。
   *
   * 直连容器自身的 API 端口（`http://<containerIp>:<apiPort>/proxy?cmd=2&...`），
   * **不经过** SDK 网关。返回是否成功（响应 `code` 为 0 或 200）。
   */
  abstract setS5Proxy(options: {
    deviceIp: string
    apiPort: number
    proxyIp: string
    proxyPort: number
    username: string
    password: string
    /** 域名解析模式：1 本地、2 服务端；缺省不传。 */
    proxyType?: 1 | 2
    timeoutMs?: number
  }): Promise<boolean>

  /**
   * 容器 API 端口信息（旧 `myt_sdk_v2.get_api_info`）。
   *
   * 返回 `data` 里的 ADB / API / HOST_RPA / RPC 地址映射；容器未运行时为空对象。
   */
  abstract getApiInfo(hostIp: string, name: string, timeoutMs?: number): Promise<Record<string, string>>

  /** 查询 S5 代理状态（直连容器 `/proxy`，非 SDK）。 */
  abstract queryS5Proxy(options: {
    deviceIp: string
    apiPort: number
    timeoutMs?: number
  }): Promise<Record<string, unknown> | null>

  /** 停止 S5 代理（直连容器 `/proxy?cmd=3`）。 */
  abstract stopS5Proxy(options: {
    deviceIp: string
    apiPort: number
    timeoutMs?: number
  }): Promise<boolean>

  /** 设置设备语言与国家（直连容器 `/modifydev?cmd=13`）。 */
  abstract setDeviceLanguageCountry(options: {
    deviceIp: string
    apiPort: number
    language: string
    country: string
    timeoutMs?: number
  }): Promise<boolean>

  /**
   * 机型列表（品牌 → 型号 → modelid，SDK `/and_api/v1/get_devinfo`）。
   *
   * 实测 15 品牌 / 291 机型；与本地 `devices.json` 同源但**带 modelid**。
   */
  abstract listDeviceModels(): Promise<Record<string, Record<string, number>>>

  /**
   * 异步**随机**换机型（`random_devinfo_async2`，推荐）。
   *
   * 换机型会改 MAC 导致网络中断，同步版可能拿不到结果；异步版
   * `act=request` 发起 + `act=query` 轮询，不阻塞。
   *
   * **只做随机**：实测 `modelid` 参数会被忽略（传 54 → 实际换成别的机型）。
   * 要指定机型请用 `setPhoneModel`（`set_custom_devinfo`，需 oem_data 预置数据）。
   *
   * @returns true 成功；false 失败或超时
   */
  abstract resetDeviceInfoAsync(options: {
    hostIp: string
    name: string
    timeoutMs?: number
    pollMs?: number
    onProgress?: (message: string) => void
  }): Promise<boolean>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 魔云腾宿主能力（扫码、容器、机型、代理）。 */
    mytHost: MytHost
  }
}
