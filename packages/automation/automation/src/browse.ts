/**
 * 自动化浏览：观察 → 操作 → 确认 → 继续。
 *
 * 所有设备操作通过 `DeviceControl` 契约完成，不直接调 adb——
 * 这样换 Provider（ADB / relay / 云手机）时本模块无需改动。
 *
 * 四拍缺一不可（实测教训）：
 * 之前只做「观察 → 操作」就继续，结果在搜索页上尝试「点首页」，
 * 候选里没有首页按钮，模型只能从 24 个目标里瞎选，点了不可点的「按住提问」。
 */

import { collectActionTargets, type ActionTarget } from '@myt/ui-perception'
import type { DeviceControl, UiNode, UiSnapshot } from '@myt/device'
import { locate } from '@myt/ui-decide'

/** 一步操作的完整记录。 */
export interface BrowseStep {
  /** 本步意图。 */
  intent: string
  /** 观察到的页面标识。 */
  pageBefore: string
  /** 操作后观察到的页面标识。 */
  pageAfter?: string
  /** 是否成功。 */
  ok: boolean
  /** 命中的目标名。 */
  targetName?: string
  /** 实际点击坐标。 */
  point?: { x: number; y: number }
  /** 失败原因。 */
  reason?: string
  /** 观察耗时。 */
  observeMs: number
  /** 定位+操作耗时。 */
  actMs: number
  /** 确认耗时。 */
  verifyMs: number
}

/** 一次浏览会话的结果。 */
export interface BrowseResult {
  /** 场景名。 */
  scenario: string
  /** 每一步记录。 */
  steps: BrowseStep[]
  /** 成功步数。 */
  succeeded: number
  /** 总步数。 */
  total: number
}

/** 调用 LLM 的函数签名。 */
export type LocateModel = (prompt: string) => Promise<string>

/** 浏览器：把设备操作与业务编排分开。 */
export class Browser {
  private readonly device: DeviceControl
  private readonly serial: string
  private readonly model: LocateModel

  constructor(device: DeviceControl, serial: string, model: LocateModel) {
    this.device = device
    this.serial = serial
    this.model = model
  }

  /**
   * 观察：读取当前页面标识。
   *
   * @returns 形如 `com.xingin.xhs/com.xingin.xhs.index.v2.IndexActivityV2`
   */
  async currentPage(): Promise<string> {
    try {
      const out = await this.device.shell(this.serial, 'dumpsys window', { check: false, timeoutMs: 15_000 })
      const matched = /mCurrentFocus=Window\{\S+\s+\S+\s+([^}]+)\}/.exec(out)
      return matched?.[1]?.trim() ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }

  /**
   * 观察：抓取当前界面的可操作目标。
   *
   * @param channel 抓取通道，默认 yadb（实测 0.3s vs uiautomator 2.2s）
   */
  async targets(channel: 'uiautomator' | 'yadb' = 'yadb'): Promise<ActionTarget[]> {
    const snapshot = await this.device.dumpUi(this.serial, { channel })
    return toTargets(snapshot)
  }

  /** 屏幕尺寸。 */
  async screenSize(): Promise<{ width: number; height: number }> {
    const out = await this.device.shell(this.serial, 'wm size', { check: false })
    const matched = /(\d+)x(\d+)/.exec(out)
    return matched ? { width: Number(matched[1]), height: Number(matched[2]) } : { width: 900, height: 1600 }
  }

  /** 点击一个目标。 */
  async tapTarget(target: ActionTarget): Promise<void> {
    await this.device.tap(this.serial, target.x, target.y)
  }

  /** 输入文本。 */
  async typeText(text: string): Promise<void> {
    await this.device.typeText(this.serial, text)
  }

  /** 发送按键。 */
  async pressKey(key: string): Promise<void> {
    await this.device.pressKey(this.serial, key)
  }

  /** 是否在 App 首页。 */
  async isHome(): Promise<boolean> {
    return /IndexActivity/.test(await this.currentPage())
  }

  /**
   * 返回上一步。
   *
   * @returns 是否真的发生了页面变化
   */
  async back(): Promise<boolean> {
    const before = await this.currentPage()
    await this.device.back(this.serial)
    await sleep(1200)
    return (await this.currentPage()) !== before
  }

  /**
   * 滚动手势。
   *
   * @param kind 方向
   */
  async scroll(kind: 'pull-refresh' | 'up' | 'down'): Promise<void> {
    const size = await this.screenSize()
    const cx = size.width / 2
    if (kind === 'pull-refresh') {
      await this.device.swipe(this.serial, { x: cx, y: size.height * 0.25 }, { x: cx, y: size.height * 0.75 }, 300)
    } else if (kind === 'up') {
      await this.device.swipe(this.serial, { x: cx, y: size.height * 0.75 }, { x: cx, y: size.height * 0.25 }, 300)
    } else {
      await this.device.swipe(this.serial, { x: cx, y: size.height * 0.25 }, { x: cx, y: size.height * 0.75 }, 300)
    }
  }

  /**
   * 一步完整操作：观察 → 定位 → 点击 → 确认。
   *
   * @param intent 意图
   * @param waitAfterMs 点击后等待多久再确认
   */
  async step(intent: string, waitAfterMs = 1200): Promise<BrowseStep> {
    const record: BrowseStep = {
      intent,
      pageBefore: 'unknown',
      ok: false,
      observeMs: 0,
      actMs: 0,
      verifyMs: 0,
    }

    // ① 观察
    const observeStart = Date.now()
    record.pageBefore = await this.currentPage()
    const targets = await this.targets()
    record.observeMs = Date.now() - observeStart

    // ② 定位 + 操作
    const actStart = Date.now()
    const result = await locate({ targets, intent }, this.model)
    if (!result.ok || !result.point) {
      record.actMs = Date.now() - actStart
      record.reason = result.reason ?? '定位失败'
      return record
    }
    record.targetName = result.target?.name
    record.point = result.point
    await this.device.tap(this.serial, result.point.x, result.point.y)
    record.actMs = Date.now() - actStart
    await sleep(waitAfterMs)

    // ③ 确认
    const verifyStart = Date.now()
    record.pageAfter = await this.currentPage()
    const after = await this.targets()
    record.verifyMs = Date.now() - verifyStart

    const pageChanged = record.pageBefore !== record.pageAfter
    const targetsChanged =
      after.length !== targets.length || after.some((t, i) => targets[i]?.name !== t.name)

    if (pageChanged || targetsChanged) {
      record.ok = true
    } else {
      record.reason = '操作后页面无变化（可能点击未生效）'
    }
    return record
  }

  /**
   * 手势操作，带确认。
   *
   * @param kind 手势类型
   */
  async gesture(kind: 'pull-refresh' | 'scroll-up' | 'scroll-down'): Promise<BrowseStep> {
    const record: BrowseStep = {
      intent: kind === 'pull-refresh' ? '下拉刷新' : kind === 'scroll-up' ? '向上滚动' : '向下滚动',
      pageBefore: 'unknown',
      ok: false,
      observeMs: 0,
      actMs: 0,
      verifyMs: 0,
    }

    const observeStart = Date.now()
    record.pageBefore = await this.currentPage()
    const before = await this.targets()
    record.observeMs = Date.now() - observeStart

    const actStart = Date.now()
    await this.scroll(kind === 'pull-refresh' ? 'pull-refresh' : kind === 'scroll-up' ? 'up' : 'down')
    record.actMs = Date.now() - actStart
    await sleep(1500)

    const verifyStart = Date.now()
    const after = await this.targets()
    record.pageAfter = await this.currentPage()
    record.verifyMs = Date.now() - verifyStart

    const changed = after.length !== before.length || after.some((t, i) => before[i]?.name !== t.name)
    record.ok = changed
    if (!changed) record.reason = '手势后内容无变化'
    return record
  }
}

/** 从 UiSnapshot 转成可操作目标。 */
function toTargets(snapshot: UiSnapshot): ActionTarget[] {
  const root = snapshot.root as unknown as UiNode & { bounds: [number, number, number, number] }
  const width = root.bounds?.[2] ?? 900
  const height = root.bounds?.[3] ?? 1600
  return collectActionTargets(
    {
      className: root.className,
      text: root.text,
      contentDesc: root.contentDesc,
      resourceId: root.resourceId,
      clickable: root.clickable,
      longClickable: false,
      scrollable: false,
      enabled: root.enabled,
      selected: root.selected,
      checked: root.checked,
      focused: root.focused,
      isPassword: false,
      bounds: root.bounds ?? [0, 0, width, height],
      children: root.children as never,
    },
    { width, height },
  )
}

/** 等待。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 随机整数。 */
function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/** 随机取一个。 */
function pick<T>(items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined
  return items[randomInt(0, items.length - 1)]
}

/**
 * 场景一：主页随机浏览。
 *
 * @param browser 浏览器
 * @param rounds 轮数
 */
export async function browseHome(browser: Browser, rounds = 3): Promise<BrowseResult> {
  const steps: BrowseStep[] = []

  for (let i = 0; i < rounds; i++) {
    const page = await browser.currentPage()
    if (!/IndexActivity/.test(page)) {
      const startedAt = Date.now()
      const changed = await browser.back()
      steps.push({
        intent: '返回首页',
        pageBefore: page,
        pageAfter: await browser.currentPage(),
        ok: changed,
        reason: changed ? undefined : '返回键无效',
        observeMs: 0,
        actMs: Date.now() - startedAt,
        verifyMs: 0,
      })
      if (!changed) break
      continue
    }

    const action = pick(['enter-note', 'pull-refresh', 'scroll-up', 'go-home'] as const)

    if (action === 'pull-refresh') {
      steps.push(await browser.gesture('pull-refresh'))
    } else if (action === 'scroll-up') {
      steps.push(await browser.gesture('scroll-up'))
    } else if (action === 'go-home') {
      steps.push(await browser.step('点击底部「首页」按钮'))
    } else {
      const observeStart = Date.now()
      const targets = await browser.targets()
      // 只选卡片：内容区还有笔记的点赞/收藏按钮，点它们不跳转
      const notes = targets.filter((t) => t.actionable && t.region === 'content' && t.kind === 'card')
      const note = pick(notes)
      const observeMs = Date.now() - observeStart
      if (!note) {
        steps.push({
          intent: '进入笔记',
          pageBefore: page,
          ok: false,
          reason: '内容区没有卡片目标',
          observeMs,
          actMs: 0,
          verifyMs: 0,
        })
        continue
      }
      const actStart = Date.now()
      await browser.tapTarget(note)
      await sleep(2000)
      const pageAfter = await browser.currentPage()
      steps.push({
        intent: '进入笔记',
        pageBefore: page,
        pageAfter,
        ok: pageAfter !== page,
        targetName: note.name.slice(0, 30),
        point: { x: note.x, y: note.y },
        reason: pageAfter === page ? '点击后页面未切换' : undefined,
        observeMs,
        actMs: Date.now() - actStart,
        verifyMs: 0,
      })
      if (pageAfter !== page) await browser.back()
    }
  }

  return {
    scenario: '主页随机浏览',
    steps,
    succeeded: steps.filter((s) => s.ok).length,
    total: steps.length,
  }
}

/**
 * 场景二：随机搜索浏览。
 *
 * @param browser 浏览器
 * @param keywords 关键词
 */
export async function browseSearch(
  browser: Browser,
  keywords: readonly string[] = ['美食', '旅行', '穿搭', '健身', '读书'],
): Promise<BrowseResult> {
  const steps: BrowseStep[] = []

  if (!(await browser.isHome())) {
    const pageBefore = await browser.currentPage()
    const startedAt = Date.now()
    const changed = await browser.back()
    steps.push({
      intent: '回到首页',
      pageBefore,
      pageAfter: await browser.currentPage(),
      ok: changed,
      observeMs: 0,
      actMs: Date.now() - startedAt,
      verifyMs: 0,
    })
  }

  const openSearch = await browser.step('点击右上角搜索按钮', 2000)
  steps.push({ ...openSearch, intent: '打开搜索' })
  if (!openSearch.ok) {
    return { scenario: '随机搜索浏览', steps, succeeded: steps.filter((s) => s.ok).length, total: steps.length }
  }

  // 输入关键词
  const keyword = pick(keywords) ?? '美食'
  const inputStart = Date.now()
  const pageBeforeInput = await browser.currentPage()
  try {
    await browser.typeText(keyword)
    await sleep(800)
    await browser.pressKey('KEYCODE_ENTER')
    await sleep(2500)
    const targets = await browser.targets()
    const hasResults = targets.some((t) => t.actionable && t.region === 'content')
    steps.push({
      intent: `搜索「${keyword}」`,
      pageBefore: pageBeforeInput,
      pageAfter: await browser.currentPage(),
      ok: hasResults,
      reason: hasResults ? undefined : '搜索结果为空',
      observeMs: 0,
      actMs: Date.now() - inputStart,
      verifyMs: 0,
    })
    if (!hasResults) {
      return { scenario: '随机搜索浏览', steps, succeeded: steps.filter((s) => s.ok).length, total: steps.length }
    }
  } catch (error) {
    steps.push({
      intent: `搜索「${keyword}」`,
      pageBefore: pageBeforeInput,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      observeMs: 0,
      actMs: Date.now() - inputStart,
      verifyMs: 0,
    })
    return { scenario: '随机搜索浏览', steps, succeeded: steps.filter((s) => s.ok).length, total: steps.length }
  }

  // 浏览结果
  const observeStart = Date.now()
  const targets = await browser.targets()
  const notes = targets.filter((t) => t.actionable && t.region === 'content' && t.kind === 'card')
  const note = pick(notes)
  const observeMs = Date.now() - observeStart
  if (!note) {
    steps.push({
      intent: '浏览搜索结果',
      pageBefore: await browser.currentPage(),
      ok: false,
      reason: '没有卡片目标',
      observeMs,
      actMs: 0,
      verifyMs: 0,
    })
    return { scenario: '随机搜索浏览', steps, succeeded: steps.filter((s) => s.ok).length, total: steps.length }
  }

  const pageBeforeNote = await browser.currentPage()
  const actStart = Date.now()
  await browser.tapTarget(note)
  await sleep(2500)
  const pageAfterNote = await browser.currentPage()
  steps.push({
    intent: '浏览搜索结果',
    pageBefore: pageBeforeNote,
    pageAfter: pageAfterNote,
    ok: pageAfterNote !== pageBeforeNote,
    targetName: note.name.slice(0, 30),
    point: { x: note.x, y: note.y },
    reason: pageAfterNote === pageBeforeNote ? '点击后未跳转' : undefined,
    observeMs,
    actMs: Date.now() - actStart,
    verifyMs: 0,
  })
  if (pageAfterNote !== pageBeforeNote) {
    await browser.back()
    await browser.back()
  }

  return {
    scenario: '随机搜索浏览',
    steps,
    succeeded: steps.filter((s) => s.ok).length,
    total: steps.length,
  }
}
