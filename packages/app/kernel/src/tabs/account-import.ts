/**
 * 批导入账号的解析规则（**1:1 移植**自 `device_tab.py`）。
 *
 * 5 种模式，每种有自己的行格式；解析失败一律返回 null（旧实现同样跳过该行）。
 */

export type ImportMode = 'sms' | 'bundle' | 'op' | 'v' | 'sid'

export interface ImportedAccount {
  /** 序号（0 起，旧 `import_index`）。 */
  index: number
  /** sms/op/v：原始标识；bundle：zip 路径；sid：sid。 */
  identifier: string
  /** sms：验证码网页链接；其余为空。 */
  url: string
  status: string
  /** 旧 `source_line_text`，回写时用。 */
  sourceLine: string
}

/** 旧格式前缀 `成功--` / `失败--`（parse_account_line 1715-1730）。 */
const LEGACY_PREFIXES = ['成功--', '失败--'] as const

/**
 * 解析 sms 账号行：`手机号----链接[----状态]`。
 *
 * 移植自 `parse_account_line`：
 * - 先剥旧前缀（`成功--`/`失败--`）；
 * - 按 `----` 分割，至少 2 段；
 * - 手机号去空白；第 3 段起作为状态。
 */
export function parseAccountLine(line: string): { status: string; phone: string; url: string } | null {
  const stripped = line.trim()
  if (!stripped) return null

  let status = ''
  let normalized = stripped
  for (const prefix of LEGACY_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      status = prefix.slice(0, -2)
      normalized = normalized.slice(prefix.length).trim()
      break
    }
  }

  const parts = normalized.split('----')
  if (parts.length < 2) return null

  const phone = (parts[0] ?? '').replace(/\s+/g, '')
  const url = (parts[1] ?? '').trim()
  if (!status && parts.length >= 3) status = parts.slice(2).join('----').trim()
  if (!phone || !url) return null
  return { status, phone, url }
}

/**
 * 解析备份包文件名：`name.zip`，支持
 * `名字----成功/失败/绑定失败/之前已绑定` 与 `名字----绑定成功----phone`。
 */
export function parseBundleName(fileName: string): { status: string; baseName: string } | null {
  const normalized = fileName.trim()
  if (!normalized.toLowerCase().endsWith('.zip')) return null
  const stem = normalized.slice(0, -4)

  let status = ''
  let baseName = stem
  for (const candidate of ['成功', '失败', '绑定失败', '之前已绑定']) {
    const marker = `----${candidate}`
    if (stem.includes(marker)) {
      status = candidate
      baseName = stem.slice(0, stem.indexOf(marker))
      break
    }
  }
  if (!baseName) return null
  return { status, baseName }
}

/** 解析 OP / V 数据行：`数据----状态` 或旧前缀。 */
export function parseOpLikeLine(line: string): { status: string; data: string } | null {
  const stripped = line.trim()
  if (!stripped) return null

  let status = ''
  let normalized = stripped
  for (const prefix of LEGACY_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      status = prefix.slice(0, -2)
      normalized = normalized.slice(prefix.length).trim()
      break
    }
  }
  const parts = normalized.split('----')
  const data = (parts[0] ?? '').trim()
  if (!data) return null
  if (parts.length >= 2) status = parts.slice(1).join('----').trim()
  return { status, data }
}

/**
 * 解析 SID 行：`sid----uid` 或纯 `sid`（uid 默认 `"1"`）。
 */
export function parseSidLine(line: string): { status: string; sid: string; uid: string } | null {
  const stripped = line.trim()
  if (!stripped) return null

  let status = ''
  let normalized = stripped
  for (const prefix of LEGACY_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      status = prefix.slice(0, -2)
      normalized = normalized.slice(prefix.length).trim()
      break
    }
  }
  const parts = normalized.split('----')
  const sid = (parts[0] ?? '').trim()
  if (!sid) return null
  const uid = (parts[1] ?? '').trim() || '1'
  return { status, sid, uid }
}

/**
 * 按模式解析整份文本。
 *
 * 与旧实现一致：**逐行解析，失败的行直接跳过**，不做整体校验。
 */
export function parseAccountFile(mode: ImportMode, text: string): ImportedAccount[] {
  const out: ImportedAccount[] = []
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    if (mode === 'sms') {
      const parsed = parseAccountLine(line)
      if (!parsed) continue
      out.push({
        index: out.length,
        identifier: parsed.phone,
        url: parsed.url,
        status: parsed.status,
        sourceLine: `${parsed.phone}----${parsed.url}`,
      })
      continue
    }
    if (mode === 'op' || mode === 'v') {
      const parsed = parseOpLikeLine(line)
      if (!parsed) continue
      out.push({
        index: out.length,
        identifier: parsed.data,
        url: '',
        status: parsed.status,
        sourceLine: parsed.data,
      })
      continue
    }
    if (mode === 'sid') {
      const parsed = parseSidLine(line)
      if (!parsed) continue
      out.push({
        index: out.length,
        identifier: parsed.sid,
        url: parsed.uid,
        status: parsed.status,
        sourceLine: `${parsed.sid}----${parsed.uid}`,
      })
      continue
    }
    // bundle 模式按文件名解析，不走文本。
    const parsed = parseBundleName(line)
    if (!parsed) continue
    out.push({
      index: out.length,
      identifier: line.trim(),
      url: '',
      status: parsed.status,
      sourceLine: parsed.baseName,
    })
  }
  return out
}

/** 按模式给出「未识别到有效数据」的提示（旧实现对应文案）。 */
export function emptyImportHint(mode: ImportMode): string {
  switch (mode) {
    case 'bundle':
      return '未识别到有效 zip 备份包'
    case 'op':
      return '未识别到有效 OP 数据'
    case 'v':
      return '未识别到有效 V跳数据'
    case 'sid':
      return '未识别到有效 SID，格式需为：\nsid----uid 或 sid'
    default:
      return '未识别到有效账号，格式需为：\n手机号----链接'
  }
}
