/**
 * 运行记录的 HTTP 接口。
 *
 * 三条路由共用一套数据形状：列表只给摘要（UI 表格要的列），
 * 单条给完整记录（含事件流），创建则直接跑流程。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
// 引入各 Service 的模块增强，让 `ctx.xxx` 有类型
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@myt/runs'
import type {} from '@myt/flow'
import type {} from '@myt/device-adb'
import { FlowRunner } from '@myt/flow'
import type {} from '@myt/model'
import { createModelLocate } from '@myt/ui-decide'
import { AlignCache, assessCollection, collectKeywords, suggestKeywordHints, type PageSample, type SampleNode } from '@myt/automation'

/** 运行接口的配置。 */
/**
 * 把 ModelControl 适配成「视觉读字」回调。
 *
 * 只有实现了 `completeWithImage` 的 provider（如 OpenAI 兼容的 ollama）才有视觉能力；
 * 其余返回 undefined，`currentPage` 会跳过截图读字这一步。
 */
function createVision(
  model: unknown,
): ((prompt: string, imageBase64: string) => Promise<string>) | undefined {
  const candidate = model as { completeWithImage?: (p: string, i: string, o?: object) => Promise<string> }
  if (typeof candidate?.completeWithImage !== 'function') return undefined
  return (prompt: string, imageBase64: string) =>
    candidate.completeWithImage!(prompt, imageBase64, { maxTokens: 256 })
}

export interface RunsApiConfig {
  /** yadb 可执行文件路径；随应用分发。 */
  yadbPath?: string
}

/**
 * 运行记录接口。
 *
 * 认识「运行」这一概念（列表 / 单条 / 创建），不认识流程里有什么步骤。
 */
export class RunsApi extends Service {
  /** 依赖：Web 服务、运行存储、流程注册表、单机控制。 */
  static inject = ['webServer', 'runs', 'flows', 'deviceControl', 'modelControl']

  private readonly runner: FlowRunner
  private readonly yadbPath: string
  /**
   * 跨语言对齐表缓存。
   *
   * 落在数据目录下（`MYT_DATA_DIR`），一次生成长期复用；
   * 没有它，英文/日文界面下的页面关键词永远匹配不上。
   */
  private readonly align: AlignCache

  constructor(ctx: ConstructorParameters<typeof Service>[0], config: RunsApiConfig = {}) {
    super(ctx, 'runsApi')
    this.runner = new FlowRunner(ctx.runs, ctx.deviceControl)
    this.yadbPath = config.yadbPath ?? 'yadb'
    const dataDir = process.env['MYT_DATA_DIR'] ?? 'data'
    this.align = new AlignCache({ file: join(dataDir, 'align-zh.json') })
  }

  [Service.init](): void {
    const server = this.ctx.webServer

    server.register({
      kind: 'exact',
      path: '/api/runs',
      handler: (req, res) => {
        if (req.method === 'GET') return this.list(req, res)
        if (req.method === 'POST') return void this.create(req, res)
        methodNotAllowed(res, req.method)
      },
    })

    // 页面关键词采集：停在某个页面上，抓几次、滚动几次，算出该页独有词。
    // 放在这里是因为它和跑流程一样需要 deviceControl；未来可独立成服务。
    server.register({
      kind: 'exact',
      path: '/api/pages/collect',
      handler: (req, res) => {
        if (req.method !== 'POST') return methodNotAllowed(res, req.method)
        void this.collectKeywords(req, res)
      },
    })

    server.register({
      kind: 'prefix',
      path: '/api/runs',
      handler: (req, res) => {
        if (req.method !== 'GET') return methodNotAllowed(res, req.method)
        // exact 路由先吃掉 `/api/runs` 本身，这里只会收到 `/api/runs/<id>`。
        const runId = new URL(req.url ?? '/', 'http://x').pathname.slice('/api/runs/'.length)
        const record = this.ctx.runs.get(runId)
        if (!record) return sendJson(res, 404, { error: '运行不存在' })
        sendJson(res, 200, record)
      },
    })
  }

  /** 列表：只给 UI 表格需要的列，不带事件流。 */
  /**
   * 采集当前页面的关键词。
   *
   * 请求体：`{ serial, pageId, samples?, scroll? }`
   * 返回：`{ pageId, keywords, sampleSizes, warning? }`
   *
   * 规则见 `@myt/automation` 的 `collectKeywords`：
   * 出现率 ≥80% 才算固定元素，跨页重复的词由调用方合并后再去重。
   */
  private async collectKeywords(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await readJson(req)
      const serial = typeof body['serial'] === 'string' ? body['serial'] : ''
      const pageId = typeof body['pageId'] === 'string' ? body['pageId'] : ''
      if (!serial || !pageId) return sendJson(res, 400, { error: '缺少 serial 或 pageId' })

      const samples = Math.min(10, Math.max(1, Number(body['samples'] ?? 3)))
      const scroll = body['scroll'] !== false

      const collected: PageSample[] = []
      const sampleSizes: number[] = []
      for (let i = 0; i < samples; i += 1) {
        if (i > 0 && scroll) {
          await this.ctx.deviceControl.shell(serial, 'input swipe 540 1200 540 700 300', {
            check: false,
            timeoutMs: 10_000,
          })
          await new Promise((r) => setTimeout(r, 800))
        }
        const snapshot = await this.ctx.deviceControl.dumpUi(serial, { channel: 'uiautomator' })
        const nodes: SampleNode[] = []
        const walk = (node: {
          text?: string
          contentDesc?: string
          className?: string
          selected?: boolean
          children?: readonly unknown[]
        }): void => {
          if (node.text || node.contentDesc) {
            nodes.push({
              text: node.text ?? '',
              contentDesc: node.contentDesc ?? '',
              className: node.className ?? '',
              selected: node.selected === true,
            })
          }
          for (const child of node.children ?? []) walk(child as never)
        }
        walk(snapshot.root as never)
        sampleSizes.push(nodes.length)
        collected.push({ pageId, texts: nodes })
      }

      const keywords = collectKeywords(collected)[pageId] ?? []
      const hints = suggestKeywordHints(collected, keywords)
      const verdict = assessCollection(keywords)
      sendJson(res, 200, {
        pageId,
        keywords,
        hints,
        sampleSizes,
        ...(verdict.ok ? {} : { warning: verdict.reason }),
      })
    } catch (error) {
      sendJson(res, 502, { error: message(error) })
    }
  }

  private list(req: IncomingMessage, res: ServerResponse): void {
    const limit = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('limit') ?? 20)
    const records = this.ctx.runs.list({ limit: Number.isInteger(limit) ? limit : 20 })
    sendJson(
      res,
      200,
      records.map((record) => ({
        runId: record.runId,
        flowId: record.flowId,
        deviceId: record.deviceId,
        serial: record.serial,
        status: record.status,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        steps: record.events.filter((event) => event.type === 'step/started').length,
      })),
    )
  }

  /** 创建并立即执行一次运行。 */
  private async create(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await readJson(req)
      const flowId = String(body['flowId'] ?? '')
      const serial = String(body['serial'] ?? '')
      const deviceId = String(body['deviceId'] ?? '')
      const dryRun = body['dryRun'] === true
      const params = (body['params'] ?? {}) as Record<string, unknown>
      if (!flowId || !serial) return sendJson(res, 400, { error: '缺少 flowId 或 serial' })

      let flow
      try {
        flow = this.ctx.flows.resolve(flowId, params)
      } catch (error) {
        return sendJson(res, 400, { error: message(error) })
      }
      if (!flow) return sendJson(res, 404, { error: `流程不存在：${flowId}` })

      // 同一设备同时只允许一个运行；冲突直接拒绝而不是排队（避免抢占界面）。
      const active = this.ctx.runs.list({ deviceId, status: 'running' })
      if (active.length > 0) {
        return sendJson(res, 409, { error: '该设备已有运行中的任务', runId: active[0]?.runId })
      }

      const result = await this.runner.run(
        flow,
        { deviceId: deviceId || serial, serial },
        {
          dryRun,
          // 定位用本机模型：不传就只能走硬编码定位器，意图定位整段失效。
          model: createModelLocate(this.ctx.modelControl),
          // 页面识别能力：对齐表缺词时补词、XML 无文字时读截图。
          // 模型不可用（未装配 provider）时这三项都是 undefined，流程照常跑。
          pageIdentify: {
            align: this.align,
            alignModel: (prompt: string) => this.ctx.modelControl.complete(prompt, { maxTokens: 320 }),
            vision: createVision(this.ctx.modelControl),
          },
          yadbPath: this.yadbPath,
          seed: typeof body['seed'] === 'number' ? body['seed'] : undefined,
          // 登录类流程必须用 yadb：真机上验证过，uiautomator 结构不同。
          uiChannel: flow.uiChannel ?? 'uiautomator',
        },
      )
      sendJson(res, result.status === 'succeeded' ? 200 : 500, result)
    } catch (error) {
      sendJson(res, 502, { error: message(error) })
    }
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

/** 统一的 405。 */
function methodNotAllowed(res: ServerResponse, method: string | undefined): void {
  sendJson(res, 405, { error: `不支持的 method：${method}` })
}

/** 把 unknown 错误转成可读消息。 */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    runsApi: RunsApi
  }
}

export default RunsApi
