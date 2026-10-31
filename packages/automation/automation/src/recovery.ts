import type { StepContext } from '@myt/flow'
import type { UiNode } from '@myt/device'

/**
 * 异常恢复：页面不对时怎么办。
 *
 * 三层递进（代价由低到高，能上一层解决就不走下一层）：
 *
 * ```
 * 第 1 层  循环等待           页面正在跳转，再等等
 *   ↓ 还不对
 * 第 2 层  规则表             已知异常页面 → 执行预定义动作（返回/点关闭/强杀重开）
 *   ↓ 没匹配到
 * 第 3 层  通用回退           按返回键逐级退出，退到目标页面
 *   ↓ 还不对
 *          停下报错            人工补规则
 * ```
 *
 * **为什么不用视觉模型判断**（2026-10-30 实测，见 docs/spec/flow-xhs-publish.md 补充四）：
 * - 整页截图 + 开放判断（「这是什么界面、下一步做什么」）：4/4 全错，20-26 秒
 * - 整页截图 + 是/否判断（「有没有返回按钮」）：2/4 对，20 秒
 * 异常场景本身就是「没见过的页面」，模型对这类页面没有可靠先验。
 */

/** 恢复动作。 */
export type RecoveryAction =
  /** 按一次返回键。 */
  | { kind: 'back' }
  /**
   * 点击固定坐标。
   *
   * **只在极端情况下用**：页面是纯 ImageView、抓不到任何控件
   * （例：小红书的 `MaterialPreviewActivity`，yadb 只抓到 12 个节点、零可点控件）。
   * 这种页面的按钮位置通常也固定，代价是换分辨率要改。
   */
  | { kind: 'tap'; x: number; y: number }
  /** 点击文字匹配的按钮。 */
  | { kind: 'tapText'; texts: readonly string[] }
  /**
   * 条件点击：只有当某文字存在时，才点固定坐标。
   *
   * 用于「同一页面有两种布局」的场景——例如图片编辑页的面板态
   * （有「完成」、下一步被遮挡）和编辑态（没有「完成」、下一步可见）。
   */
  | { kind: 'tapAtIfText'; texts: readonly string[]; x: number; y: number }
  /** 强杀 App 并用深链重新打开。 */
  | { kind: 'restart'; uri: string }

/**
 * 一条恢复规则。
 *
 * 匹配依据是**当前 Activity 名里的关键字**（系统级事实，不依赖 App 内部实现）。
 */
export interface RecoveryRule {
  /** 规则名，写进日志便于排查。 */
  name: string
  /** Activity 名包含任一关键字即命中。 */
  matches: readonly string[]
  /** 命中后执行的动作（按顺序）。 */
  actions: readonly RecoveryAction[]
}

/**
 * 恢复配置：由业务包提供。
 *
 * 引擎不认识任何具体 App——包名、首页深链、规则表都从外面传进来。
 */
export interface RecoveryConfig {
  /** 目标 App 的包名（强杀/重开要用）。 */
  packageName: string
  /** 兜底深链（回到起点，实测深链比逐级返回可靠）。 */
  homeUri: string
  /** 已知异常页面的恢复规则表。 */
  rules: readonly RecoveryRule[]
}

/** 恢复尝试的结果。 */
export interface RecoveryResult {
  /** 是否恢复成功（已到达期望页面）。 */
  ok: boolean
  /** 用了哪一层。 */
  layer: 'none' | 'rule' | 'generic'
  /** 命中的规则名（第 2 层）。 */
  rule?: string
  /** 过程描述，写进日志。 */
  trail: string[]
}

/** 读取当前前台 Activity（与 page-guard 的实现保持独立，避免循环依赖）。 */
async function readActivity(ctx: StepContext): Promise<string> {
  try {
    const out = await ctx.device.shell(ctx.serial, 'dumpsys window', {
      check: false,
      timeoutMs: 15_000,
    })
    const matched = /mCurrentFocus=Window\{[^}]*?\s([\w.]+)\/([\w.$]+)\}/.exec(out)
    return matched ? `${matched[1]}/${matched[2]}` : ''
  } catch {
    return ''
  }
}

/** 等待。 */
function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** 按文字在整棵树里找按钮（与 locators 的同名函数解耦，避免依赖方向倒置）。 */
function findTextPoint(root: UiNode, texts: readonly string[]): { x: number; y: number } | null {
  let fuzzy: { x: number; y: number } | null = null
  const walk = (node: UiNode): { x: number; y: number } | null => {
    const label = `${node.text} ${node.contentDesc}`.trim()
    if (label) {
      const [x1, y1, x2, y2] = node.bounds
      const point = { x: Math.floor((x1 + x2) / 2), y: Math.floor((y1 + y2) / 2) }
      for (const want of texts) {
        if (label === want) return point
        if (!fuzzy && label.includes(want)) fuzzy = point
      }
    }
    for (const child of node.children) {
      const found = walk(child)
      if (found) return found
    }
    return null
  }
  return walk(root) ?? fuzzy
}

/** 执行一条恢复动作。 */
async function runAction(
  ctx: StepContext,
  config: RecoveryConfig,
  action: RecoveryAction,
): Promise<string> {
  switch (action.kind) {
    case 'back':
      await ctx.device.back(ctx.serial)
      await sleep(1200)
      return '按返回键'
    case 'tap':
      await ctx.device.tap(ctx.serial, action.x, action.y)
      await sleep(1500)
      return `点击 (${action.x},${action.y})`
    case 'tapText': {
      const snapshot = await ctx.snapshot({ refresh: true })
      const point = findTextPoint(snapshot.root, action.texts)
      if (!point) return `未找到「${action.texts.join('/')}」`
      await ctx.device.tapLikeHuman(ctx.serial, point.x, point.y)
      await sleep(1500)
      return `点击「${action.texts[0]}」(${point.x},${point.y})`
    }
    case 'tapAtIfText': {
      const snapshot = await ctx.snapshot({ refresh: true })
      const marker = findTextPoint(snapshot.root, action.texts)
      if (!marker) return `无「${action.texts.join('/')}」，跳过`
      await ctx.device.tap(ctx.serial, action.x, action.y)
      await sleep(1500)
      return `存在「${action.texts[0]}」→ 点 (${action.x},${action.y})`
    }
    case 'restart':
      await ctx.device.forceStop(ctx.serial, config.packageName)
      await sleep(1500)
      await ctx.device.openUri(ctx.serial, action.uri, config.packageName)
      await sleep(4000)
      return `强杀重开 ${action.uri}`
  }
}

/**
 * 恢复到一个期望的页面集合。
 *
 * @param ctx 步骤上下文
 * @param isExpected 判断当前 Activity 是否已达期望
 * @param options 等待时长、最大回退次数
 */
export async function recoverTo(
  ctx: StepContext,
  config: RecoveryConfig,
  isExpected: (activity: string) => boolean,
  options: {
    waitMs?: number
    maxBacks?: number
    maxRules?: number
    /**
     * 第 3 层通用回退用的深链。默认首页。
     *
     * 目标不是首页时（例如目标是发布编辑页），传对应的深链，
     * 避免「恢复成功但回到了首页」这种无效恢复。
     */
    fallbackUri?: string
  } = {},
): Promise<RecoveryResult> {
  const waitMs = options.waitMs ?? 8_000
  const maxBacks = options.maxBacks ?? 3
  const maxRules = options.maxRules ?? 2
  const fallbackUri = options.fallbackUri ?? config.homeUri
  const trail: string[] = []

  // ── 第 1 层：循环等待（吸收页面跳转延迟）──
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    const activity = await readActivity(ctx)
    if (isExpected(activity)) {
      trail.push(`等待 ${waitMs - (deadline - Date.now())}ms 后到位`)
      return { ok: true, layer: 'none', trail }
    }
    await sleep(500)
  }
  trail.push(`${waitMs}ms 未到位`)

  // ── 第 2 层：规则表 ──
  for (let round = 0; round < maxRules; round += 1) {
    const activity = await readActivity(ctx)
    if (isExpected(activity)) return { ok: true, layer: 'rule', trail }

    const rule = config.rules.find((candidate) =>
      candidate.matches.some((marker) => activity.includes(marker)),
    )
    if (!rule) {
      trail.push('无匹配规则')
      break
    }

    for (const action of rule.actions) {
      const done = await runAction(ctx, config, action)
      trail.push(`${rule.name}：${done}`)
    }
    if (isExpected(await readActivity(ctx))) {
      return { ok: true, layer: 'rule', rule: rule.name, trail }
    }
  }

  // ── 第 3 层：通用回退 ──
  // 先试深链回首页（一次到位，实测有效）；再逐级按返回键。
  await ctx.device.openUri(ctx.serial, fallbackUri, config.packageName)
  await sleep(2500)
  trail.push(`深链兜底 ${fallbackUri}`)
  if (isExpected(await readActivity(ctx))) {
    return { ok: true, layer: 'generic', trail }
  }

  for (let i = 0; i < maxBacks; i += 1) {
    await ctx.device.back(ctx.serial)
    await sleep(1200)
    trail.push(`通用回退 ${i + 1}/${maxBacks}`)
    if (isExpected(await readActivity(ctx))) {
      return { ok: true, layer: 'generic', trail }
    }
  }

  return { ok: false, layer: 'generic', trail }
}

/** 判断 Activity 名是否属于一组页面标记。 */
export function activityMatches(activity: string, markers: readonly string[]): boolean {
  return markers.some((marker) => activity.includes(marker))
}

/** 回到首页深链（规则表之外的最后一招）。 */
export async function restartToHome(ctx: StepContext, config: RecoveryConfig): Promise<void> {
  await runAction(ctx, config, { kind: 'restart', uri: config.homeUri })
}
