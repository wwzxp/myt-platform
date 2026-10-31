/**
 * LLM 定位提示词构建。
 *
 * 依据实测（`docs/spec/llm-ui-locate-experiment.md`）：
 * - fewshot 变体对中小模型有稳定增益（MiniCPM 1B：75% → 90%）
 * - 云端大模型对提示词不敏感（95% 已饱和）
 * - **不能**让模型同时输出 index + text + 坐标（1.7B 会崩到 35%）
 *
 * 所以这里刻意只要求 `index` + 坐标两项，并把「不可点文字要选可点父节点」
 * 这条最容易踩的坑写成示例。
 */

import type { CompactNode } from './ui-compact.ts'

/** 提示词变体；线上固定用 `fewshot`。 */
export type LocatePromptVariant = 'plain' | 'fewshot'

/** 少样本示例（含最关键的「事件冒泡」规则）。 */
const FEWSHOT = `示例1：
节点表：
[1] Button | desc="返回" | 可点击 | 中心=(84,94)
[2] Button | text="帮助" | 可点击 | 中心=(630,98)
意图：点击右上角帮助
答案：{"index":2}

示例2：
节点表：
[1] Button | text="密码登录" | 可点击 | 中心=(272,406)
[2] Button | 可点击 | 中心=(360,502)
[3] TextView | text="验证并登录" | 不可点 | 中心=(360,502)
意图：点击「验证并登录」按钮
答案：{"index":2}
（说明：文字在不可点节点上、但它被可点节点包住时，选可点的那个）

示例3：
节点表：
[1] TextView | text="手机号登录" | 不可点 | 中心=(360,166)
[2] EditText | text="138 0013 8000" | 可点击 | 中心=(389,325)
意图：点击手机号输入框
答案：{"index":2}
`

/**
 * 构建定位提示词。
 *
 * @param nodes 紧凑节点（已按 `compactNodes` 压缩）
 * @param intent 步骤意图（用户在设计器里写的自然语言）
 * @param screen 屏幕尺寸
 * @param variant 提示词变体
 * @returns 完整 prompt
 */
export function buildLocatePrompt(
  nodes: readonly CompactNode[],
  intent: string,
  _screen: { width: number; height: number },
  variant: LocatePromptVariant = 'fewshot',
): string {
  const lines = nodes.map((n) => {
    const fields: string[] = []
    if (n.className) fields.push(n.className)
    if (n.text) fields.push(`text="${n.text}"`)
    if (n.desc) fields.push(`desc="${n.desc}"`)
    fields.push(n.clickable ? '可点击' : '不可点')
    fields.push(`中心=(${n.x},${n.y})`)
    // 序号用空格与字段分隔，字段之间用 ` | `。
    return `[${n.index}] ${fields.join(' | ')}`
  })

  const head = variant === 'fewshot' ? `${FEWSHOT}\n` : ''

  return `${head}${lines.join('\n')}

目标：${intent}

只输出序号：{"index":N}`
}

/** 校验提示词构建的解析契约。 */
export interface LocateAnswer {
  index?: number
  x?: number
  y?: number
  reason?: string
}

/**
 * 从模型原始输出里抽取 JSON。
 *
 * 小模型经常在 JSON 前后加解释文字，这里做容错。
 *
 * @param raw 模型输出
 * @returns 解析结果；失败返回 null
 */
export function parseLocateAnswer(raw: string): LocateAnswer | null {
  const matched = /\{[\s\S]*\}/.exec(raw)
  if (!matched) return null
  try {
    const parsed = JSON.parse(matched[0]) as LocateAnswer
    if (typeof parsed.index !== 'number' && typeof parsed.x !== 'number') return null
    return parsed
  } catch {
    return null
  }
}
