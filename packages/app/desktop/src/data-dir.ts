import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 数据目录解析。
 *
 * 用户明确要求**不默认存 C 盘**（Electron 的 `app.getPath('userData')`
 * 落在 `C:\Users\<user>\AppData\Roaming\<app>`）。
 *
 * 解析优先级（从高到低）：
 *
 * | # | 来源 | 场景 |
 * |---|---|---|
 * | 1 | 环境变量 `MYT_DATA_DIR` | 开发期 / 高级用户 |
 * | 2 | `myt.config.json` 里的 `dataDir` | 打包后用户已选过 |
 * | 3 | 用户首次运行时选择的路径 | 弹窗 |
 * | 4 | **安装目录下的 `data/`** | 便携版（目录可写时） |
 * | 5 | `userData` | 最后兜底（不可写时），并提示用户改到其它盘 |
 */

/** 配置文件里保存的内容。 */
export interface DataDirConfig {
  /** 用户选择的数据目录（绝对路径）。 */
  dataDir?: string
  /** 用户是否跳过了首次选择（不再弹窗）。 */
  skipped?: boolean
}

export interface ResolveOptions {
  /** 环境变量表（默认 `process.env`）。 */
  env?: NodeJS.ProcessEnv
  /** 配置文件所在目录（通常是 Electron `userData`）。 */
  configDir: string
  /** 安装目录（便携版数据放在它的 `data/` 下）。 */
  installDir: string
  /** 兜底目录（Electron `userData`）。 */
  fallbackDir: string
  /** 可用盘符探测（默认查 Windows 的 D:/E:/F:）。 */
  availableDrives?: () => string[]
  /** 目录是否可写。 */
  isWritable?: (dir: string) => boolean
}

/** 解析结果。 */
export interface ResolvedDataDir {
  /** 最终使用的数据目录（绝对路径）。 */
  dir: string
  /** 这个目录是怎么来的（用于界面提示）。 */
  source: 'env' | 'config' | 'install' | 'fallback'
  /**
   * 是否在系统盘（C 盘）。
   *
   * 为 `true` 时界面必须显示橙色提示，引导用户改到其它盘。
   */
  onSystemDrive: boolean
  /** 首次运行的建议路径（弹窗预填）。 */
  suggested: string
  /** 是否需要弹窗询问（env/config 已指定时不需要）。 */
  needsPrompt: boolean
}

const CONFIG_FILE = 'myt.config.json'

/**
 * 解析数据目录。
 *
 * 纯函数式：所有外部依赖（env、盘符探测、可写检测）都可注入，便于测试。
 */
export function resolveDataDir(options: ResolveOptions): ResolvedDataDir {
  const env = options.env ?? process.env
  const drives = options.availableDrives ?? defaultAvailableDrives
  const writable = options.isWritable ?? defaultIsWritable

  const suggested = join(firstNonSystemDrive(drives) ?? options.fallbackDir, 'MYT')

  // 1) 环境变量
  const fromEnv = env['MYT_DATA_DIR']?.trim()
  if (fromEnv) {
    return {
      dir: fromEnv,
      source: 'env',
      onSystemDrive: isSystemDrive(fromEnv),
      suggested,
      needsPrompt: false,
    }
  }

  // 2) 配置文件
  const config = readConfig(options.configDir)
  if (config.dataDir && config.dataDir.trim().length > 0) {
    return {
      dir: config.dataDir,
      source: 'config',
      onSystemDrive: isSystemDrive(config.dataDir),
      suggested,
      needsPrompt: false,
    }
  }

  // 3) 便携版：安装目录可写时用 `installDir/data`
  const portable = join(options.installDir, 'data')
  if (writable(options.installDir)) {
    return {
      dir: portable,
      source: 'install',
      onSystemDrive: isSystemDrive(portable),
      suggested,
      needsPrompt: config.skipped !== true,
    }
  }

  // 4) 兜底：userData（可能在 C 盘）
  return {
    dir: options.fallbackDir,
    source: 'fallback',
    onSystemDrive: isSystemDrive(options.fallbackDir),
    suggested,
    needsPrompt: config.skipped !== true,
  }
}

/** 读取配置文件；缺失或损坏时返回空对象。 */
export function readConfig(configDir: string): DataDirConfig {
  try {
    const raw = readFileSync(join(configDir, CONFIG_FILE), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: DataDirConfig = {}
    if (typeof parsed['dataDir'] === 'string') result.dataDir = parsed['dataDir']
    if (typeof parsed['skipped'] === 'boolean') result.skipped = parsed['skipped']
    return result
  } catch {
    return {}
  }
}

/** 写入配置（原子写：先写 tmp 再 rename，避免写一半留下残文件）。 */
export function writeConfig(configDir: string, config: DataDirConfig): void {
  mkdirSync(configDir, { recursive: true })
  const target = join(configDir, CONFIG_FILE)
  const tmp = `${target}.tmp`
  const payload: Record<string, unknown> = {}
  if (config.dataDir !== undefined) payload['dataDir'] = config.dataDir
  if (config.skipped !== undefined) payload['skipped'] = config.skipped
  writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
  renameSync(tmp, target)
}

/**
 * 路径是否在系统盘（Windows 的 C 盘）。
 *
 * 非 Windows 一律返回 `false`——用户说的「C 盘」是 Windows 语境。
 */
export function isSystemDrive(path: string): boolean {
  if (process.platform !== 'win32') return false
  return /^c:/iu.test(path)
}

/** 探测可用盘符（Windows）。 */
function defaultAvailableDrives(): string[] {
  if (process.platform !== 'win32') return []
  const candidates = ['D:', 'E:', 'F:', 'G:']
  return candidates.filter((drive) => existsSync(`${drive}\\`))
}

/** 第一个非系统盘；没有则返回 `undefined`。 */
function firstNonSystemDrive(drives: () => string[]): string | undefined {
  return drives().find((drive) => !isSystemDrive(drive))
}

/** 目录是否可写（创建探针文件后删除）。 */
function defaultIsWritable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, `.write-probe-${Date.now()}`)
    writeFileSync(probe, '', 'utf8')
    rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
}
