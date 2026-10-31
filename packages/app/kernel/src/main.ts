import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startKernel } from './kernel.ts'

const port = Number(process.env['MYT_PORT'] ?? 7788)
const sdkBase = process.env['MYT_SDK_BASE'] ?? 'http://127.0.0.1:7878'
const hosts = (process.env['MYT_HOSTS'] ?? '192.168.0.113')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0)

/**
 * 设备状态文件。
 *
 * 优先级：`MYT_STATE_FILE`（Electron 主进程按数据目录算好后传入）
 * → `MYT_DATA_DIR/devices.json`（开发期用环境变量指定数据根）
 * → 项目 `data/devices.json`（默认，方便开发时直接看文件）。
 */
const stateFile =
  process.env['MYT_STATE_FILE'] ||
  (process.env['MYT_DATA_DIR']
    ? join(process.env['MYT_DATA_DIR'], 'devices.json')
    : fileURLToPath(new URL('../../../../data/devices.json', import.meta.url)))
const uiDir = fileURLToPath(new URL('../../../client/ui/', import.meta.url))
const adbPath = process.env['MYT_ADB_PATH'] || undefined
const yadbPath = process.env['MYT_YADB_PATH'] || undefined
const adbKeyboardApk = process.env['MYT_ADB_KEYBOARD_APK'] || undefined
const seed = process.env['MYT_SEED'] ? Number(process.env['MYT_SEED']) : undefined

const handle = await startKernel({
  port,
  sdkBase,
  hosts,
  stateFile,
  uiDir,
  adbPath,
  yadbPath,
  adbKeyboardApk,
  seed,
  onReady: ({ port: listening, host }) => {
    console.log(`[myt] kernel ready  http://${host}:${listening}`)
    console.log(`[myt] sdk base      ${sdkBase}`)
    console.log(`[myt] hosts         ${hosts.join(', ')}`)
    console.log(`[myt] adb           ${adbPath ?? '(PATH)'}`)
    console.log(`[myt] yadb          ${yadbPath ?? '(未配置)'}`)
  },
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void handle.close().then(() => process.exit(0))
  })
}
