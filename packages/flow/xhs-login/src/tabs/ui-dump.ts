/**
 * UI XML 落盘（移植自 `ui_dump.py` 26 行）。
 *
 * 用途单一：**排查用**。把当前 UI 树原样写到 `logs/ui_dump/`，
 * 文件名 `{serial}_{tag}_{YYYYMMDD_HHMMSS}.xml`（旧版同样格式）。
 *
 * 失败不抛：落盘是辅助能力，不能因为它中断业务（旧版 `except` 后返回 None）。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * logs 基准目录（旧 `logs_base_dir`）。
 *
 * 旧版：打包后取 exe 同级 `logs/`，源码运行取项目根 `logs/`。
 * 本版由调用方传入基准目录（Electron 下应是 `APPDATA/myt-desktop/logs`）。
 */
export function logsBaseDir(baseDir: string): string {
  return join(baseDir, 'logs')
}

/** 时间戳格式 `YYYYMMDD_HHMMSS`（旧 `time.strftime`）。 */
function timestamp(date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  )
}

/**
 * 把 UI XML 原样落盘（旧 `save_ui_dump`）。
 *
 * @param baseDir logs 的基准目录（不含 `logs` 一层时传父目录）
 * @returns 文件路径；失败返回 null（不抛）
 */
export async function saveUiDump(
  baseDir: string,
  serial: string,
  xml: string,
  tag: string,
  options: { logger?: (line: string) => void } = {},
): Promise<string | null> {
  const log = options.logger ?? (() => {})
  try {
    const dumpDir = join(logsBaseDir(baseDir), 'ui_dump')
    await mkdir(dumpDir, { recursive: true })
    const safeSerial = String(serial).replace(/:/g, '_')
    const path = join(dumpDir, `${safeSerial}_${tag}_${timestamp()}.xml`)
    await writeFile(path, xml ?? '', 'utf8')
    log(`[UI落盘] ${path}`)
    return path
  } catch (error) {
    // 落盘失败不影响业务（旧版同样只打日志）。
    log(`[UI落盘失败] ${tag}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}
