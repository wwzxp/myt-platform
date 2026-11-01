/**
 * 跨语言关键词对齐。
 *
 * 问题：页面表里的关键词是**中文**，但 App 切成英文后 XML 里全是英文，
 * 字符串比对必然失败。
 *
 * 做法：不让模型「判断页面」，只让它干一件有明确输入输出的事——
 * **把英文界面词对到我们的中文词表上**：
 *
 * ```
 * 中文词表 ──┐
 *            ├─→ 对齐表 { Crop→裁切, Likes→赞过, Market→市集 } ─→ 确定性匹配
 * 英文接口词 ─┘
 * ```
 *
 * 为什么不直接让模型判断：实测同一批用例，「模型直接选页面」3/5、
 * 且会编造没给出的词；「先对齐再匹配」5/5，且对齐表可人工审查。
 * 对齐一次后即可缓存，运行时零模型调用。
 *
 * 详见 `docs/spec/page-identify-design.md`。
 */

/** 一张对齐表：界面语言里的词 → 中文词表里的词。 */
export type AlignTable = Record<string, string>

/**
 * 生成对齐用的提示词。
 *
 * 约束要点：
 * - 候选中文词**只能从词表里选**，避免模型自造词；
 * - 没有对应的写「无」，明确拒绝硬凑；
 * - 只输出 `英文=中文`，不给推理空间。
 */
export function buildAlignPrompt(terms: readonly string[], zhWords: readonly string[]): string {
  const uniqTerms = [...new Set(terms.map((t) => t.trim()).filter(Boolean))]
  const uniqZh = [...new Set(zhWords.map((t) => t.trim()).filter(Boolean))]
  return `下面是一组界面上的英文词，和一组中文界面词。请找出英文词对应的中文词。

英文词：
${uniqTerms.join(', ')}

中文词（只能从这里选，没有对应的就写「无」）：
${uniqZh.join(', ')}

输出格式，每行一条，只输出有对应的：
英文词=中文词`
}

/**
 * 解析模型输出为对齐表。
 *
 * 容错：模型可能用全角冒号、加空格、加项目符号；没有对应的行直接丢弃。
 */
export function parseAlignTable(raw: string): AlignTable {
  const table: AlignTable = {}
  for (const line of raw.split(/\r?\n/u)) {
    const cleaned = line.replace(/^\s*[-*•\d.]+[).]?\s*/u, '').replace(/[：:]/gu, '=')
    const match = /^(.+?)=(.+)$/u.exec(cleaned)
    if (!match) continue
    const term = match[1]?.trim()
    const zh = match[2]?.trim()
    if (!term || !zh) continue
    // 「无 / 没有 / N/A」表示没有对应，不入表。
    if (/^(无|没有|none|n\/a|-)$/iu.test(zh)) continue
    // 值必须是一个短词，防止模型把解释塞进来。
    if (term.length > 40 || zh.length > 20) continue
    table[term.toLowerCase()] = zh
  }
  return table
}

/**
 * 用对齐表把一段界面文字翻译成中文词。
 *
 * 匹配是**整词包含**：界面上的「Live Photos」含 `live photos` 即命中。
 * 转不出来的词直接跳过——少几个词不影响判定，编造才会。
 */
export function translateTerms(terms: readonly string[], table: AlignTable): string[] {
  const out: string[] = []
  for (const term of terms) {
    const key = term.trim().toLowerCase()
    if (!key) continue
    const hit = table[key]
    if (hit) out.push(hit)
  }
  return out
}
