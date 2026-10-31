/**
 * 视觉列举：让视觉模型「读出某个区域的元素」，位置推理交给代码。
 *
 * 这个模块的每条约定都有实测依据（见 `docs/spec/local-model-ui-locate.md`）：
 *
 * 1. **绝不让模型做位置推理**：问「最右边是哪个」→ 答错；问「从左到右列出」→ 全对。
 *    位置（最左/最右/中间）由代码从返回的顺序里取，模型只负责"念出文字"。
 * 2. **必须强调「完整、不要遗漏」**：不加这句时 minicpm46 漏掉搜索按钮，
 *    lfm3-vl 也漏；加了之后两个模型都能列全 5 个。
 * 3. **不要要求计数**：让它「先数总数再列出」时，它会为了自洽少报（数成 4 个）。
 * 4. **必须裁剪**：整页 900×1600 要 19-29 秒，裁剪到条状只要 2-4 秒。
 */

import type { ActionTarget } from './ui-action-targets.ts'

/** 裁剪区域，单位为像素。 */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/** 视觉列举的结果。 */
export interface VisionListing {
  /** 模型读出的按钮文字，按视觉顺序（左→右 / 上→下）。 */
  names: string[]
  /** 原始输出，调试用。 */
  raw: string
  /** 耗时毫秒。 */
  ms: number
  /** 是否按预期拿到了至少两个元素。 */
  ok: boolean
}

/**
 * 构建视觉列举的提示词。
 *
 * 注意「完整列出，不要遗漏任何一个」这句是**必需**的：
 * 实测去掉它会让两个模型都漏元素。
 *
 * @param region 区域中文名（顶部 / 内容区 / 底部导航栏）
 * @param direction 阅读方向
 */
export function buildListPrompt(
  region: string,
  direction: 'left-to-right' | 'top-to-bottom' = 'left-to-right',
): string {
  const order = direction === 'left-to-right' ? '从左到右' : '从上到下'
  return `这张图是手机界面的${region}。请${order}依次列出其中所有按钮或图标上的文字。
要求：完整列出，不要遗漏任何一个。只输出文字，用顿号分隔，不要解释。`
}

/** 已知的分隔符：不同模型输出习惯不同（顿号/分号/中点/逗号）。 */
const SEPARATORS = /[、,，;；·・\n]+/

/** 需要从候选名里剔除的噪声词。 */
const NOISE = /^(数量|列表|其中|注意|说明|共计|总数|提示)/

/**
 * 解析模型返回的列表文本。
 *
 * 实测各模型的分隔符不同：
 * - lfm3-vl：`菜单;关注;发现;同城;搜索`
 * - minicpm46：`顶部栏从左到右依次有：三· 关注· 发现· 同城· 搜索，注意"关注"旁边有红色数字"18"`
 * - minicpm-v 4.7：`首页、市集、消息、我`
 *
 * @param raw 模型原始输出
 * @returns 清洗后的名称列表
 */
export function parseListing(raw: string): string[] {
  const cleaned = raw.replace(/^#+\s*/gm, '').trim()
  if (!cleaned) return []

  // 按已知分隔符切分。不同模型习惯不同：
  // lfm3-vl 用分号、minicpm46 用「中点」或「空格」、minicpm-v 用顿号。
  // 实测 minicpm46 有时输出 `首页 市集 + 消息 我 12`（空格分隔且带未读数）。
  const hasStrongSep = /[、,，;；·・\n]/.test(cleaned)
  const parts = cleaned.split(hasStrongSep ? /[、,，;；·・\n]+/ : /\s+/)

  const out: string[] = []
  for (const part of parts) {
    let name = part
      // 去掉「数量=4」「列表=」这类键值前缀
      .replace(/^[^：:=]*[：:=]\s*/, '')
      // 去掉「顶部栏从左到右依次有：三」这类说明性前缀里残留的引导语
      .replace(/^.*?(?:依次有|分别是|包括|如下)[：:]?\s*/, '')
      .replace(/^[\d.\s\-•*]+/, '')
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/^["'「『]+|["'」』]+$/g, '')
      .replace(/[，,。！!？?]+$/, '')
      .trim()

    // 剔除纯说明性片段
    if (!name) continue
    if (/^(数量|列表|共计|总数|提示|注意|说明|其中)/.test(name)) continue
    // 剔除过长（是句子不是按钮名）
    if (name.length > 12) continue
    // 保留含字母/数字的名字，以及 `+`、`×` 这类图标符号（实测「发布」在视觉上就是加号）
    const hasLetterOrDigit = /[\p{L}\p{N}]/u.test(name)
    const isIconSymbol = /^[+＋×✕✖✚⊕]$/.test(name)
    if (!hasLetterOrDigit && !isIconSymbol) continue
    // 剔除纯数字（未读数，如消息旁的「12」）
    if (/^\d+$/.test(name)) continue

    out.push(name)
  }
  return out
}

/** 图标符号与语义名的对应表（视觉模型常把图标读成符号）。 */
const ICON_SEMANTICS: Record<string, string[]> = {
  '+': ['发布', '新建', '添加', '创建'],
  '＋': ['发布', '新建', '添加', '创建'],
  '×': ['关闭', '清除', '删除'],
  '✕': ['关闭', '清除', '删除'],
  '🔍': ['搜索'],
}

/**
 * 把视觉读出的名字映射回目标列表。
 *
 * 采用三级匹配：完全相同 → 目标名包含该词 → 该词包含目标名。
 *
 * @param names 模型读出的名字（按视觉顺序）
 * @param targets 候选目标
 * @returns 与 names 等长的匹配结果（未匹配为 null）
 */
export function mapNamesToTargets(
  names: readonly string[],
  targets: readonly ActionTarget[],
): Array<ActionTarget | null> {
  return names.map((name) => {
    const exact = targets.find((t) => t.name === name)
    if (exact) return exact
    // 图标符号按语义表匹配（实测：底部「发布」在视觉上就是一个加号）
    const semantics = ICON_SEMANTICS[name]
    if (semantics) {
      const bySemantic = targets.find((t) => semantics.some((w) => t.name.includes(w)))
      if (bySemantic) return bySemantic
    }
    const contains = targets.find((t) => t.name.includes(name) || name.includes(t.name))
    return contains ?? null
  })
}

/**
 * 从视觉顺序里取指定位置的目标。
 *
 * 这是「位置推理交给代码」的落点——模型只给出顺序，代码取极值。
 *
 * @param names 视觉顺序的名字列表
 * @param targets 候选目标
 * @param position 位置
 * @returns 命中的目标
 */
export function pickByPosition(
  names: readonly string[],
  targets: readonly ActionTarget[],
  position: 'leftmost' | 'rightmost' | 'middle',
): ActionTarget | null {
  const mapped = mapNamesToTargets(names, targets).filter((t): t is ActionTarget => t !== null)
  if (mapped.length === 0) return null
  if (position === 'leftmost') return mapped[0] ?? null
  if (position === 'rightmost') return mapped[mapped.length - 1] ?? null
  return mapped[Math.floor(mapped.length / 2)] ?? null
}

/**
 * 计算某区域的裁剪矩形。
 *
 * 实测裁剪是必需的：整页 900×1600 需 19-29 秒，条状区域只要 2-4 秒。
 *
 * @param targets 全部目标
 * @param region 目标区域
 * @param screen 屏幕尺寸
 * @param padding 上下留白（像素）
 */
export function cropOfRegion(
  targets: readonly ActionTarget[],
  region: ActionTarget['region'],
  screen: { width: number; height: number },
  padding = 20,
): CropRect | null {
  const inRegion = targets.filter((t) => t.region === region && t.actionable)
  if (inRegion.length === 0) return null

  // 只用「主要行」：底部导航栏（y≈1510-1600）上方常有笔记卡片的图标（y≈1486-1510），
  // 一起裁进去会让模型把笔记的点赞数也当成导航项，从而漏掉真正的按钮。
  // 做法：按 clickBounds 的高度排序，取中位数以上的目标定范围。
  const heights = inRegion.map((t) => t.clickBounds[3] - t.clickBounds[1]).sort((a, b) => a - b)
  const medianH = heights[Math.floor(heights.length / 2)] ?? 0
  const mainRow = inRegion.filter((t) => (t.clickBounds[3] - t.clickBounds[1]) >= medianH)

  const minY = Math.min(...mainRow.map((t) => t.clickBounds[1]))
  const maxY = Math.max(...mainRow.map((t) => t.clickBounds[3]))
  const y = Math.max(0, minY - padding)
  const bottom = Math.min(screen.height, maxY + padding)
  return { x: 0, y, width: screen.width, height: Math.max(1, bottom - y) }
}
