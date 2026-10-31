/**
 * 版本检查（移植自 `tools/update_checker.py`，65 行）。
 *
 * 协议：`GET {server}/api/update/{软件名}?version={当前版本}`
 * 响应：`{has_update, software_name, updates:[{latest_version,title,changelog,publish_at}]}`
 *
 * 旧实现把各类异常映射成中文错误文案（超时 / 连不上 / JSON 异常 / 其它），
 * 这里保持同样的分类与措辞。
 */

/** 旧 `SOFTWARE_NAME`。 */
export const SOFTWARE_NAME = '小红书自动化工具'
/** 旧 `SOFTWARE_VERSION`。 */
export const SOFTWARE_VERSION = '1.3.4'

/** 单条更新。 */
export interface UpdateInfo {
  latestVersion: string
  title: string
  changelog: string
  publishAt: string
}

/** 检查结果。 */
export interface UpdateResult {
  hasUpdate: boolean
  softwareName: string
  updates: UpdateInfo[]
  /** 有错误时非空；此时 `updates` 为空。 */
  error: string
}

/**
 * 检查更新（旧 `check_updates`）。
 *
 * @param serverUrl 更新服务器地址；空串直接返回「未配置服务器地址」
 * @param version 当前版本；缺省用 `SOFTWARE_VERSION`
 */
export async function checkUpdates(
  serverUrl: string,
  version?: string,
  options: { timeoutMs?: number; softwareName?: string } = {},
): Promise<UpdateResult> {
  const softwareName = options.softwareName ?? SOFTWARE_NAME
  const empty: UpdateResult = { hasUpdate: false, softwareName, updates: [], error: '' }

  if (!serverUrl.trim()) return { ...empty, error: '未配置服务器地址' }

  const ver = version ?? SOFTWARE_VERSION
  const url = `${serverUrl.replace(/\/+$/, '')}/api/update/${encodeURIComponent(softwareName)}?version=${encodeURIComponent(ver)}`

  let payload: unknown
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) })
    if (!res.ok) return { ...empty, error: `检查更新失败: HTTP ${res.status}` }
    payload = await res.json()
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    // 旧版按异常类型分三类文案。
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ...empty, error: '请求超时，请稍后重试' }
    }
    if (name === 'TypeError') {
      // fetch 的网络错误在 Node 里是 TypeError（旧版是 ConnectionError）。
      return { ...empty, error: '无法连接更新服务器' }
    }
    if (error instanceof SyntaxError) {
      return { ...empty, error: '服务器返回异常' }
    }
    return {
      ...empty,
      error: `检查更新失败: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (!payload || typeof payload !== 'object') {
    return { ...empty, error: '服务器返回异常' }
  }
  const data = payload as Record<string, unknown>
  const rawUpdates = Array.isArray(data['updates']) ? (data['updates'] as unknown[]) : []

  const updates: UpdateInfo[] = rawUpdates
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      latestVersion: String(item['latest_version'] ?? ''),
      title: String(item['title'] ?? ''),
      changelog: String(item['changelog'] ?? ''),
      publishAt: String(item['publish_at'] ?? ''),
    }))

  return {
    hasUpdate: Boolean(data['has_update'] ?? false),
    softwareName: String(data['software_name'] ?? softwareName),
    updates,
    error: '',
  }
}
