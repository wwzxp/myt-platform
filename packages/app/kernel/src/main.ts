import { fileURLToPath } from 'node:url'
import { startKernel } from './kernel.ts'

const port = Number(process.env['MYT_PORT'] ?? 7788)
const sdkBase = process.env['MYT_SDK_BASE'] ?? 'http://127.0.0.1:7878'
const hosts = (process.env['MYT_HOSTS'] ?? '192.168.0.113')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0)

const stateFile = fileURLToPath(new URL('../../../../data/devices.json', import.meta.url))
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
