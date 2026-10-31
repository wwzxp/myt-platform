import type { StepContext } from '@myt/flow'
import type { UiNode } from '@myt/device'
import { currentPage, type PageRegistry } from './page-guard.ts'
import type { RecoveryConfig, RecoveryRule } from './recovery.ts'
import { askYesNo, locateByModel, screenSizeOf } from './locate-adapter.ts'
import {
  clearPhoneInput,
  sleepRandom,
  tapHuman,
  typeWithVerify,
} from './actions.ts'
import type { ActionSpec, ActionResult, LocateSpec } from './types.ts'
export type { ActionResult } from './types.ts'

/**
 * 动作引擎核心：跑一个动作。
 *
 * 一个动作 = 一次「五步循环」：
 * ```
 * ① 获取界面  →  ② 判断页面  →  ③ 找位置  →  ④ 执行  →  ⑤ 校验
 *      ↑                                                  │
 *      └────────────── 未成功则下一轮 ────────────────────┘
 * ```
 */

/** 单个动作的最大默认轮数。 */
const DEFAULT_ROUNDS = 5

/** 默认轮间等待（秒）。 */
const DEFAULT_GAP: readonly [number, number] = [0.3, 0.8]

/**
 * 执行一个动作。
 *
 * @param ctx 步骤上下文
 * @param action 动作定义
 */
/**
 * 从步骤上下文取页面注册表与恢复配置。
 *
 * 引擎不持有任何 App 信息——业务包把 `ctx.app` 填好，这里只做类型收窄。
 */
export function appContextOf(ctx: StepContext): { pages: PageRegistry; config: RecoveryConfig } | null {
  const app = ctx.app as
    | { packageName: string; homeUri: string; pages: PageRegistry; recoveryRules: readonly RecoveryRule[] }
    | undefined
  if (!app) return null
  return {
    pages: app.pages,
    config: {
      packageName: app.packageName,
      homeUri: app.homeUri,
      rules: app.recoveryRules,
    },
  }
}

export async function runAction(
  ctx: StepContext,
  pages: PageRegistry,
  action: ActionSpec,
): Promise<ActionResult> {
  const startedAt = Date.now()
  const rounds = action.rounds ?? DEFAULT_ROUNDS
  const gap = action.gap ?? DEFAULT_GAP

  let lastReason = ''

  for (let round = 0; round < rounds; round += 1) {
    ctx.throwIfCancelled()

    // ── ② 判断页面（① 的界面在需要时才取）──
    const page = await currentPage(ctx, pages)
    if (!action.requires.includes(page)) {
      lastReason = `第${round + 1}轮页面是 ${page}，期望 ${action.requires.join('/')}`
      // 最后一轮交给恢复层处理；前面的轮次先等待（页面可能正在跳转）。
      if (round === rounds - 1) break
      await sleepRandom(ctx, gap[0], gap[1])
      continue
    }

    // ── ③ 找位置 ──
    let point: { x: number; y: number } | undefined
    let source: ActionResult['source'] = 'none'
    let target: ActionResult['target']

    if (action.locate && action.act.kind !== 'custom') {
      const hit = await locateByModel(ctx, ctx.model, {
        intent: action.locate.intent,
        fallback: action.locate.fallback,
        vision: action.locate.vision,
        strict: action.locate.strict,
      })
      if (!hit.ok || !hit.point) {
        lastReason = `第${round + 1}轮未定位到「${action.locate.intent}」：${hit.reason ?? '未命中'}`
        // 可选动作：找不到就是「本来就没有」，直接算成功。
        if (action.optional) {
          return { ok: true, rounds: round + 1, source: hit.source, reason: '可选动作未命中，视为成功', ms: Date.now() - startedAt }
        }
        await sleepRandom(ctx, gap[0], gap[1])
        continue
      }
      point = hit.point
      source = hit.source
      target = hit.target
    }

    // ── ④ 执行 ──
    await execute(ctx, action, point)

    // ── ⑤ 校验 ──
    const settle = action.settle
    if (settle) await sleepRandom(ctx, settle[0], settle[1])

    const verified = await verify(ctx, pages, action)
    if (verified) {
      return { ok: true, rounds: round + 1, point, target, source, ms: Date.now() - startedAt }
    }

    lastReason = `第${round + 1}轮执行后校验未通过`
    await sleepRandom(ctx, gap[0], gap[1])
  }

  return { ok: false, rounds, reason: lastReason, ms: Date.now() - startedAt }
}

/** 执行动作本体。 */
async function execute(
  ctx: StepContext,
  action: ActionSpec,
  point: { x: number; y: number } | undefined,
): Promise<void> {
  const { act } = action
  switch (act.kind) {
    case 'tap':
      if (point) await tapHuman(ctx, point)
      return
    case 'input': {
      if (!point) return
      await tapHuman(ctx, point)
      await sleepRandom(ctx, 0.3, 0.6)
      const snapshot = await ctx.snapshot({ refresh: true })
      const current = act.inputLocator(snapshot.root)
      if (current?.text) await clearPhoneInput(ctx, current.text)
      await typeWithVerify(
        ctx,
        act.text,
        act.inputLocator,
        action.title,
        act.extras ?? [],
        act.match ?? 'exact',
      )
      return
    }
    case 'swipe':
      await ctx.device.swipe(ctx.serial, act.from, act.to, act.durationMs)
      return
    case 'back':
      await ctx.device.back(ctx.serial)
      return
    case 'openUri':
      await ctx.device.openUri(ctx.serial, act.uri)
      return
    case 'custom':
      await act.run(ctx)
      return
  }
}

/** 校验动作是否成功。 */
async function verify(ctx: StepContext, pages: PageRegistry, action: ActionSpec): Promise<boolean> {
  const { verify } = action
  if (!verify) {
    // 没有声明校验：如果声明了落点，用落点判断；否则视为成功。
    if (action.landsOn && action.landsOn.length > 0) {
      const page = await currentPage(ctx, pages)
      return action.landsOn.includes(page)
    }
    return true
  }

  switch (verify.kind) {
    case 'page': {
      const page = await currentPage(ctx, pages)
      return verify.expect.includes(page)
    }
    case 'exists': {
      const hit = await locateByModel(ctx, ctx.model, {
        intent: verify.locate.intent,
        fallback: verify.locate.fallback,
        vision: verify.locate.vision,
        strict: verify.locate.strict,
      })
      return hit.ok
    }
    case 'gone': {
      const hit = await locateByModel(ctx, ctx.model, {
        intent: verify.locate.intent,
        fallback: verify.locate.fallback,
        vision: verify.locate.vision,
        strict: verify.locate.strict,
      })
      return !hit.ok
    }
    case 'inputEquals': {
      const snapshot = await ctx.snapshot({ refresh: true })
      const current = verify.locator(snapshot.root)
      const actual = (current?.text ?? '').trim()
      const expected = verify.text.trim()
      return verify.match === 'contains' ? actual.includes(expected) : actual === expected
    }
    case 'countAtLeast':
      return (await verify.measure(ctx)) >= verify.target
    case 'custom':
      return verify.run(ctx)
  }
}

/**
 * 跑一串动作。
 *
 * 任一动作失败即中止——不在错误的界面上继续点下去。
 *
 * @param ctx 步骤上下文
 * @param actions 动作清单（按定义顺序执行）
 * @param onStep 每个动作开始时回调（用于写日志/事件）
 */
export async function runActions(
  ctx: StepContext,
  pages: PageRegistry,
  actions: readonly ActionSpec[],
  onStep?: (action: ActionSpec, result: ActionResult) => void,
): Promise<{ ok: boolean; failedAt?: string; results: Array<{ id: string; result: ActionResult }> }> {
  const results: Array<{ id: string; result: ActionResult }> = []

  for (const action of actions) {
    const result = await runAction(ctx, pages, action)
    results.push({ id: action.id, result })
    onStep?.(action, result)

    if (!result.ok) {
      return { ok: false, failedAt: action.id, results }
    }
  }

  return { ok: true, results }
}

/**
 * 把一串动作包装成一个流程步骤。
 *
 * 用于替换现在「一步一个 `run(ctx)`、里面自己写循环」的写法：
 * 步骤体只剩一行 `runActions`。
 */
export function makeStep(
  id: string,
  title: string,
  actions: readonly ActionSpec[],
): { id: string; title: string; run: (ctx: StepContext) => Promise<void> } {
  return {
    id,
    title,
    async run(ctx: StepContext) {
      const pages = (ctx as StepContext & { pages?: PageRegistry }).pages
      if (!pages) throw new Error('StepContext 缺少页面注册表（ctx.pages）')
      const outcome = await runActions(ctx, pages, actions, (action, result) => {
        ctx.runs.stepSucceeded(
          ctx.runId,
          id,
          result.rounds,
          `${action.title}：${result.ok ? '成功' : `失败（${result.reason ?? ''}）`}`,
        )
      })
      if (!outcome.ok) {
        const failed = outcome.results.at(-1)
        throw new Error(
          `${title} 在动作「${failed?.id}」失败：${failed?.result.reason ?? '未知原因'}`,
        )
      }
    },
  }
}

/** 判断一个定位说明是否能在当前界面命中（不点击）。 */
export async function canLocate(ctx: StepContext, locate: LocateSpec): Promise<boolean> {
  const hit = await locateByModel(ctx, ctx.model, {
    intent: locate.intent,
    fallback: locate.fallback,
    vision: locate.vision,
    strict: locate.strict,
  })
  return hit.ok
}

/** 让模型回答一个布尔问题（页面级判定）。 */
export async function askPageYesNo(
  ctx: StepContext,
  question: string,
  field: string,
): Promise<boolean | null> {
  const answered = await askYesNo(ctx, ctx.model, question, field)
  return answered.value
}

export { screenSizeOf }
export type { UiNode }
