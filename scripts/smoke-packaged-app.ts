/**
 * 打包产物冒烟：启动 `dist/win-unpacked/MYT.exe`，确认内核起来且 UI 可访问。
 *
 * 只验证「打包后还能跑」这一件事，不碰业务：
 * 1. `GET /api/health` 返回 `{ ok: true }`（内核 + 插件装配成功）
 * 2. `GET /` 返回 HTML（`MYT_UI_DIR` 指对了，前端资源随包分发）
 *
 * 端口由脚本先挑一个空闲端口再经 `MYT_PORT` 传入，避免和正在运行的实例抢 7788；
 * 数据目录用临时目录（`MYT_DATA_DIR`），不污染用户真实数据，也不会弹选目录对话框。
 *
 * 用法：
 * ```
 * npx tsx scripts/smoke-packaged-app.ts [exe 路径]
 * ```
 * 退出码 0 = 通过，1 = 失败。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** 默认产物路径（`pnpm dist` 的输出）。 */
const DEFAULT_EXE = 'packages/app/desktop/dist/win-unpacked/MYT.exe'
/** 健康检查最长等待：Electron 冷启动 + 插件装配在慢盘上可能要几十秒。 */
const HEALTH_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 500

interface CheckResult {
  name: string
  ok: boolean
  detail: string
}

/** 找一个当前空闲的本地端口，用来固定本次冒烟的内核端口。 */
function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port > 0 ? resolvePort(port) : reject(new Error('拿不到空闲端口'))))
    })
  })
}

async function fetchWithTimeout(url: string, timeoutMs = 3000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** 轮询健康检查，直到内核就绪或超时。 */
async function waitForHealth(port: number): Promise<{ ok: boolean; detail: string }> {
  const url = `http://127.0.0.1:${port}/api/health`
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  let lastError = '未开始'
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(url)
      if (response.ok) {
        const body = (await response.json()) as { ok?: boolean }
        if (body.ok === true) return { ok: true, detail: `HTTP 200 ${JSON.stringify(body)}` }
        lastError = `ok=${String(body.ok)}`
      } else {
        lastError = `HTTP ${response.status}`
      }
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((done) => setTimeout(done, POLL_INTERVAL_MS))
  }
  return { ok: false, detail: `超时 ${HEALTH_TIMEOUT_MS}ms，最后错误：${lastError}` }
}

/** 终止整棵进程树：Electron 会 fork 出内核子进程，只杀主进程会留孤儿。 */
async function killTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>((done) => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
      killer.once('exit', () => done())
      killer.once('error', () => done())
    })
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // 进程已退出。
  }
}

async function main(): Promise<number> {
  const exe = resolve(process.argv[2] ?? process.env['MYT_SMOKE_EXE'] ?? DEFAULT_EXE)
  if (!existsSync(exe)) {
    console.error(`产物不存在：${exe}\n先执行 pnpm dist（或 pnpm dev:desktop 生成 dist）。`)
    return 1
  }

  const port = await findFreePort()
  const dataDir = await mkdtemp(join(tmpdir(), 'myt-smoke-'))
  console.log(`产物：${exe}`)
  console.log(`端口：${port}  数据目录：${dataDir}`)

  const child = spawn(exe, [], {
    // 宿主列表默认指向本机回环：冒烟只验证「打包产物能起来」，
    // 不该顺带把真实宿主机拉进来（`/api/devices` 会去连它）。
    // 不用空串——Electron 的 `utilityProcess.fork` 会丢掉空环境变量，
    // 回落成产物内置的默认宿主（实测仍会报出 192.168.0.113）。
    // 需要连真实宿主时由调用方显式设置。
    env: { ...process.env, MYT_HOSTS: '127.0.0.1', MYT_PORT: String(port), MYT_DATA_DIR: dataDir },
    stdio: 'ignore',
    // POSIX 下要独立进程组才能连带子进程一起杀。
    detached: process.platform !== 'win32',
  })
  const pid = child.pid
  const results: CheckResult[] = []
  let exitedEarly = false
  child.once('exit', () => {
    exitedEarly = true
  })

  try {
    const health = await waitForHealth(port)
    results.push({
      name: '内核健康检查 /api/health',
      ok: health.ok,
      detail: health.ok ? health.detail : `${health.detail}${exitedEarly ? '（进程已退出）' : ''}`,
    })

    if (health.ok) {
      try {
        const response = await fetchWithTimeout(`http://127.0.0.1:${port}/`)
        const html = await response.text()
        results.push({
          name: '前端资源 /（MYT_UI_DIR 指向）',
          ok: response.ok && /<html/iu.test(html),
          detail: `HTTP ${response.status}，${html.length} 字节`,
        })
      } catch (error: unknown) {
        results.push({
          name: '前端资源 /（MYT_UI_DIR 指向）',
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } finally {
    if (pid !== undefined) await killTree(pid)
    await rm(dataDir, { recursive: true, force: true }).catch(() => {})
  }

  console.log('')
  for (const result of results) {
    console.log(`${result.ok ? '✓' : '✗'} ${result.name} — ${result.detail}`)
  }
  const failed = results.filter((result) => !result.ok)
  console.log(failed.length === 0 ? '\n冒烟通过' : `\n冒烟失败 ${failed.length} 项`)
  return failed.length === 0 ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error))
    process.exit(1)
  })
