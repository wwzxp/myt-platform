import type { StepContext } from '@myt/flow'
import type { UiNode } from '@myt/device'
import type { Point } from './types.ts'

/** 输入框定位结果（坐标 + 当前文字）。 */
export interface InputPosition extends Point {
  text: string
}

/**
 * 发布流程共用的操作步骤（**1:1 移植**自 `auto_fb/auto_fb.py`）。
 *
 * 说明：`StepContext` 提供 `device` / `snapshot` / `random`，
 * 下面的函数都按旧实现的轮询次数、sleep 区间、校验方式原样保留。
 */

/** ADB Keyboard 的 IME id（旧 `ADB_KEYBOARD_IME`）。 */
export const ADB_KEYBOARD_IME = 'com.android.adbkeyboard/.AdbIME'

/** 等待。 */
export function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** 区间随机 sleep（旧 `sleep(random.uniform(a, b))`）。 */
export function sleepRandom(ctx: StepContext, minSeconds: number, maxSeconds: number): Promise<void> {
  return sleep(minSeconds * 1000 + ctx.random.next() * (maxSeconds - minSeconds) * 1000)
}

/** 区间随机整数（旧 `random.randint(a, b)`，含两端）。 */
export function randInt(ctx: StepContext, min: number, max: number): number {
  return min + Math.floor(ctx.random.next() * (max - min + 1))
}

/** 拟人点击（旧 `tap_with_human_like`）。 */
export async function tapHuman(ctx: StepContext, point: Point): Promise<void> {
  await ctx.device.tapLikeHuman(ctx.serial, point.x, point.y)
}

/**
 * 一次性粘贴整段文本（`paste_text`，161-176 行）。
 *
 * 旧实现以**字面双引号**拼接命令交给 adb shell，并每次都重设 IME。
 * 但重设 IME 会抢走输入框焦点（正文框因此只剩占位符），
 * 所以 IME 只在流程开头设置一次（见 `prepare` 步骤）。
 *
 * 换行/`#` 这类片段必须走引号包裹的广播：`device.typeText` 用 argv 传参，
 * 换行会被设备端 shell 当成参数分隔，报 `Argument expected after "msg"`。
 */
export async function pasteText(ctx: StepContext, text: string): Promise<void> {
  if (!text) return

  // 纯可打印 ASCII 且不含 shell 特殊字符时，走同步的 `input text`。
  if (/^[\x20-\x7e]+$/.test(text) && !/["'\\$`&|;<>()[\]{}*?~!#%\r\n]/.test(text)) {
    await ctx.device.typeText(ctx.serial, text)
    return
  }

  // 其余（含换行、#、中文）走引号包裹的广播，与旧 `paste_text` 一致。
  const safeText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  await ctx.device.shell(
    ctx.serial,
    `am broadcast -a ADB_INPUT_TEXT --es msg "${safeText}"`,
    { check: false, timeoutMs: 30_000 },
  )
}

/**
 * 模拟真人删除输入框内容（`clear_phone_input`，217-223 行）。
 *
 * 旧实现：删除次数 `min(len+5, 20)`，每次 `sleep(0.05 + rand*0.03)`。
 *
 * **修正**：旧实现的 20 次上限是按手机号（11 位）场景定的；发布流程里正文动辄几十字，
 * 20 次 DEL 必然留下残留，下一轮重输就变成「旧内容 + 新内容」，校验永远不过。
 * 这里按旧实现的本意（删干净）取 `len + 5`，不再截断。
 */
export async function clearPhoneInput(ctx: StepContext, content: string): Promise<void> {
  if (!content) return
  const times = content.length + 5
  for (let i = 0; i < times; i += 1) {
    await ctx.device.pressKey(ctx.serial, 'KEYCODE_DEL')
    await sleep(50 + ctx.random.next() * 30)
  }
}

/** 输入后回读校验的模式。 */
export type MatchMode = 'exact' | 'contains'

/**
 * 清空输入框直到回读为空。
 *
 * 旧实现只按长度删一次；但输入框可能对内容做截断（占位符、maxLength），
 * 按 `content.length` 算出的次数会不够，残留的旧内容会让下一轮重输变成
 * 「旧 + 新」，`contains` 校验永远失败。这里删完回读，没删干净就继续补删。
 */
async function clearUntilEmpty(
  ctx: StepContext,
  content: string,
  getPos: (root: UiNode) => InputPosition | Point | null,
): Promise<void> {
  let remaining = content.trim()
  for (let round = 0; round < 5 && remaining; round += 1) {
    await clearPhoneInput(ctx, remaining)
    await sleepRandom(ctx, 0.2, 0.4)
    const snapshot = await ctx.snapshot({ refresh: true })
    const pos = getPos(snapshot.root)
    const current = pos && 'text' in pos ? pos.text.trim() : ''
    // 回读与删除前一致说明 DEL 没生效（键盘未聚焦），再点一次输入框。
    if (current && current === remaining) {
      if (pos) await tapHuman(ctx, pos)
      await sleepRandom(ctx, 0.3, 0.6)
    }
    remaining = current
  }
}

/**
 * 输入文本后重新取坐标验证，不符合就重试（最多 3 次）。
 *
 * **1:1 移植** `type_with_verify`（178-215 行）：
 * - 重试时先重新点击输入框再输入
 * - `extra_texts` 逐条粘贴（正文 + 话题场景）
 * - `exact` 比较 strip 后全等；`contains` 判断期望串是否被包含
 * - 校验失败且框内已有内容时，先删干净再进入下一轮
 */
export async function typeWithVerify(
  ctx: StepContext,
  text: string,
  getPos: (root: UiNode) => InputPosition | Point | null,
  stepName = '输入',
  extraTexts: readonly string[] = [],
  matchMode: MatchMode = 'exact',
): Promise<boolean> {
  for (let retry = 0; retry < 3; retry += 1) {
    if (retry > 0) {
      const snapshot = await ctx.snapshot({ refresh: true })
      const pos = getPos(snapshot.root)
      if (pos) {
        await tapHuman(ctx, pos)
        await sleepRandom(ctx, 0.3, 0.6)
      }
    }

    // 逐条粘贴（旧实现 `paste_text(text)` + `for t in extra: paste_text(t)`）。
    if (text) await pasteText(ctx, text)
    for (const extra of extraTexts) {
      await pasteText(ctx, extra)
      await sleepRandom(ctx, 0.1, 0.2)
    }
    await sleepRandom(ctx, 0.3, 0.6)
    // 读回验证
    const snapshot = await ctx.snapshot({ refresh: true })
    const pos = getPos(snapshot.root)
    if (!pos) continue

    const actual = 'text' in pos ? pos.text : ''
    const expected = text + extraTexts.join('')
    // 换行归一化：设备回读的是 CRLF（\r\n），而我们发送的是 \n。
    // 直接比较会判定失败，进而把已经正确输入的内容删掉（实测只剩空白）。
    const norm = (value: string): string => value.replace(/\r\n/g, '\n')
    const actualNorm = norm(actual)
    const expectedNorm = norm(expected)
    const ok =
      matchMode === 'contains'
        ? actualNorm.includes(expectedNorm.trim())
        : actualNorm.trim() === expectedNorm.trim()

    if (ok) return true
    // 校验失败：框内已有内容就先删干净（删到回读为空），下一轮重输。
    if (actual.trim()) await clearUntilEmpty(ctx, actual, getPos)
  }
  return false
}
