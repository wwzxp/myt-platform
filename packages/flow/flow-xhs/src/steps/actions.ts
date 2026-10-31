import type { DeviceControl, UiSnapshot } from '@myt/device'
import type { HumanPolicy, Random } from '@myt/human'
import { splitBursts } from '@myt/human'
import type { RunStore } from '@myt/runs'
import { isLoadingSpinnerPresent, getFocusedInputContent } from '../locators/state-locators.ts'

/**
 * 输入/等待类动作原语（**1:1 移植**自 auto_login.py）。
 *
 * 这些是旧项目在真机上调出来的行为，参数不要随意改：
 * - `inputWithHumanLike`：输入前思考停顿、打字后回读、不一致则删除重输，最多 5 次；
 * - `clearInput`：删除次数 `min(len+5, 20)`，每次间隔 50–80ms；
 * - `waitSpinnerGone`：轮询「加载转圈」直到消失，超时返回 false（不抛错）。
 */

export interface ActionContext {
  serial: string
  device: DeviceControl
  runs: RunStore
  runId: string
  random: Random
  humanPolicy: HumanPolicy
  snapshot(options?: { refresh?: boolean }): Promise<UiSnapshot>
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** 输入前思考停顿：85% 0.8–3s，15% 4–7s（旧实现 thinking_delay）。 */
async function thinkingDelay(random: Random): Promise<void> {
  if (random.next() < 0.15) {
    await sleep(random.int(4000, 7000))
  } else {
    await sleep(random.int(800, 3000))
  }
}

/**
 * 清空输入框：`min(len+5, 20)` 次删除键，每次 50–80ms。
 * 移植自 `clear_phone_input`。
 */
export async function clearInput(ctx: ActionContext, content: string): Promise<void> {
  if (!content) return
  const times = Math.min(content.length + 5, 20)
  for (let i = 0; i < times; i += 1) {
    await ctx.device.pressKey(ctx.serial, 'KEYCODE_DEL')
    await sleep(50 + ctx.random.next() * 30)
  }
}

/**
 * 拟人输入（带回读校验与重试）。
 *
 * 与旧实现的差异：旧实现「输入不一致就删掉重输」，但删除次数由**实际内容长度**
 * 决定；这里保持一致。返回 false 表示最终失败（旧实现同样返回 False 而非抛错）。
 */
export async function inputWithHumanLike(
  ctx: ActionContext,
  text: string,
  _description: string,
  maxRetries = 5,
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    await thinkingDelay(ctx.random)

    // 分组输入；ASCII 走 input text（同步有序），中文走广播。
    for (const burst of splitBursts(ctx.random, ctx.humanPolicy, text)) {
      await ctx.device.typeText(ctx.serial, burst)
      await sleep(ctx.random.int(ctx.humanPolicy.burstPauseMs[0], ctx.humanPolicy.burstPauseMs[1]))
    }

    await sleep(ctx.random.int(300, 800))

    const snapshot = await ctx.snapshot({ refresh: true })
    const actual = getFocusedInputContent(snapshot.root)
    if (actual === null) {
      // 未找到聚焦输入框：旧实现直接返回 False（不重试）。
      return false
    }
    const expected = text.replace(/\s+/g, '')
    if (actual.replace(/\s+/g, '') === expected) {
      return true
    }
    if (attempt < maxRetries) {
      await clearInput(ctx, actual)
      await sleep(ctx.random.int(200, 500))
    }
  }
  return false
}

/**
 * 等待加载转圈消失；超时返回 false（旧实现语义，不抛错）。
 * 移植自 `wait_spinner_gone`。
 */
export async function waitSpinnerGone(ctx: ActionContext, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const snapshot = await ctx.snapshot({ refresh: true })
    if (!isLoadingSpinnerPresent(snapshot.root)) return true
    await sleep(ctx.random.int(400, 800))
  }
  return false
}

/** 连点 N 次（旧实现在「验证并登录」上连点 3 次触发发码）。 */
export async function tapRepeatedly(
  ctx: ActionContext,
  point: { x: number; y: number },
  times = 3,
): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await ctx.device.tapLikeHuman(ctx.serial, point.x, point.y)
  }
}

export { sleep, thinkingDelay }
