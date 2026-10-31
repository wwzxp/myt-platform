import type { IncomingMessage, ServerResponse } from 'node:http'
import { Service } from '@deepseek-ai/cordis'
// 引入各 Service 的模块增强，让 `ctx.xxx` 有类型
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@myt/myt-host'
import type {} from '@myt/devices'
import type {} from '@myt/device-adb'

/**
 * 设备类 HTTP 接口的配置。
 */
export interface DeviceApiConfig {
  /**
   * 默认宿主机 IP。
   *
   * 请求没带 `?host=` 时用它。本插件不猜宿主：多机环境下猜错会把
   * 操作打到另一台机器上，所以没配也没传就返回 400。
   */
  defaultHost?: string
}

/**
 * 设备类 HTTP 接口。
 *
 * 覆盖三组能力：
 * - 容器生命周期：`/api/actions/{start,stop}`（带等待状态校验）
 * - 设备清单：`/api/devices`
 * - 单机操作：`/api/device/{connect,dump,tap}`
 *
 * 不认识「登录」「发布」等业务，业务路由由各自的包提供。
 */
export class DeviceApi extends Service {
  /** 依赖：宿主 SDK、设备注册表、单机控制。 */
  static inject = ['webServer', 'mytHost', 'devices', 'deviceControl']

  private readonly defaultHost: string | undefined

  constructor(ctx: ConstructorParameters<typeof Service>[0], config: DeviceApiConfig = {}) {
    super(ctx, 'deviceApi')
    this.defaultHost = config.defaultHost
  }

  [Service.init](): void {
    const server = this.ctx.webServer

    // ── 设备清单 ──
    server.register({
      kind: 'exact',
      path: '/api/devices',
      handler: (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: `不支持的 method：${req.method}` })
          return
        }
        void this.listDevices(req, res)
      },
    })

    // ── 容器启停 ──
    server.register({
      kind: 'exact',
      path: '/api/actions/start',
      handler: (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: `不支持的 method：${req.method}` })
          return
        }
        void this.startContainer(req, res)
      },
    })

    server.register({
      kind: 'exact',
      path: '/api/actions/stop',
      handler: (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: `不支持的 method：${req.method}` })
          return
        }
        void this.stopContainer(req, res)
      },
    })

    // ── 单机操作 ──
    server.register({
      kind: 'exact',
      path: '/api/device/connect',
      handler: (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: `不支持的 method：${req.method}` })
          return
        }
        void this.connect(req, res)
      },
    })

    server.register({
      kind: 'exact',
      path: '/api/device/dump',
      handler: (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: `不支持的 method：${req.method}` })
          return
        }
        void this.dump(req, res)
      },
    })

    server.register({
      kind: 'exact',
      path: '/api/device/tap',
      handler: (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: `不支持的 method：${req.method}` })
          return
        }
        void this.tap(req, res)
      },
    })
  }

  /** 列出某台宿主机上的设备（容器与注册表合并）。 */
  private async listDevices(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://x')
    const host = url.searchParams.get('host') ?? this.defaultHost
    if (!host) {
      sendJson(res, 400, { error: '缺少 host 参数' })
      return
    }
    try {
      const containers = await this.ctx.mytHost.listContainers(host)
      const devices = await this.ctx.devices.reconcile(host, containers)
      sendJson(res, 200, { host, devices })
    } catch (error) {
      sendJson(res, 502, { error: message(error) })
    }
  }

  /** 启动容器并等待进入 running。 */
  private async startContainer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await readJson(req)
      const host = String(body['host'] ?? '')
      const name = String(body['name'] ?? '')
      const force = body['force'] === true
      if (!host || !name) {
        sendJson(res, 400, { error: '缺少 host 或 name' })
        return
      }
      await this.ctx.mytHost.startContainer(host, name, { force })
      const verify = await this.waitForState(host, name, (state) => state === 'running')
      sendJson(res, verify.ok ? 200 : 504, { action: 'start', host, name, force, ...verify })
    } catch (error) {
      sendJson(res, 502, { error: message(error) })
    }
  }

  /** 停止容器并等待进入 exited/created。 */
  private async stopContainer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await readJson(req)
      const host = String(body['host'] ?? '')
      const name = String(body['name'] ?? '')
      if (!host || !name) {
        sendJson(res, 400, { error: '缺少 host 或 name' })
        return
      }
      await this.ctx.mytHost.stopContainer(host, name)
      const verify = await this.waitForState(host, name, (state) => state === 'exited' || state === 'created')
      sendJson(res, verify.ok ? 200 : 504, { action: 'stop', host, name, ...verify })
    } catch (error) {
      sendJson(res, 502, { error: message(error) })
    }
  }

  /** 把容器纳入 adb 管理（`adb connect` + 等待设备稳定）。 */
  private async connect(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await readJson(req)
      const serial = String(body['serial'] ?? '')
      if (!serial) {
        sendJson(res, 400, { error: '缺少 serial' })
        return
      }
      const output = await this.ctx.deviceControl.connect(serial)
      sendJson(res, 200, { ok: true, serial, output })
    } catch (error) {
      sendJson(res, 502, { error: message(error) })
    }
  }

  /** 抓取设备 UI 树。 */
  private async dump(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://x')
    const serial = url.searchParams.get('serial') ?? ''
    if (!serial) {
      sendJson(res, 400, { error: '缺少 serial' })
      return
    }
    try {
      const snapshot = await this.ctx.deviceControl.dumpUi(serial)
      sendJson(res, 200, {
        serial: snapshot.serial,
        channel: snapshot.channel,
        nodeCount: snapshot.nodeCount,
        capturedAt: snapshot.capturedAt,
        root: snapshot.root,
      })
    } catch (error) {
      sendJson(res, 502, { error: message(error) })
    }
  }

  /** 按坐标点击。 */
  private async tap(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await readJson(req)
      const serial = String(body['serial'] ?? '')
      const x = Number(body['x'])
      const y = Number(body['y'])
      if (!serial || !Number.isFinite(x) || !Number.isFinite(y)) {
        sendJson(res, 400, { error: '缺少 serial 或坐标' })
        return
      }
      await this.ctx.deviceControl.tap(serial, x, y)
      sendJson(res, 200, { ok: true })
    } catch (error) {
      sendJson(res, 502, { error: message(error) })
    }
  }

  /**
   * 轮询容器状态直到满足 `accept`，或超时。
   * @param hostIp - 宿主机 IP。
   * @param name - 容器名。
   * @param accept - 判定为「已达目标状态」的谓词。
   * @param timeoutMs - 最长等待毫秒数。
   * @param intervalMs - 轮询间隔毫秒数。
   */
  private async waitForState(
    hostIp: string,
    name: string,
    accept: (state: string) => boolean,
    timeoutMs = 45_000,
    intervalMs = 2_000,
  ): Promise<{ ok: boolean; state: string; waitedMs: number }> {
    const startedAt = Date.now()
    let last = 'unknown'
    while (Date.now() - startedAt < timeoutMs) {
      const rows = await this.ctx.mytHost.listContainers(hostIp)
      const found = rows.find((row) => row.name === name)
      last = found?.state ?? 'missing'
      if (accept(last)) return { ok: true, state: last, waitedMs: Date.now() - startedAt }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    return { ok: false, state: last, waitedMs: Date.now() - startedAt }
  }
}

/** 读取 JSON 请求体；空体返回空对象。 */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  return JSON.parse(text) as Record<string, unknown>
}

/** 写 JSON 响应。 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 把 unknown 错误转成可读消息。 */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    deviceApi: DeviceApi
  }
}

export default DeviceApi
