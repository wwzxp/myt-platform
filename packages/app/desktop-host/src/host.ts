/**
 * Electron utilityProcess 入口。
 *
 * 只做三件事：把壳传来的 `MYT_*` 环境变量补齐、装配并运行 profile、
 * 向父端口上报监听端口。业务逻辑一行不在这里——它们都在
 * `profile/myt` 装配的插件里。
 */

import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { loadProfileDirectory, loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
// 模块增强：让 `ctx.webServer` / `ctx.fiber` 有类型
import type {} from '@deepseek-ai/dsh-host-webserver'
import { getParentPort } from './parent-port.ts'

const parentPort = getParentPort()

const port = Number(process.env['MYT_PORT'] ?? 0)
/** 仓库根；`lib/` 向上四级。 */
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const stateFile = process.env['MYT_STATE_FILE'] ?? join(repoRoot, 'data', 'devices.json')

// 插件在装配时读环境变量拿配置，所以这些必须在 runProfile 之前补齐。
process.env['MYT_DATA_DIR'] ??= join(stateFile, '..')
process.env['MYT_STATE_FILE'] = stateFile

const sdkBase = process.env['MYT_SDK_BASE'] ?? 'http://127.0.0.1:7878'
const hosts = (process.env['MYT_HOSTS'] ?? '192.168.0.113')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0)

/** profile 目录；开发期取仓库内路径，打包后由壳指到 resources。 */
const profileDir = process.env['MYT_PROFILE_DIR'] ?? join(repoRoot, 'profile', 'myt')
const anchor = join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
const profile = loadProfileDirectory('dsh', profileDir, anchor)

/**
 * 把监听端口写成一个 overlay 补丁。
 *
 * 为什么必须这样：`webserver` 只从自身 config 读端口，不读启动参数；
 * profile 的 YAML 又不支持环境变量插值。壳算好端口后必须让它真正生效——
 * 否则服务监听在随机端口，壳拿自己那个端口做健康检查会一直失败。
 *
 * @param listenPort - 壳指定的端口；0 表示让系统分配。
 * @returns 补丁文件路径。
 */
async function writePortPatch(listenPort: number): Promise<string> {
  const file = join(tmpdir(), 'myt-host-port.yml')
  await writeFile(
    file,
    `- id: webserver\n  config:\n    host: '127.0.0.1'\n    port: ${listenPort}\n`,
    'utf8',
  )
  return file
}

const { ctx } = await runProfile({
  environment: loadLayeredEnv('dsh'),
  profile: 'myt',
  resolvedProfile: { profile, installAnchor: anchor },
  patchFiles: [await writePortPatch(port)],
  args: ['--no-open', '--host', '127.0.0.1', '--port', String(port)],
})

const listening = ctx.webServer.port
parentPort?.postMessage({ type: 'kernel/ready', port: listening, host: '127.0.0.1' })
console.log(`[myt] host ready  http://127.0.0.1:${listening}`)
console.log(`[myt] sdk=${sdkBase} hosts=${hosts.join(',')}`)

parentPort?.on('message', (event) => {
  if (event.data?.type === 'kernel/shutdown') {
    void ctx.fiber.dispose().then(() => process.exit(0))
  }
})

process.on('uncaughtException', (error) => {
  parentPort?.postMessage({ type: 'kernel/fatal', message: String(error?.stack ?? error) })
})
