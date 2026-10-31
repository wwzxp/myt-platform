import type { IncomingMessage, ServerResponse } from 'node:http'
import { Service } from '@deepseek-ai/cordis'
// 引入模块增强：让 `ctx.webServer` 有类型
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { WorkflowDocument, WorkflowStore } from '@myt/workflows'

/**
 * 流程图 HTTP 接口。
 *
 * 路由注册走 dsh 的 `ctx.webServer.register({ kind, path, handler })`——
 * 与 dsh 的其它插件同一套机制，内核/启动器不认识任何业务路径。
 *
 * 路由优先级由 `kind` 决定：`exact` 永远先于 `prefix`，
 * 所以 `/rename`、`/duplicate` 不会被 `/api/workflows/:file` 抢走。
 */
export class WorkflowApi extends Service {
  /** 依赖：流程存储 + dsh 的 Web 服务。 */
  static inject = ['workflows', 'webServer']

  constructor(ctx: ConstructorParameters<typeof Service>[0]) {
    super(ctx, 'workflowApi')
  }

  [Service.init](): void {
    const store: WorkflowStore = this.ctx.workflows
    const server = this.ctx.webServer

    // ── 精确路由 ──
    server.register({
      kind: 'exact',
      path: '/api/workflows',
      handler: (req, res) => {
        if (req.method === 'GET') {
          void store.list().then((rows) => sendJson(res, 200, rows), (e: unknown) => fail(res, e))
          return
        }
        if (req.method === 'POST') {
          void readJson(req).then(
            async (body) => {
              const name = String(body['name'] ?? '').trim() || '未命名流程'
              const created = await store.create(name)
              sendJson(res, 200, { fileName: created.fileName, id: created.doc.id })
            },
            (e: unknown) => fail(res, e),
          )
          return
        }
        sendJson(res, 405, { error: `不支持的 method：${req.method}` })
      },
    })

    server.register({
      kind: 'exact',
      path: '/api/workflows/rename',
      handler: (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: `不支持的 method：${req.method}` })
          return
        }
        void readJson(req).then(
          async (body) => {
            try {
              const fileName = await store.rename(String(body['fileName'] ?? ''), String(body['name'] ?? ''))
              sendJson(res, 200, { fileName })
            } catch (error) {
              sendJson(res, 404, { error: error instanceof Error ? error.message : String(error) })
            }
          },
          (e: unknown) => fail(res, e),
        )
      },
    })

    server.register({
      kind: 'exact',
      path: '/api/workflows/duplicate',
      handler: (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: `不支持的 method：${req.method}` })
          return
        }
        void readJson(req).then(
          async (body) => {
            try {
              const fileName = await store.duplicate(String(body['fileName'] ?? ''))
              sendJson(res, 200, { fileName })
            } catch (error) {
              sendJson(res, 404, { error: error instanceof Error ? error.message : String(error) })
            }
          },
          (e: unknown) => fail(res, e),
        )
      },
    })

    // ── 前缀路由：/api/workflows/<文件名> ──
    server.register({
      kind: 'prefix',
      path: '/api/workflows',
      handler: (req, res) => {
        const fileName = decodeURIComponent((req.url ?? '').split('?')[0]!.slice('/api/workflows/'.length))
        if (!fileName) {
          sendJson(res, 404, { error: '缺少流程名' })
          return
        }
        if (req.method === 'GET') {
          void store.load(fileName).then(
            (doc) => {
              if (!doc) sendJson(res, 404, { error: `流程不存在：${fileName}` })
              else sendJson(res, 200, doc)
            },
            (e: unknown) => fail(res, e),
          )
          return
        }
        if (req.method === 'PUT') {
          void readJson(req).then(
            async (body) => {
              const saved = await store.save(fileName, body as unknown as WorkflowDocument)
              sendJson(res, 200, { fileName: saved })
            },
            (e: unknown) => fail(res, e),
          )
          return
        }
        if (req.method === 'DELETE') {
          void store.remove(fileName).then(
            (removed) => sendJson(res, 200, { removed }),
            (e: unknown) => fail(res, e),
          )
          return
        }
        sendJson(res, 405, { error: `不支持的 method：${req.method}` })
      },
    })
  }
}

/** 读 JSON 请求体；无 body 时返回空对象。 */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** 统一 JSON 响应。 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/** 把异常收敛成 502。 */
function fail(res: ServerResponse, error: unknown): void {
  sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workflowApi: WorkflowApi
  }
}

export default WorkflowApi
