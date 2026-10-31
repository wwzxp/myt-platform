import type { IncomingMessage, ServerResponse } from 'node:http'
import { Service } from '@deepseek-ai/cordis'
// 引入各 Service 的模块增强，让 `ctx.webServer` 有类型
import type {} from '@deepseek-ai/dsh-host-webserver'
import { HeroSmsClient } from '@myt/flow-xhs'

/**
 * 业务 HTTP 接口：短信平台（HeroSMS）。
 *
 * API Key 由请求体传入，不落盘、不进日志——多租户场景下每台机器可以
 * 用不同的 key，本服务不持有任何凭据。
 *
 * 单独成组的原因：这是唯一一组「不碰设备、不碰本地状态」的业务路由，
 * 迁移它不依赖设备域或流程域的任何装配。
 */
export class XhsApi extends Service {
  /** 依赖：只有 dsh 的 Web 服务，短信平台是外部 HTTP。 */
  static inject = ['webServer']

  constructor(ctx: ConstructorParameters<typeof Service>[0]) {
    super(ctx, 'xhsApi')
  }

  [Service.init](): void {
    const server = this.ctx.webServer

    server.register({
      kind: 'exact',
      path: '/api/herosms/balance',
      handler: (req, res) => {
        void this.handle(req, res, async (client) => ({ balance: await client.getBalance() }))
      },
    })

    server.register({
      kind: 'exact',
      path: '/api/herosms/countries',
      handler: (req, res) => {
        void this.handle(req, res, async (client) => ({ countries: await client.getCountries() }))
      },
    })

    server.register({
      kind: 'exact',
      path: '/api/herosms/prices',
      handler: (req, res) => {
        void this.handle(
          req,
          res,
          async (client, body) => {
            const countryId = Number(body['countryId'])
            const service = String(body['service'] ?? 'qf')
            return { prices: await client.getPrices(service, countryId) }
          },
          (body) => {
            const countryId = Number(body['countryId'])
            if (!Number.isInteger(countryId) || countryId < 0) throw new InvalidRequest('请先选择有效国家')
          },
        )
      },
    })

    server.register({
      kind: 'exact',
      path: '/api/herosms/activations',
      handler: (req, res) => {
        void this.handle(req, res, async (client) => ({ activations: await client.getActiveActivations() }))
      },
    })

    server.register({
      kind: 'exact',
      path: '/api/herosms/cancel',
      handler: (req, res) => {
        void this.handle(
          req,
          res,
          async (client, body) => {
            const activationId = String(body['activationId'] ?? '').trim()
            await client.cancelActivation(activationId)
            return { activationId, cancelled: true }
          },
          (body) => {
            if (!String(body['activationId'] ?? '').trim()) throw new InvalidRequest('缺少 activationId')
          },
        )
      },
    })
  }

  /**
   * 统一处理一组 HeroSMS 接口：校验 → 建客户端 → 跑动作 → 写响应。
   *
   * @param req - HTTP 请求（必须是 POST）。
   * @param res - 响应对象。
   * @param validate - 从请求体取参数；不合法时抛出 `InvalidRequest`。
   * @param work - 拿到客户端与实际参数后的动作。
   */
  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
    work: (client: HeroSmsClient, body: Record<string, unknown>) => Promise<Record<string, unknown>>,
    validate?: (body: Record<string, unknown>) => void,
  ): Promise<void> {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: `不支持的 method：${req.method}` })
      return
    }
    let body: Record<string, unknown>
    try {
      body = await readJson(req)
      validate?.(body)
    } catch (error) {
      if (error instanceof InvalidRequest) {
        sendJson(res, 400, { error: error.message })
        return
      }
      sendJson(res, 400, { error: '请求体不是合法 JSON' })
      return
    }
    const apiKey = String(body['apiKey'] ?? '').trim()
    if (!apiKey) {
      sendJson(res, 400, { error: '缺少 apiKey' })
      return
    }
    try {
      sendJson(res, 200, await work(new HeroSmsClient(apiKey), body))
    } catch (error) {
      sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/** 请求参数不合法；由 `handle` 转成 400。 */
class InvalidRequest extends Error {}

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

declare module '@deepseek-ai/cordis' {
  interface Context {
    xhsApi: XhsApi
  }
}

export default XhsApi
