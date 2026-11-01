/**
 * 截图读字（L2 兜底）。
 *
 * 用途：XML 抓不到文字时（纯图片页、控件被混淆），让视觉模型把界面上
 * 的**文字读出来**，再交给关键词匹配——注意模型只负责「读」，
 * 判断页面仍由确定性匹配完成。
 *
 * 实测（`docs/spec/page-identify-experiment.md`）：
 * - 让模型直接「选页面」在相似页上全错（image-editor/review/preview 都答 preview）；
 * - 改成「先读字再匹配」后三个难例全对。
 * - 缩放 50% 是性价比拐点：能读工具栏，约 7 秒；30% 读不了小字；100% 无额外收益。
 */

/**
 * 视觉模型调用：提示词 + 图片（base64 PNG）。
 *
 * 不能用现有的 `(prompt: string) => Promise<string>`——那个只发纯文本，
 * 图片塞进字符串里模型是收不到的。需要 provider 提供多模态通道。
 */
export type VisionModel = (prompt: string, imageBase64: string) => Promise<string>

/**
 * 读字提示词。
 *
 * 三个约束都来自实测：
 * - 「完整列出」：不加这句模型会漏掉部分按钮；
 * - 「不要编号」：加了编号会污染后续关键词匹配；
 * - **不要要求计数**：模型会为了自洽而少报。
 */
export const OCR_PROMPT =
  '完整列出这张手机截图上的所有文字，不要遗漏任何一个。每行一个，不要编号。只输出文字。'

/** 把模型输出整理成干净的文本行。 */
export function parseOcrText(raw: string): string[] {
  return raw
    .split(/\r?\n/u)
    // 去掉「1.」「-」「•」这类前缀，以及模型爱加的 markdown 强调符号
    .map((line) =>
      line
        .replace(/^\s*(?:[-*•]|\d+[.)、])\s*/u, '')
        .replace(/[*_`]/gu, '')
        .trim(),
    )
    // 去掉整行的引导语（模型偶尔会写「所有可提取文字如下：」）
    .filter((line) => line.length > 0 && line.length <= 40 && !/[：:]$/u.test(line))
}

/**
 * 从截图中读出界面文字。
 *
 * @param screenshot - PNG 字节
 * @param model - 视觉模型调用（提示词 → 文本）
 * @returns 读到的文字行；模型失败时返回空数组，调用方按 unknown 处理
 */
export async function readScreenText(
  screenshot: Buffer | Uint8Array,
  model: VisionModel,
): Promise<string[]> {
  const base64 = Buffer.from(screenshot).toString('base64')
  try {
    return parseOcrText(await model(OCR_PROMPT, base64))
  } catch {
    return []
  }
}
