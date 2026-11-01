/**
 * 页面关键词采集 API 客户端。
 *
 * 对应内核 `POST /api/pages/collect`：让设备停在某个页面，抓几次、滚动几次，
 * 由内核统计出该页的独有词。前端只负责选设备、发起、把结果填回输入框。
 */

const KERNEL_BASE: string =
  (import.meta as unknown as { env?: Record<string, string> }).env?.['VITE_KERNEL_BASE'] ?? ''

/** 单个关键词的采集建议（哪些词出现在选中节点上、控件类型是什么）。 */
export interface KeywordHint {
  keyword: string
  onSelected: boolean
  classes: string[]
}

/** 采集结果。 */
export interface CollectResult {
  pageId: string
  keywords: string[]
  /** 每个关键词的线索，用于给「状态 / 控件类型」提建议。 */
  hints?: KeywordHint[]
  /** 每次采样各抓到多少条文字。 */
  sampleSizes: number[]
  /** 不可信时的原因（词太少等）。 */
  warning?: string
}

/**
 * 采集某个页面的关键词。
 *
 * @param serial - 设备序列号（`host:port`，来自 `listSelectableDevices`）
 * @param pageId - 页面 id（与页面表里的一致）
 * @param samples - 采样次数，默认 3
 */
export async function collectPageKeywords(
  serial: string,
  pageId: string,
  samples = 3,
): Promise<CollectResult> {
  const response = await fetch(`${KERNEL_BASE}/api/pages/collect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ serial, pageId, samples }),
  })
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // 响应体不是 JSON：保留状态码
    }
    throw new Error(message)
  }
  return (await response.json()) as CollectResult
}
