/**
 * 关键词自动采集（方案 C）。
 *
 * 用户只需标注「我现在在哪个页面」，词由系统统计出来：
 *
 * ```
 * 同一页面抓 N 次（滚动几次再抓）
 *   ↓
 * 稳定词：出现率 ≥ 80% 的 = 界面固定元素（正文文案是随机的，会被筛掉）
 *   ↓
 * 跨页去重：在 2 个以上页面出现的词一律丢弃（全部/视频/消息…）
 *   ↓
 * 产出该页独有的 3–8 个词，写进页面表
 * ```
 *
 * 为什么不能全交给模型：它会列「全部」「照片」这类泛词，还会把正文当关键词，
 * 于是要靠本模块的统计规则来收敛。
 */

/**
 * 一次采样里的一个节点。
 *
 * 只带判定需要的三个字段：文字、控件类型、是否选中。
 * 采集时顺手记下来，才能给用户「状态/控件类型」的建议。
 */
export interface SampleNode {
  text?: string | undefined
  contentDesc?: string | undefined
  className?: string | undefined
  selected?: boolean | undefined
}

/** 一次采样：某个页面上抓到的节点。 */
export interface PageSample {
  /** 页面 id（用户标注）。 */
  pageId: string
  /** 这一次抓到的节点。 */
  texts: readonly (string | SampleNode)[]
}

/** 采集参数。 */
export interface CollectOptions {
  /** 出现率阈值：同一页多次采样里至少这么多次出现才算界面固定元素。默认 0.8。 */
  minRatio?: number
  /** 单个词的最大长度：超过多半是正文。默认 12。 */
  maxLength?: number
  /** 最少字数。默认 2。 */
  minLength?: number
  /** 每个页面最多保留几个词。默认 8。 */
  maxPerPage?: number
}

/** 一次采样的归一化结果：词 → 出现次数。 */
function toNodes(items: readonly (string | SampleNode)[]): SampleNode[] {
  return items.map((item) => (typeof item === 'string' ? { text: item } : item))
}

function countTerms(items: readonly (string | SampleNode)[], opts: Required<CollectOptions>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const raw of toNodes(items).flatMap((node) => [node.text ?? '', node.contentDesc ?? ''])) {
    const term = raw.trim()
    if (term.length < opts.minLength || term.length > opts.maxLength) continue
    // 纯数字/时间/计数点（"20" "16:30"）不是界面特征
    if (/^[\d\s:./-]+$/u.test(term)) continue
    counts.set(term, (counts.get(term) ?? 0) + 1)
  }
  return counts
}

/**
 * 从采样里算出每页的独有词。
 *
 * @param samples - 多次采样（同一页面应有多条）
 * @returns pageId → 关键词数组（已按「跨页去重」过滤）
 */
export function collectKeywords(
  samples: readonly PageSample[],
  options: CollectOptions = {},
): Record<string, string[]> {
  const opts: Required<CollectOptions> = {
    minRatio: options.minRatio ?? 0.8,
    maxLength: options.maxLength ?? 12,
    minLength: options.minLength ?? 2,
    maxPerPage: options.maxPerPage ?? 8,
  }

  // 按页面分组
  const byPage = new Map<string, (readonly (string | SampleNode)[])[]>()
  for (const sample of samples) {
    const list = byPage.get(sample.pageId) ?? []
    list.push([...sample.texts])
    byPage.set(sample.pageId, list)
  }

  // 每页的稳定词：出现率达标
  const stableByPage = new Map<string, Map<string, number>>()
  for (const [pageId, runs] of byPage) {
    const hits = new Map<string, number>()
    for (const texts of runs) {
      for (const [term, count] of countTerms(texts, opts)) {
        hits.set(term, (hits.get(term) ?? 0) + (count > 0 ? 1 : 0))
      }
    }
    const stable = new Map<string, number>()
    for (const [term, appeared] of hits) {
      if (appeared / runs.length >= opts.minRatio) stable.set(term, appeared)
    }
    stableByPage.set(pageId, stable)
  }

  // 跨页去重：出现在 ≥2 个页面的词丢弃
  const pageCount = new Map<string, number>()
  for (const stable of stableByPage.values()) {
    for (const term of stable.keys()) pageCount.set(term, (pageCount.get(term) ?? 0) + 1)
  }

  const result: Record<string, string[]> = {}
  for (const [pageId, stable] of stableByPage) {
    const unique = [...stable.entries()]
      .filter(([term]) => (pageCount.get(term) ?? 0) === 1)
      // 出现率高的优先，其次按长度（短的更像标签）
      .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
      .slice(0, opts.maxPerPage)
      .map(([term]) => term)
    result[pageId] = unique
  }
  return result
}

/**
 * 判断采集结果是否可信。
 *
 * 词太少（0–1 个）说明这个页面几乎没文字，关键词方案对它无效，
 * 应提示用户改用 Activity 或视觉兜底。
 */
export function assessCollection(keywords: readonly string[]): {
  ok: boolean
  reason?: string
} {
  if (keywords.length === 0) return { ok: false, reason: '没有采到任何独有词：该页可能是纯图片页，建议用 Activity 或视觉兜底' }
  if (keywords.length < 2) return { ok: false, reason: '只采到 1 个词，容易误判，建议再采集几次或补一个词' }
  return { ok: true }
}


/** 单个关键词的采集建议。 */
export interface KeywordHint {
  keyword: string
  /** 采到的所有出现位置里，是否有「选中」的节点。 */
  onSelected: boolean
  /** 出现过的控件类型（去重，最多几个）。 */
  classes: string[]
}

/**
 * 根据采样给出「状态 / 控件类型」的建议。
 *
 * 目的：用户在 tab 页采集时，采到的词大多位于**选中节点**上——
 * 这时应建议加 `keywordStates: ['selected']`，否则这些词在别的 tab 也会命中。
 *
 * @param samples - 同一页面的多次采样
 * @param keywords - 已经算出来的关键词
 */
export function suggestKeywordHints(
  samples: readonly PageSample[],
  keywords: readonly string[],
): KeywordHint[] {
  const nodes = samples.flatMap((sample) => toNodes(sample.texts))
  return keywords.map((keyword) => {
    const hits = nodes.filter((node) =>
      (node.text ?? '').includes(keyword) || (node.contentDesc ?? '').includes(keyword),
    )
    const classes = [...new Set(hits.map((n) => n.className ?? '').filter(Boolean))].slice(0, 3)
    return {
      keyword,
      onSelected: hits.some((node) => node.selected === true),
      classes,
    }
  })
}
