import type { StepContext } from '@myt/flow'
import type { UiNode } from '@myt/device'
import {
  collectActionTargets,
  cropOfRegion,
  cropPng,
  buildListPrompt,
  inferRegion,
  mapNamesToTargets,
  parseListing,
  pickByPosition,
  type ActionTarget,
  type ScreenSize,
} from '@myt/ui-perception'
import { locate, type LocateModel, type LocateResult } from '@myt/ui-decide'
import type { LocateSpec } from './types.ts'

/**
 * 定位适配：把「引擎的定位需求」翻译成三级链路。
 *
 * ```
 * L1 文本定位  →  模型从候选列表选序号
 *   ↓ 失败
 * L2 视觉兜底  →  截图 + 裁剪 + 视觉模型读字 + 名字映射回候选
 *   ↓ 失败
 * L3 确定性路径 →  调用方给的旧定位器
 * ```
 *
 * 实测依据（`docs/spec/local-model-ui-locate.md` 补充四）：
 * 文本层单独跑有失败用例，视觉兜底是必需的第二级，不是可选项。
 * 但主路径命中时 L2 不触发，没有额外开销。
 */

/** 屏幕尺寸缓存。 */
const screenCache = new Map<string, ScreenSize>()

/** 读取屏幕尺寸（带缓存）。 */
export async function screenSizeOf(ctx: StepContext): Promise<ScreenSize> {
  const cached = screenCache.get(ctx.serial)
  if (cached) return cached
  const out = await ctx.device.shell(ctx.serial, 'wm size', { check: false })
  const matched = /(\d+)x(\d+)/.exec(out)
  const size = matched
    ? { width: Number(matched[1]), height: Number(matched[2]) }
    : { width: 900, height: 1600 }
  screenCache.set(ctx.serial, size)
  return size
}

/** 定位结果。 */
export interface LocateOutcome {
  ok: boolean
  point?: { x: number; y: number }
  target?: ActionTarget
  source: 'model' | 'vision' | 'fallback' | 'none'
  reason?: string
  candidateCount: number
  ms: number
}

/**
 * 用模型定位一个元素。
 *
 * @param ctx 步骤上下文
 * @param modelLocate 模型调用函数；为空时直接走兜底
 * @param spec 意图与兜底
 */
export async function locateByModel(
  ctx: StepContext,
  modelLocate: LocateModel | undefined,
  spec: LocateSpec,
): Promise<LocateOutcome> {
  const startedAt = Date.now()
  const snapshot = await ctx.snapshot({ refresh: true })
  const size = await screenSizeOf(ctx)
  const targets = collectActionTargets(snapshot.root as never, size)

  if (!modelLocate) {
    const fallbackPoint = spec.fallback?.(snapshot.root) ?? null
    return {
      ok: fallbackPoint !== null,
      point: fallbackPoint ?? undefined,
      source: fallbackPoint ? 'fallback' : 'none',
      reason: fallbackPoint ? undefined : '未配置模型且兜底未命中',
      candidateCount: targets.length,
      ms: Date.now() - startedAt,
    }
  }

  let result: LocateResult | null = null
  try {
    result = await locate({ targets, intent: spec.intent }, modelLocate)
  } catch (error) {
    const fallbackPoint = spec.fallback?.(snapshot.root) ?? null
    return {
      ok: fallbackPoint !== null,
      point: fallbackPoint ?? undefined,
      source: fallbackPoint ? 'fallback' : 'none',
      reason: error instanceof Error ? error.message : String(error),
      candidateCount: targets.length,
      ms: Date.now() - startedAt,
    }
  }

  if (result.ok && result.point && result.target?.actionable) {
    // 严格模式：命中的候选名必须与意图有字面重叠，否则不予采信。
    if (spec.strict && !isRelevant(result.target.name, spec.intent)) {
      const fallbackPoint = spec.fallback?.(snapshot.root) ?? null
      return {
        ok: fallbackPoint !== null,
        point: fallbackPoint ?? undefined,
        source: fallbackPoint ? 'fallback' : 'none',
        reason: `严格模式：命中「${result.target.name}」与意图「${spec.intent}」无关`,
        candidateCount: targets.length,
        ms: Date.now() - startedAt,
      }
    }
    return {
      ok: true,
      point: result.point,
      target: result.target,
      source: 'model',
      candidateCount: result.candidateCount,
      ms: Date.now() - startedAt,
    }
  }

  // L2 视觉兜底
  if (spec.vision !== false) {
    const visionHit = await visionFallback(ctx, modelLocate, spec.intent, targets, size)
    if (visionHit) {
      return {
        ok: true,
        point: visionHit.point,
        target: visionHit.target,
        source: 'vision',
        candidateCount: targets.length,
        ms: Date.now() - startedAt,
      }
    }
  }

  const fallbackPoint = spec.fallback?.(snapshot.root) ?? null
  return {
    ok: fallbackPoint !== null,
    point: fallbackPoint ?? undefined,
    source: fallbackPoint ? 'fallback' : 'none',
    reason: result?.reason ?? '模型未命中',
    candidateCount: targets.length,
    ms: Date.now() - startedAt,
  }
}

/** 判断候选名与意图是否字面相关。 */
function isRelevant(name: string, intent: string): boolean {
  if (!name || !intent) return false
  const noise = /点击|按钮|入口|标签|那个|该项|底部|顶部|左侧|右侧|最左|最右|中间|图标/g
  const a = name.replace(noise, '').trim()
  const b = intent.replace(noise, '').trim()
  if (!a || !b) return false
  return a.includes(b) || b.includes(a)
}

/** L2 视觉兜底。 */
async function visionFallback(
  ctx: StepContext,
  modelLocate: LocateModel,
  intent: string,
  targets: readonly ActionTarget[],
  screen: ScreenSize,
): Promise<{ point: { x: number; y: number }; target: ActionTarget } | null> {
  const region = inferRegion(intent)
  if (!region) return null

  const rect = cropOfRegion(targets, region, screen)
  if (!rect) return null

  let screenshot: Buffer
  try {
    screenshot = await ctx.device.screenshot(ctx.serial)
  } catch {
    return null
  }
  const cropped = cropPng(screenshot, rect)
  if (!cropped) return null

  const regionName = region === 'bottom' ? '底部导航栏' : region === 'top' ? '顶部栏' : '内容区'
  const vision = (modelLocate as LocateModel & { __vision?: (p: string, b: Buffer) => Promise<string> })
    .__vision
  if (!vision) return null

  const names = parseListing(await vision(buildListPrompt(regionName), cropped))
  if (names.length === 0) return null

  const position = /最右|右侧/.test(intent)
    ? 'rightmost'
    : /最左|左侧/.test(intent)
      ? 'leftmost'
      : /中间/.test(intent)
        ? 'middle'
        : null

  const inRegion = targets.filter((target) => target.region === region)
  const picked = position
    ? pickByPosition(names, inRegion, position)
    : pickByName(names, inRegion, intent)

  if (!picked || !picked.actionable) return null
  return { point: { x: picked.x, y: picked.y }, target: picked }
}

/** 按名字把视觉读出的列表映射到候选。 */
function pickByName(
  names: readonly string[],
  targets: readonly ActionTarget[],
  intent: string,
): ActionTarget | null {
  const mapped = mapNamesToTargets(names, targets).filter(
    (target): target is ActionTarget => target !== null,
  )
  if (mapped.length === 0) return null
  const keyword = intent.replace(/点击|按钮|入口|标签|那个|底部|顶部|左侧|右侧|最左|最右|中间/g, '').trim()
  if (keyword) {
    const byKeyword = mapped.find(
      (target) => target.name.includes(keyword) || keyword.includes(target.name),
    )
    if (byKeyword) return byKeyword
  }
  return mapped.length === 1 ? (mapped[0] ?? null) : null
}

/** 让模型回答一个布尔问题（页面级判定）。 */
export async function askYesNo(
  ctx: StepContext,
  modelLocate: LocateModel | undefined,
  question: string,
  field: string,
): Promise<{ ok: boolean; value: boolean | null; raw: string; ms: number }> {
  const startedAt = Date.now()
  if (!modelLocate) return { ok: false, value: null, raw: '', ms: 0 }

  const snapshot = await ctx.snapshot({ refresh: true })
  const size = await screenSizeOf(ctx)
  const targets = collectActionTargets(snapshot.root as never, size)
  const list = targets.map((target) => `[${target.id}] ${target.name} | ${target.kind}`).join('\n')

  const prompt = `以下是手机界面上的可点元素列表：
${list}

问题：${question}
只输出：{"${field}":true} 或 {"${field}":false}`

  let raw = ''
  try {
    raw = await modelLocate(prompt)
  } catch (error) {
    return { ok: false, value: null, raw: error instanceof Error ? error.message : String(error), ms: Date.now() - startedAt }
  }

  const matched = /\{[\s\S]*?\}/.exec(raw)
  if (!matched) return { ok: false, value: null, raw, ms: Date.now() - startedAt }
  try {
    const parsed = JSON.parse(matched[0]) as Record<string, unknown>
    const value = parsed[field]
    if (typeof value === 'boolean') return { ok: true, value, raw, ms: Date.now() - startedAt }
    return { ok: false, value: null, raw, ms: Date.now() - startedAt }
  } catch {
    return { ok: false, value: null, raw, ms: Date.now() - startedAt }
  }
}

export { locate, type LocateModel, type LocateResult }
