import { Service } from '@deepseek-ai/cordis'
// 引入各 Service 的模块增强，让 `ctx.xxx` 有类型
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@myt/devices'
import type {} from '@myt/flow'
import type {} from '@myt/myt-host'

/**
 * 系统类 HTTP 接口。
 *
 * 只提供「平台自身」的信息，不认识任何业务：
 * 健康检查、宿主列表、容器列表、流程注册表、数据目录。
 *
 * 一切都通过 `ctx.*` 拿：宿主地址来自配置，设备与流程来自各自的 Service。
 */

/** 插件配置。 */
export interface SystemApiConfig {
  /** 宿主 IP 列表（来自启动参数 / 环境变量）。 */
  hosts?: readonly string[]
  /** 数据目录（用于「是否在系统盘」提示）。 */
  dataDir?: string
}

/** 单个宿主的概要。 */
interface HostSummary {
  ip: string
  online: boolean
  version?: string
  devCode?: string
  cpu?: number
  memPercent?: number
  diskPercent?: number
  containerCount?: number
  runningCount?: number
  slotCount?: number
  error?: string
}

export class SystemApi extends Service {
  /** 依赖：宿主 SDK、设备注册表、流程注册表、Web 服务。 */
  static inject = ['mytHost', 'devices', 'flows', 'webServer']

  private readonly config: SystemApiConfig

  constructor(ctx: ConstructorParameters<typeof Service>[0], config: SystemApiConfig = {}) {
    super(ctx, 'systemApi')
    this.config = config
  }

  [Service.init](): void {
    const server = this.ctx.webServer
    // 宿主列表优先取配置，其次读环境变量（壳通过 MYT_HOSTS 传入，逗号分隔）。
    const hosts = this.config.hosts ?? (process.env['MYT_HOSTS'] ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0)

    server.register({
      kind: 'exact',
      path: '/api/health',
      handler: (_req, res) => sendJson(res, 200, { ok: true, hosts }),
    })

    server.register({
      kind: 'exact',
      path: '/api/data-dir',
      handler: (_req, res) => {
        const dir = this.config.dataDir ?? ''
        sendJson(res, 200, {
          dir,
          onSystemDrive: process.platform === 'win32' && /^c:/iu.test(dir),
        })
      },
    })

    server.register({
      kind: 'exact',
      path: '/api/hosts',
      handler: (_req, res) => {
        void Promise.all(hosts.map((ip) => this.summarize(ip))).then(
          (rows) => sendJson(res, 200, rows),
          (error: unknown) => sendJson(res, 502, { error: String(error) }),
        )
      },
    })

    server.register({
      kind: 'exact',
      path: '/api/containers',
      handler: (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const host = url.searchParams.get('host') ?? hosts[0]
        if (!host) {
          sendJson(res, 400, { error: '缺少 host 参数' })
          return
        }
        void (async () => {
          const containers = await this.ctx.mytHost.listContainers(host)
          const devices = await this.ctx.devices.reconcile(host, containers)
          sendJson(res, 200, { host, containers, devices })
        })().catch((error: unknown) => sendJson(res, 502, { error: String(error) }))
      },
    })

    server.register({
      kind: 'exact',
      path: '/api/flows',
      handler: (_req, res) => sendJson(res, 200, this.ctx.flows.list()),
    })
  }

  /** 汇总一个宿主的状态；不可达时返回 `online: false`。 */
  private async summarize(ip: string): Promise<HostSummary> {
    try {
      const [version, system, containers] = await Promise.all([
        this.ctx.mytHost.hostVersion(ip),
        this.ctx.mytHost.systemInfo(ip),
        this.ctx.mytHost.listContainers(ip),
      ])
      const slotCount = containers.reduce((max, item) => Math.max(max, item.slotIndex), 0)
      return {
        ip,
        online: true,
        version,
        devCode: system.devCode,
        cpu: system.cpu,
        memPercent: system.memPercent,
        diskPercent: system.diskPercent,
        containerCount: containers.length,
        runningCount: containers.filter((item) => item.state === 'running').length,
        slotCount,
      }
    } catch (error) {
      return { ip, online: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

function sendJson(res: { writableEnded: boolean; writeHead: (s: number, h: Record<string, string>) => void; end: (b: string) => void }, status: number, body: unknown): void {
  if (res.writableEnded) return
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    systemApi: SystemApi
  }
}

export default SystemApi
