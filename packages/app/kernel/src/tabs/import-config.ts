/**
 * 批导入账号配置（移植自 `AccountImportDialog.values()` + `device_tab.py:3745-3795`）。
 *
 * 旧版 `values()` 返回 20 个字段，调用方逐个赋给 `self.*`；其中三项还会
 * **回写磁盘 txt**（`_sync_all_accounts_to_file` / `_sync_nickname_txt` / `_sync_proxy_txt`）。
 *
 * 本版把这份状态落盘为 `import-config.json`，让「保存」不再随刷新丢失。
 */

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/** 账号条目（旧 `ImportedAccountState` 的关键字段）。 */
export interface ImportedAccount {
  /** 序号（旧 `import_index`）。 */
  importIndex: number
  phone: string
  url: string
  /** 旧 `status_text`：空 / 成功 / 失败 / 之前已绑定。 */
  statusText: string
  /** 分配到的设备序列号。 */
  assignedDeviceSerial: string
  /** 原始行序号与原文（导出时保留）。 */
  sourceLineIndex: number
  sourceLineText: string
  /** 来源 txt 路径（回写状态用；bundle 模式为空）。 */
  filePath?: string
}

/** 头像/昵称/代理条目（旧用 dict，字段名保持一致）。 */
export interface NamedEntry {
  value: string
  status?: string
  [extra: string]: unknown
}

/** 一键新机机型条目。 */
export interface ResetModelEntry {
  brand: string
  model: string
}

/** 批导入账号的完整配置（对应旧 `values()` 的 20 个字段）。 */
export interface ImportConfig {
  /** 登录模式：sms / bundle / op / v / sid。 */
  importMode: string
  /** 区号（旧 `account_area_code`，默认 +1）。 */
  areaCode: string
  /** 账号文件路径。 */
  filePath: string
  /** 账号列表。 */
  accounts: ImportedAccount[]

  /** 头像列表。 */
  avatars: NamedEntry[]
  /** 昵称列表。 */
  nicknames: NamedEntry[]
  /** 昵称文件路径。 */
  nicknameFilePath: string
  /** 代理列表。 */
  proxies: NamedEntry[]
  /** 代理文件路径。 */
  proxyFilePath: string
  /** 代理「N 机」。 */
  proxyMachine: number
  /** 代理「N ip」。 */
  proxyIpCount: number

  /** 一键新机模式：random / specified。 */
  resetDeviceMode: string
  /** 海外随机。 */
  resetDeviceOverseasRandom: boolean
  /** 指定机型列表。 */
  resetDeviceBrandModels: ResetModelEntry[]

  /** 关注的小红书号列表。 */
  followUserIds: string[]
  /** 关注数量。 */
  followCount: number

  /** 绑定账号列表。 */
  bindAccounts: ImportedAccount[]
  /** 绑定账号文件路径。 */
  bindAccountFilePath: string

  /** HeroSMS 启用。 */
  heroSmsEnabled: boolean
  heroSmsApiKey: string
  heroSmsCountryId: number | null
  heroSmsCountryCode: string
  heroSmsMaxPrice: number | null
}

/** 默认值（照旧版 `AccountImportDialog.__init__` 的默认）。 */
export function defaultImportConfig(): ImportConfig {
  return {
    importMode: 'sms',
    areaCode: '+1',
    filePath: '',
    accounts: [],
    avatars: [],
    nicknames: [],
    nicknameFilePath: '',
    proxies: [],
    proxyFilePath: '',
    proxyMachine: 1,
    proxyIpCount: 1,
    resetDeviceMode: 'random',
    resetDeviceOverseasRandom: true,
    resetDeviceBrandModels: [],
    followUserIds: [],
    followCount: 1,
    bindAccounts: [],
    bindAccountFilePath: '',
    heroSmsEnabled: false,
    heroSmsApiKey: '',
    heroSmsCountryId: null,
    heroSmsCountryCode: '',
    heroSmsMaxPrice: null,
  }
}

/** 校验并补默认值（旧 `values()` 里逐个 `str()/int()/bool()` 的等价物）。 */
export function normalizeImportConfig(raw: unknown): ImportConfig {
  const base = defaultImportConfig()
  if (!raw || typeof raw !== 'object') return base
  const input = raw as Record<string, unknown>

  const text = (key: string, fallback: string): string => {
    const value = input[key]
    return typeof value === 'string' ? value : fallback
  }
  const int = (key: string, fallback: number): number => {
    const value = Number(input[key])
    return Number.isFinite(value) ? Math.trunc(value) : fallback
  }
  const bool = (key: string, fallback: boolean): boolean => {
    const value = input[key]
    return typeof value === 'boolean' ? value : fallback
  }
  const arr = <T>(key: string): T[] => (Array.isArray(input[key]) ? (input[key] as T[]) : [])

  return {
    importMode: text('importMode', base.importMode),
    areaCode: text('areaCode', base.areaCode) || base.areaCode,
    filePath: text('filePath', base.filePath),
    accounts: arr<ImportedAccount>('accounts'),
    avatars: arr<NamedEntry>('avatars'),
    nicknames: arr<NamedEntry>('nicknames'),
    nicknameFilePath: text('nicknameFilePath', base.nicknameFilePath),
    proxies: arr<NamedEntry>('proxies'),
    proxyFilePath: text('proxyFilePath', base.proxyFilePath),
    proxyMachine: int('proxyMachine', base.proxyMachine) || 1,
    proxyIpCount: int('proxyIpCount', base.proxyIpCount) || 1,
    resetDeviceMode: text('resetDeviceMode', base.resetDeviceMode) || base.resetDeviceMode,
    resetDeviceOverseasRandom: bool('resetDeviceOverseasRandom', base.resetDeviceOverseasRandom),
    resetDeviceBrandModels: arr<ResetModelEntry>('resetDeviceBrandModels'),
    followUserIds: arr<string>('followUserIds'),
    followCount: int('followCount', base.followCount) || 1,
    bindAccounts: arr<ImportedAccount>('bindAccounts'),
    bindAccountFilePath: text('bindAccountFilePath', base.bindAccountFilePath),
    heroSmsEnabled: bool('heroSmsEnabled', base.heroSmsEnabled),
    heroSmsApiKey: text('heroSmsApiKey', base.heroSmsApiKey),
    heroSmsCountryId: input['heroSmsCountryId'] === null || input['heroSmsCountryId'] === undefined
      ? null
      : int('heroSmsCountryId', 0),
    heroSmsCountryCode: text('heroSmsCountryCode', base.heroSmsCountryCode),
    heroSmsMaxPrice: input['heroSmsMaxPrice'] === null || input['heroSmsMaxPrice'] === undefined
      ? null
      : Number(input['heroSmsMaxPrice']),
  }
}

/**
 * 配置存储：`import-config.json`，原子写。
 *
 * 旧版这些字段全在内存，程序退出即丢；落盘是本版新增（与 `device-sources.json` 同一决策）。
 */
export class ImportConfigStore {
  private readonly file: string
  private cached: ImportConfig | null = null

  constructor(file: string) {
    this.file = file
  }

  /** 读配置；文件不存在或损坏时返回默认值。 */
  async load(): Promise<ImportConfig> {
    if (this.cached) return { ...this.cached }
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as unknown
      this.cached = normalizeImportConfig(parsed)
    } catch {
      this.cached = defaultImportConfig()
    }
    return { ...this.cached }
  }

  /** 写配置（原子写：先 tmp 再 rename）。 */
  async save(raw: unknown): Promise<ImportConfig> {
    const next = normalizeImportConfig(raw)
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
    await rename(tmp, this.file)
    this.cached = next
    return { ...next }
  }
}

/* ─────────────── 源文件回写（旧 _sync_* 系列） ─────────────── */

/** 只有这些状态会被写回源文件（旧 `_WRITEABLE_STATUSES`）。 */
export const WRITEABLE_STATUSES = new Set(['成功', '失败', '绑定失败', '之前已绑定'])

/** 昵称/代理「已使用」前缀（旧 `PREFIX = "已使用--"`）。 */
export const USED_PREFIX = '已使用--'

/**
 * 格式化一行账号（旧 `_format_account_source_line`）。
 *
 * 状态可写时追加 `----{status}`；`绑定成功----<手机号>` 也追加。
 * 其余状态（如待导入）保持原行。
 */
export function formatAccountSourceLine(account: ImportedAccount): string {
  const baseLine = account.sourceLineText.trim() || `${account.phone}--${account.url}`
  const status = account.statusText.trim()
  if (WRITEABLE_STATUSES.has(status) || status.startsWith('绑定成功----')) {
    return `${baseLine}----${status}`
  }
  return baseLine
}

/**
 * 回写单个账号状态到源 txt（旧 `sync_imported_account_status_to_file`）。
 *
 * 两种模式：
 * - **bundle**：不写 txt，而是**重命名 zip**（追加 `----成功` 等后缀）。
 * - 其它（sms/op/v/sid）：按 `sourceLineIndex` 替换对应行，保留原行尾换行。
 *
 * @returns 是否写成功（文件不存在或行号越界返回 false，不抛）
 */
export async function syncAccountStatusToFile(account: ImportedAccount): Promise<boolean> {
  // bundle 模式：改文件名（旧版会 rename 并更新 account.url）。
  if (account.url.toLowerCase().endsWith('.zip')) {
    const info = await stat(account.url).catch(() => null)
    if (!info) return false

    const baseName = account.sourceLineText.trim() || basename(account.url).replace(/\.zip$/i, '')
    const status = account.statusText.trim()
    let suffix = ''
    if (status.startsWith('绑定成功----')) {
      const phone = status.split('----')[1] ?? ''
      suffix = phone ? `----绑定成功----${phone}` : '----绑定成功'
    } else if (WRITEABLE_STATUSES.has(status)) {
      suffix = `----${status}`
    }
    const target = join(dirname(account.url), `${baseName}${suffix}.zip`)
    if (target === account.url) return true
    await rename(account.url, target)
    account.url = target
    account.sourceLineText = `${baseName}${suffix}`
    return true
  }

  const filePath = String((account as unknown as { filePath?: string }).filePath ?? '').trim()
  if (!filePath || account.sourceLineIndex < 0) return false
  return rewriteLine(filePath, account.sourceLineIndex, formatAccountSourceLine(account))
}

/** 替换文件中的某一行，保留原行尾换行（旧 `sync_*_to_file` 的共同逻辑）。 */
async function rewriteLine(filePath: string, lineIndex: number, next: string): Promise<boolean> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch {
    return false
  }
  const lines = text.split(/\r?\n/)
  // 尾部空串来自结尾换行，不计入行数。
  const trailingNewline = text.endsWith('\n') || text.endsWith('\r')
  const realLines = trailingNewline ? lines.slice(0, -1) : lines
  if (lineIndex >= realLines.length) return false
  realLines[lineIndex] = next
  const out = realLines.join('\n') + (trailingNewline ? '\n' : '')
  try {
    await writeFile(filePath, out, 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * 批量回写所有账号（旧 `_sync_all_accounts_to_file`）。
 *
 * 逐行替换，一次写盘；任何异常静默忽略（旧版 `except OSError: pass`）。
 */
export async function syncAllAccountsToFile(
  filePath: string,
  accounts: ImportedAccount[],
): Promise<boolean> {
  if (!filePath) return false
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch {
    return false
  }
  const trailingNewline = text.endsWith('\n') || text.endsWith('\r')
  const lines = text.split(/\r?\n/)
  const realLines = trailingNewline ? lines.slice(0, -1) : lines

  for (const account of accounts) {
    if (account.sourceLineIndex < 0 || account.sourceLineIndex >= realLines.length) continue
    realLines[account.sourceLineIndex] = formatAccountSourceLine(account)
  }
  try {
    await writeFile(filePath, realLines.join('\n') + (trailingNewline ? '\n' : ''), 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * 昵称 txt 回写（旧 `_sync_nickname_txt`）。
 *
 * 已使用的加 `已使用--` 前缀；已带前缀但不再使用的**去掉**前缀。
 */
export async function syncNicknameTxt(
  filePath: string,
  nicknames: NamedEntry[],
): Promise<boolean> {
  if (!filePath) return false
  const used = new Set(nicknames.filter((n) => n.status).map((n) => String(n.value ?? '')))
  return rewritePrefixed(filePath, used, (body, isUsed) => {
    if (isUsed) return `${USED_PREFIX}${body}`
    return body
  })
}

/**
 * 代理 txt 回写（旧 `_sync_proxy_txt`）。
 *
 * 有 status 时写成 `{status}--{body}`；无 status 时只写 body（去掉旧前缀）。
 */
export async function syncProxyTxt(
  filePath: string,
  proxies: NamedEntry[],
): Promise<boolean> {
  if (!filePath) return false
  const statusMap = new Map<string, string>()
  for (const proxy of proxies) {
    const ip = String(proxy['proxy_ip'] ?? proxy.value ?? '')
    if (ip) statusMap.set(ip, String(proxy.status ?? ''))
  }
  return rewritePrefixed(filePath, new Set(), (body) => {
    const status = statusMap.get(body) ?? ''
    return status ? `${status}--${body}` : body
  })
}

/** 通用「带前缀行」重写（昵称/代理共用）。 */
async function rewritePrefixed(
  filePath: string,
  usedSet: Set<string>,
  build: (body: string, isUsed: boolean) => string,
): Promise<boolean> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch {
    return false
  }
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  for (const line of lines) {
    const stripped = line.trim()
    if (!stripped) {
      out.push(stripped)
      continue
    }
    const hasPrefix = stripped.startsWith(USED_PREFIX)
    const body = hasPrefix ? stripped.slice(USED_PREFIX.length).trim() : stripped
    const isUsed = hasPrefix ? usedSet.has(body) : usedSet.has(body)
    out.push(build(body, isUsed))
  }
  try {
    await writeFile(filePath, out.join('\n'), 'utf8')
    return true
  } catch {
    return false
  }
}


/** 绑定账号分配结果。 */
export interface BindAssignment {
  /** 分配到的账号（null 表示没有可用的）。 */
  account: ImportedAccount | null
  /** 账号在 `bindAccounts` 里的下标。 */
  index: number
}

/**
 * 分配一个未使用的绑定账号（旧 `find_imported_bind_account_by_index` 的反向操作）。
 *
 * 旧版从 `imported_bind_accounts` 里挑 `is_unused()` 的第一个：
 * `not status_text and active_job_id is None`。
 */
export function pickUnusedBindAccount(config: ImportConfig): BindAssignment {
  for (let i = 0; i < config.bindAccounts.length; i += 1) {
    const account = config.bindAccounts[i]!
    if (!account.statusText.trim() && !account.assignedDeviceSerial) {
      return { account, index: i }
    }
  }
  return { account: null, index: -1 }
}

/**
 * 更新绑定账号状态并回写源文件（旧 `_sync_bind_account_status_to_file`）。
 *
 * 旧版两种终态：
 * - 成功 → `status_text = "成功"`
 * - 已绑定 → `status_text = ""`（清空，账号可再用）
 *
 * @returns 更新后的配置
 */
export async function updateBindAccountStatus(
  store: ImportConfigStore,
  index: number,
  statusText: string,
  deviceSerial: string,
): Promise<ImportConfig> {
  const config = await store.load()
  const target = config.bindAccounts[index]
  if (!target) return config

  target.statusText = statusText
  target.assignedDeviceSerial = statusText ? deviceSerial : ''

  // 回写源 txt（旧 `_sync_bind_account_status_to_file`）。
  if (config.bindAccountFilePath) {
    const line = formatAccountSourceLine(target)
    await rewriteLineExported(config.bindAccountFilePath, target.sourceLineIndex, line)
  }
  return store.save(config)
}

/** 导出给 kernel 用的行重写（复用内部实现）。 */
export const rewriteLineExported = rewriteLine
