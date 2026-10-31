import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Service } from '@deepseek-ai/cordis'

/**
 * HTTP 路由服务。
 *
 * 内核不再硬编码业务路由；插件在 `[Service.init]` 里自己注册：
 *
 * ```ts
 * export class WorkflowApi extends Service {
 *   constructor(ctx: Context) {
 *     super(ctx, 'workflowApi')
 *   }
 *   [Service.init]() {
 *     this.ctx.http.get('/api/workflows', async () => ({ workflows: await ... }))
 *   }
 * }
 * ```
 *
 * 设计对齐 dsh 的 `dsh-host-webserver`（只做「注册路由」这一件事，
 * 不认识任何业务概念），但补了本项目需要的两样东西：
 * CORS（前端 dev server 与内核不同端口）和统一的 JSON 响应/错误处理。
 */

/** 处理器：返回值会被序列化成 JSON；抛错变 502。 */
export type RouteHandler = (context: RouteContext) => unknown | Promise<unknown>

/** 处理器拿到的请求上下文。 */
export interface RouteContext {
  /** 请求方法与路径。 */
  readonly method: string
  readonly pathname: string
  /** 查询参数。 */
  readonly query: URLSearchParams
  /** 路径参数（前缀路由里的 `:name` 段）。 */
  readonly params: Record<string, string>
  /** 已解析的 JSON 请求体（无 body 时为空对象）。 */
  readonly body: Record<string, unknown>
  /** 原始请求/响应，需要流式输出（SSE）时直接用。 */
  readonly req: IncomingMessage
  readonly res: ServerResponse
}

/** 路由匹配方式。 */
export type RouteKind = 'exact' | 'prefix'

interface Route {
  kind: RouteKind
  method: string
  /** exact：完整路径；prefix：前缀（可含 `:name` 段）。 */
  pattern: string
  handler: RouteHandler
}

export interface WebServerConfig {
  /** 监听端口；0 表示由系统分配。 */
  port: number
  /** 监听地址；默认仅本机。 */
  host?: string
  /** 是否开放 CORS（默认 true：前端 dev server 与内核不同端口）。 */
  cors?: boolean
  /** 未匹配到路由时的兜底（例如静态文件服务）。 */
  fallback?: RouteHandler | undefined
}

/** 跨域头。前端 dev server 在 :3000、内核在 :7788，缺这些头浏览器会直接拦截。 */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '86400',
} as const

/**
 * HTTP 路由服务（Cordis 服务键 `ctx.http`）。
 *
 * 职责边界：
 * - ✅ 监听端口、分发路由、CORS、JSON 编解码、错误收敛
 * - ❌ 不认识任何业务概念（设备、流程、运行……都由插件自己注册）
 */
export class WebServer extends Service {
  private readonly config: WebServerConfig
  private readonly routes: Route[] = []
  private server: Server | undefined
  private listeningPort: number | undefined

  constructor(ctx: ConstructorParameters<typeof Service>[0], config: WebServerConfig) {
    super(ctx, 'http')
    this.config = config
  }

  /** 实际监听端口（`port: 0` 时由系统分配）。 */
  get port(): number | undefined {
    return this.listeningPort
  }

  /**
   * 注册精确路径路由。
   *
   * @param path 绝对路径，如 `/api/workflows`
   * @param handler 处理器；返回值序列化为 JSON
   * @returns 注销函数
   */
  get(path: string, handler: RouteHandler): () => void {
    return this.register('exact', 'GET', path, handler)
  }

  post(path: string, handler: RouteHandler): () => void {
    return this.register('exact', 'POST', path, handler)
  }

  put(path: string, handler: RouteHandler): () => void {
    return this.register('exact', 'PUT', path, handler)
  }

  delete(path: string, handler: RouteHandler): () => void {
    return this.register('exact', 'DELETE', path, handler)
  }

  /**
   * 注册前缀路由，支持 `:name` 路径参数。
   *
   * ```ts
   * ctx.http.prefix('GET', '/api/workflows/:file', (ctx) => ctx.params.file)
   * ```
   *
   * 前缀路由**永远**比精确路由后匹配——先注册精确路由即可获得优先级。
   */
  prefix(method: string, pattern: string, handler: RouteHandler): () => void {
    return this.register('prefix', method.toUpperCase(), pattern, handler)
  }

  /** 设置兜底处理器（未匹配任何路由时调用）。后设置者覆盖先前值。 */
  setFallback(handler: RouteHandler | undefined): void {
    this.config.fallback = handler
  }

  /** 注册路由（底层方法，需要自定义 method 时用）。 */
  register(kind: RouteKind, method: string, pattern: string, handler: RouteHandler): () => void {
    const normalized = normalizePath(pattern)
    const duplicate = this.routes.some(
      (route) => route.kind === kind && route.method === method && route.pattern === normalized,
    )
    if (duplicate) {
      throw new Error(`路由重复注册：${method} ${normalized}`)
    }
    const route: Route = { kind, method, pattern: normalized, handler }
    this.routes.push(route)
    return () => {
      const index = this.routes.indexOf(route)
      if (index !== -1) this.routes.splice(index, 1)
    }
  }

  /** 启动监听。由宿主（kernel）在装配完成后调用。 */
  async listen(): Promise<number> {
    if (this.server) return this.listeningPort as number

    this.server = createServer((req, res) => {
      void this.dispatch(req, res)
    })

    const { promise, resolve, reject } = Promise.withResolvers<number>()
    this.server.once('error', reject)
    this.server.listen(this.config.port, this.config.host ?? '127.0.0.1', () => {
      this.server?.off('error', reject)
      const address = this.server?.address()
      this.listeningPort =
        typeof address === 'object' && address ? address.port : this.config.port
      resolve(this.listeningPort as number)
    })
    return promise
  }

  /** 关闭监听。 */
  async close(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = undefined
    const { promise, resolve } = Promise.withResolvers<void>()
    server.close(() => resolve())
    await promise
  }

  // ── 内部 ──

  private async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

    // CORS 预检：浏览器在 POST 前先发 OPTIONS，必须直接放行
    if (this.config.cors !== false) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS)
        res.end()
        return
      }
    }

    try {
      const matched = this.match(req.method ?? 'GET', url.pathname)
      if (matched) {
        const context: RouteContext = {
          method: req.method ?? 'GET',
          pathname: url.pathname,
          query: url.searchParams,
          params: matched.params,
          body: await readJsonBody(req),
          req,
          res,
        }
        const result = await matched.route.handler(context)
        // 处理器可以自己写响应（SSE 等）；写过了就不再重复
        if (res.writableEnded) return
        sendJson(res, 200, result, this.config.cors !== false)
        return
      }

      if (this.config.fallback) {
        const result = await this.config.fallback({
          method: req.method ?? 'GET',
          pathname: url.pathname,
          query: url.searchParams,
          params: {},
          body: await readJsonBody(req),
          req,
          res,
        })
        if (res.writableEnded) return
        sendJson(res, 200, result, this.config.cors !== false)
        return
      }

      sendJson(res, 404, { error: `not found: ${url.pathname}` }, this.config.cors !== false)
    } catch (error) {
      if (res.writableEnded) return
      const status = error instanceof HttpError ? error.status : 502
      sendJson(
        res,
        status,
        { error: error instanceof Error ? error.message : String(error) },
        this.config.cors !== false,
      )
    }
  }

  /** 先匹配精确路由，再匹配前缀路由（顺序决定优先级）。 */
  private match(method: string, pathname: string): { route: Route; params: Record<string, string> } | undefined {
    for (const route of this.routes) {
      if (route.kind !== 'exact' || route.method !== method || route.pattern !== pathname) continue
      return { route, params: {} }
    }
    for (const route of this.routes) {
      if (route.kind !== 'prefix' || route.method !== method) continue
      const params = matchPrefix(route.pattern, pathname)
      if (params) return { route, params }
    }
    return undefined
  }
}

/** 带状态码的错误，处理器可以直接 `throw new HttpError(404, '…')`。 */
export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/** 去掉末尾斜杠（根路径除外）。 */
function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

/**
 * 前缀匹配，支持 `:name` 段。
 *
 * `/api/workflows/:file` 匹配 `/api/workflows/a.json` → `{ file: 'a.json' }`
 */
function matchPrefix(pattern: string, pathname: string): Record<string, string> | undefined {
  const patternParts = pattern.split('/')
  const pathParts = pathname.split('/')
  if (pathParts.length < patternParts.length) return undefined

  const params: Record<string, string> = {}
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i] as string
    const actual = pathParts[i] as string
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual)
      continue
    }
    if (expected !== actual) return undefined
  }
  return params
}

/** 读 JSON 请求体；无 body 或非 JSON 时返回空对象。 */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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

/** 统一 JSON 响应（带 CORS）。 */
function sendJson(res: ServerResponse, status: number, body: unknown, cors: boolean): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(cors ? CORS_HEADERS : {}),
  })
  res.end(JSON.stringify(body))
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    http: WebServer
  }
}

/** Cordis Loader 按包名导入时要求默认导出。 */
export default WebServer
