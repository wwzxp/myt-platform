import type { StepContext } from '@myt/flow'
import { activityMatches, recoverTo } from './recovery.ts'

/**
 * 页面识别：每一步操作前先确认「自己在哪个界面」。
 *
 * 为什么必须有这个：
 * 之前 17 步里只有 `skip-image-editor` 检查了页面，其余步骤拿不到目标就地空转，
 * 或者把别的页面当成目标页面点击——实测出现过「在图库里点『一键成片』」、
 * 「在首页点发布按钮」这类偏航，而且流程不会报错，只是最后一步失败。
 *
 * 页面标识取自 `dumpsys window` 的 `mCurrentFocus`，是系统级事实，
 * 不依赖任何 App 内部实现。
 */

/**
 * 页面定义：业务包自己声明「有哪些页面、各自怎么认」。
 *
 * 引擎只认 `id` 字符串，不认识任何具体页面——
 * 换个 App（抖音、快手）只需注册自己的页面表，引擎代码不用动。
 */
export interface PageSpec {
  /** 页面 id，由业务包定义（如 `home` / `post-editor`）。 */
  id: string
  /** Activity 名包含任一关键字即命中该页面。 */
  markers: readonly string[]
}

/** 未识别出的页面 id。 */
export const UNKNOWN_PAGE = 'unknown'

/**
 * 页面注册表。
 *
 * 匹配按**注册顺序**取第一个命中项，所以业务包要把更具体的页面放前面
 * （例如 `post-editor` 要排在 `album` 之前）。
 */
export class PageRegistry {
  private readonly pages: PageSpec[] = []

  /** 注册一批页面。 */
  register(pages: readonly PageSpec[]): this {
    this.pages.push(...pages)
    return this
  }

  /** 从 Activity 名解析页面 id；没有命中返回 `UNKNOWN_PAGE`。 */
  resolve(activity: string): string {
    for (const page of this.pages) {
      if (page.markers.some((marker) => activity.includes(marker))) return page.id
    }
    return UNKNOWN_PAGE
  }

  /** 取某页面的关键字（用于恢复层判断）。 */
  markersOf(id: string): readonly string[] {
    return this.pages.find((page) => page.id === id)?.markers ?? []
  }
}

/** 读取当前前台页面的原始标识（`mCurrentFocus` 里的 Activity 名）。 */
export async function currentActivity(ctx: StepContext): Promise<string> {
  try {
    const out = await ctx.device.shell(ctx.serial, 'dumpsys window', {
      check: false,
      timeoutMs: 15_000,
    })
    // mCurrentFocus=Window{hash u0 pkg/activity.Name}
    const matched = /mCurrentFocus=Window\{[^}]*?\s([\w.]+)\/([\w.$]+)\}/.exec(out)
    if (!matched) return ''
    return `${matched[1]}/${matched[2]}`
  } catch {
    return ''
  }
}

/**
 * 判断当前处于哪个页面。
 *
 * @param ctx 步骤上下文
 * @param pages 页面注册表（由业务包提供）
 */
export async function currentPage(ctx: StepContext, pages: PageRegistry): Promise<string> {
  const activity = await currentActivity(ctx)
  if (!activity) return UNKNOWN_PAGE
  return pages.resolve(activity)
}

/**
 * 等待进入指定页面（可接受多个候选）。
 *
 * @param ctx 步骤上下文
 * @param expected 期望的页面
 * @param timeoutMs 超时
 * @returns 实际进入的页面；超时返回最后一次观测结果
 */
export async function waitForPage(
  ctx: StepContext,
  pages: PageRegistry,
  expected: readonly string[],
  timeoutMs = 15_000,
  onObserve?: (page: string) => void,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let last: string = UNKNOWN_PAGE
  while (Date.now() < deadline) {
    last = await currentPage(ctx, pages)
    onObserve?.(last)
    if (expected.includes(last)) return last
    await sleep(400)
  }
  return last
}

/**
 * 断言当前页面，不在期望页面时先走三层恢复。
 *
 * 恢复顺序（见 `recovery.ts`）：
 * 1. 循环等待（页面可能正在跳转）
 * 2. 规则表（已知异常页面 → 预定义动作）
 * 3. 通用回退（逐级返回）
 *
 * 三层都失败才抛错——此时确实是「定义之外的异常」，需要人工补规则。
 *
 * @param ctx 步骤上下文
 * @param expected 期望页面
 * @param stepName 步骤名（写进错误信息）
 * @param recoverable 是否允许尝试恢复。**填写类步骤传 false**：
 *        此时已有输入内容，退回会丢数据，宁可失败重跑。
 */
export async function assertPage(
  ctx: StepContext,
  pages: PageRegistry,
  expected: readonly string[],
  stepName: string,
  recoverable = true,
): Promise<string> {
  const page = await currentPage(ctx, pages)
  if (expected.includes(page)) return page

  if (!recoverable) {
    throw new Error(
      `${stepName}：当前页面是 ${page}，期望 ${expected.join('/')}（不在正确界面，已中止）`,
    )
  }

  const markers = expected.flatMap((wanted) => [...pages.markersOf(wanted)])
  const recovered = await recoverTo(
    ctx,
    {
      packageName: (ctx as StepContext & { packageName?: string }).packageName ?? '',
      homeUri: (ctx as StepContext & { homeUri?: string }).homeUri ?? '',
      rules: [],
    },
    (activity) => activityMatches(activity, markers),
  )
  if (recovered.ok) {
    const after = await currentPage(ctx, pages)
    if (expected.includes(after)) return after
  }

  throw new Error(
    `${stepName}：当前页面是 ${page}，期望 ${expected.join('/')}；` +
      `恢复失败（${recovered.layer}：${recovered.trail.slice(-3).join(' → ')}）`,
  )
}

export async function ensurePage(
  ctx: StepContext,
  pages: PageRegistry,
  expected: readonly string[],
  maxBacks = 3,
): Promise<boolean> {
  for (let i = 0; i < maxBacks; i += 1) {
    const page = await currentPage(ctx, pages)
    if (expected.includes(page)) return true
    await ctx.device.back(ctx.serial)
    await sleep(1000)
  }
  const page = await currentPage(ctx, pages)
  return expected.includes(page)
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}
