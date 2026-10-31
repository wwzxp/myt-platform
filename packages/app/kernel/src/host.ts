import { fileURLToPath } from 'node:url'
import { startKernel } from './kernel.ts'
import { getParentPort } from './parent-port.ts'

/**
 * Electron utilityProcess 入口。
 *
 * 与 `main.ts` 的差别只有两点：配置来自 `process.env`（壳写入），
 * 就绪后通过父端口上报端口，壳据此加载页面。
 */
const parentPort = getParentPort()

const port = Number(process.env['MYT_PORT'] ?? 0)
const sdkBase = process.env['MYT_SDK_BASE'] ?? 'http://127.0.0.1:7878'
const hosts = (process.env['MYT_HOSTS'] ?? '192.168.0.113')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0)

const stateFile =
  process.env['MYT_STATE_FILE'] ??
  fileURLToPath(new URL('../../../../data/devices.json', import.meta.url))
const uiDir = process.env['MYT_UI_DIR'] ?? fileURLToPath(new URL('../../../client/ui/', import.meta.url))
const adbPath = process.env['MYT_ADB_PATH'] || undefined
const yadbPath = process.env['MYT_YADB_PATH'] || undefined
const adbKeyboardApk = process.env['MYT_ADB_KEYBOARD_APK'] || undefined
/** 机型库 JSON（旧 `static/devices.json`，随 resources/tools 分发）。 */
const devicesJson = process.env['MYT_DEVICES_JSON'] || undefined
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
  devicesJson,
  seed,
  onReady: ({ port: listening, host }) => {
    parentPort?.postMessage({ type: 'kernel/ready', port: listening, host })
    console.log(`[myt] kernel ready  http://${host}:${listening}`)
    console.log(`[myt] adb=${adbPath ?? '(PATH)'} yadb=${yadbPath ?? '(未配置)'}`)
  },
})

parentPort?.on('message', (event) => {
  if (event.data?.type === 'kernel/shutdown') {
    void handle.close().then(() => process.exit(0))
  }
})

process.on('uncaughtException', (error) => {
  parentPort?.postMessage({ type: 'kernel/fatal', message: String(error?.stack ?? error) })
})
