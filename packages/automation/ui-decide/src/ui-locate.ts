/**
 * UI 定位服务：把「自然语言意图」转成「可点击坐标」。
 *
 * 这是整条链路的唯一入口，内部所有约定都由实测数据确定
 * （见 `docs/spec/local-model-ui-locate.md`）：
 *
 * 1. **输出契约只要求 `{"index":N}`** —— 同时要坐标会让命中率从 100% 掉到 95%
 *    （模型要在两个答案系统间切换，偶发输出 NaN）。
 * 2. **坐标由代码从 `clickBounds` 算** —— 那是 XML 里的精确像素矩形，不需要模型猜。
 * 3. **区域预筛命中则用、不命中退回全量** —— 词表是纯增益，漏了不影响正确性。
 * 4. **位置标注（最左/正中间/最右）要传给模型** —— 「点击底部中间那个」靠它才能对。
 */

import type { ActionTarget } from '@myt/ui-perception'
import { hitTarget, inferRegion, narrowTargets, renderTargets } from '@myt/ui-perception'

/** 定位请求。 */
export interface LocateRequest {
  /** 全部候选目标（由 `collectActionTargets` 产出）。 */
  targets: readonly ActionTarget[]
  /** 用户意图（任意语言）。 */
  intent: string
}

/** 定位结果。 */
export interface LocateResult {
  /** 是否成功定位。 */
  ok: boolean
  /** 命中的目标。 */
  target?: ActionTarget
  /** 中心坐标（由 `clickBounds` 计算，非模型输出）。 */
  point?: { x: number; y: number }
  /** 失败原因，供 UI 展示。 */
  reason?: string
  /** 本次实际使用的候选数量（调试用）。 */
  candidateCount: number
  /** 本次是否用了区域预筛。 */
  narrowed: boolean
}

/** 调用 LLM 的接口，便于测试时替换。 */
export type LocateModel = (prompt: string) => Promise<string>

/**
 * 构建定位提示词。
 *
 * 关键约定：**只要求序号**。实测要求 `{"x","y","index"}` 三件套时，
 * minicpm46 的命中率从 100% 降到 95%（两次输出 NaN）。
 *
 * @param targets 候选目标
 * @param intent 用户意图
 * @param withRegion 是否按区域分组渲染
 */
export function buildLocatePrompt(
  targets: readonly ActionTarget[],
  intent: string,
  withRegion = true,
): string {
  const list = renderTargets(targets, { withRegion })
  return `${list}

目标：${intent}
只输出序号：{"index":N}`
}

/**
 * 解析模型输出里的序号。
 *
 * 兼容数组形式（MiniCPM-V 4.6 会输出 `{"index":[16]}`）。
 *
 * @param raw 模型原始输出
 * @returns 序号；解析失败返回 null
 */
export function parseLocateIndex(raw: string): number | null {
  const matched = /\{[\s\S]*?\}/.exec(raw)
  if (!matched) return null
  try {
    const parsed = JSON.parse(matched[0]) as { index?: unknown }
    const value = parsed.index
    // 数字、字符串、数组都接受：实测 minicpm46 会输出 `{"index":"3"}` 这种字符串形式。
    if (Array.isArray(value)) {
      const first = Number(value[0])
      return Number.isFinite(first) ? first : null
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const numeric = Number(value.trim())
      return Number.isFinite(numeric) ? numeric : null
    }
    return null
  } catch {
    return null
  }
}

/**
 * 按目标矩形计算点击中心。
 *
 * @param target 目标
 */
export function centerOf(target: ActionTarget): { x: number; y: number } {
  const [x1, y1, x2, y2] = target.clickBounds
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) }
}

/**
 * 执行一次定位。
 *
 * @param request 定位请求
 * @param model 调用 LLM 的函数（返回原始文本）
 * @returns 定位结果
 */
export async function locate(
  request: LocateRequest,
  model: LocateModel,
): Promise<LocateResult> {
  const { targets, intent } = request
  if (targets.length === 0) {
    return { ok: false, reason: '当前界面没有可操作目标', candidateCount: 0, narrowed: false }
  }

  // 区域预筛：只有「意图里明确提到区域」且筛选后仍有 ≥2 个候选时才生效。
  // 不命中时退回全量——实测这样不会更差（80% vs 80%），只是少了 29% 的加速。
  const region = inferRegion(intent)
  const narrowedList = region ? narrowTargets(targets, { region, excludeUnnamed: true }) : []
  const usedNarrow = narrowedList.length >= 2
  const pool = usedNarrow ? narrowedList : targets

  const prompt = buildLocatePrompt(pool, intent)
  const raw = await model(prompt)
  const index = parseLocateIndex(raw)

  if (index === null) {
    return {
      ok: false,
      reason: `模型未返回合法序号（原始输出：${raw.slice(0, 60)}）`,
      candidateCount: pool.length,
      narrowed: usedNarrow,
    }
  }

  const target = pool.find((t) => t.id === index)
  if (!target) {
    return {
      ok: false,
      reason: `序号 ${index} 不在候选范围内（1-${pool.length}）`,
      candidateCount: pool.length,
      narrowed: usedNarrow,
    }
  }

  if (!target.actionable) {
    return {
      ok: false,
      reason: `目标「${target.name}」不可点击`,
      target,
      candidateCount: pool.length,
      narrowed: usedNarrow,
    }
  }

  // 坐标由代码计算，不采信模型输出
  const point = centerOf(target)

  // 兜底校验：算出的坐标必须落在目标矩形内
  const verified = hitTarget(pool, point.x, point.y)
  if (!verified || verified.id !== target.id) {
    return {
      ok: false,
      reason: `坐标校验失败：(${point.x},${point.y}) 未命中「${target.name}」`,
      target,
      candidateCount: pool.length,
      narrowed: usedNarrow,
    }
  }

  return { ok: true, target, point, candidateCount: pool.length, narrowed: usedNarrow }
}
