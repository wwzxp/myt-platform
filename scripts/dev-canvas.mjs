/**
 * 本地预览画布界面（开发用）。
 *
 * 解决两件事：
 * 1. 画布是独立前端，内核不托管它——直接开 `file://` 会被模块/跨域拦掉；
 * 2. 前端把内核地址写死成 `http://127.0.0.1:7788`，浏览器直连会被 CORS 拦成
 *    `Failed to fetch`（dsh 的 web server 只在预检和部分路由上加跨域头）。
 *
 * 所以这里起一个**同源**服务：静态托管 `packages/client/app/dist`，
 * 并把 `/api/*` 反向代理到内核。内核没起时自动拉起。
 *
 * 用法：
 * ```
 * pnpm dev:canvas          # 默认 http://127.0.0.1:3000
 * PORT=4000 pnpm dev:canvas
 * ```
 * 关掉：Ctrl+C（会自动结束它拉起来的内核进程）。
 */
import { spawn } from 'node:child_process'
import { createServer, request } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const UI_DIR = resolve('packages/client/app/dist')
const KERNEL_PORT = Number(process.env['KERNEL_PORT'] ?? 7788)
const UI_PORT = Number(process.env['PORT'] ?? 3000)

const MIME = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
}

/** 内核是否已经在跑。 */
async function kernelAlive() {
  try {
    const response = await fetch(`http://127.0.0.1:${KERNEL_PORT}/api/health`, {
      signal: AbortSignal.timeout(1500),
    })
    return response.ok
  } catch {
    return false
  }
}

/** 没跑就拉起宿主进程；返回句柄用于退出时清理。 */
async function ensureKernel() {
  if (await kernelAlive()) {
    console.log(`[canvas] 复用已在运行的内核 :${KERNEL_PORT}`)
    return undefined
  }
  console.log(`[canvas] 启动内核 :${KERNEL_PORT} …`)
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'packages/app/desktop-host/src/host.ts'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        MYT_PORT: String(KERNEL_PORT),
        // 只预览画布时不需要连真实宿主；需要连由调用方显式设置。
        MYT_HOSTS: process.env['MYT_HOSTS'] ?? '',
      },
    },
  )
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (await kernelAlive()) return child
    await new Promise((done) => setTimeout(done, 500))
  }
  child.kill()
  throw new Error('内核启动超时（60s）')
}

const server = createServer(async (req, res) => {
  const url = req.url ?? '/'

  // /api 转发给内核：同源了，浏览器不再拦跨域。
  if (url.startsWith('/api')) {
    const upstream = request(
      {
        host: '127.0.0.1',
        port: KERNEL_PORT,
        path: url,
        method: req.method,
        headers: req.headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
        upstreamRes.pipe(res)
      },
    )
    upstream.on('error', () => {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: `内核未响应（:${KERNEL_PORT}）` }))
    })
    req.pipe(upstream)
    return
  }

  const pathname = url === '/' ? '/index.html' : normalize(url).replace(/^(\.\.[/\\])+/u, '')
  try {
    const body = await readFile(join(UI_DIR, pathname))
    res.writeHead(200, { 'content-type': MIME[extname(pathname)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    // 前端是单页应用：未知路径回落到 index.html。
    try {
      const body = await readFile(join(UI_DIR, 'index.html'))
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(body)
    } catch {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('前端产物不存在：先执行 pnpm --filter ./packages/client/app build')
    }
  }
})

if (!existsSync(join(UI_DIR, 'index.html'))) {
  console.error(`前端产物不存在：${UI_DIR}\n先执行：pnpm --filter ./packages/client/app build`)
  process.exit(1)
}

const kernel = await ensureKernel()

server.listen(UI_PORT, '127.0.0.1', () => {
  console.log(`\n[canvas] 打开 http://127.0.0.1:${UI_PORT}/`)
  console.log('[canvas] Ctrl+C 结束（会一并关闭它拉起的内核）\n')
})

const shutdown = () => {
  server.close()
  kernel?.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
