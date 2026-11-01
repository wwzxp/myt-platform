/**
 * 设备侧关键词采集：停在某个页面，抓 N 次（可选滚动），算出该页独有词。
 *
 * 纯统计逻辑在 `@myt/automation` 的 `collectKeywords`；
 * 这里只负责「怎么抓」——采样、滚动、去重后交给统计。
 *
 * 未来的「采集当前页面」按钮直接调这个函数即可。
 */
import type { StepContext } from '@myt/flow'

import { assessCollection, collectKeywords, type PageSample } from '@myt/automation'

/** 采集参数。 */
export interface CollectPageOptions {
  /** 采样次数，默认 3。 */
  samples?: number
  /** 每次采样之间是否滚动（让正文变化、界面元素保持），默认 true。 */
  scroll?: boolean
  /** 每次采样之间的等待（毫秒），默认 800。 */
  intervalMs?: number
}

/** 采集结果。 */
export interface CollectPageResult {
  pageId: string
  keywords: string[]
  /** 不可信时的原因（词太少等）。 */
  warning?: string
  /** 每次采样各抓到多少条文字，便于排查。 */
  sampleSizes: number[]
}

/**
 * 从一个页面上采集关键词。
 *
 * @param ctx - 步骤上下文（用 `snapshot` 拿 UI 树、`device.shell` 滚动）
 * @param pageId - 用户标注的页面 id
 */
export async function collectPageKeywords(
  ctx: StepContext,
  pageId: string,
  options: CollectPageOptions = {},
): Promise<CollectPageResult> {
  const samples = Math.max(1, options.samples ?? 3)
  const scroll = options.scroll ?? true
  const intervalMs = options.intervalMs ?? 800

  const collected: PageSample[] = []
  const sampleSizes: number[] = []

  for (let i = 0; i < samples; i += 1) {
    if (i > 0 && scroll) {
      // 向上滑半屏，让正文变化；界面固定元素（导航/工具栏）不会变。
      await ctx.device.shell(ctx.serial, 'input swipe 540 1200 540 700 300', { check: false, timeoutMs: 10_000 })
      await sleep(intervalMs)
    }
    const snapshot = await ctx.snapshot({ refresh: true })
    const texts: string[] = []
    const walk = (node: { text?: string; contentDesc?: string; children?: readonly unknown[] }): void => {
      if (node.text) texts.push(node.text)
      if (node.contentDesc) texts.push(node.contentDesc)
      for (const child of node.children ?? []) walk(child as never)
    }
    walk(snapshot.root as never)
    sampleSizes.push(texts.length)
    collected.push({ pageId, texts })
  }

  const all = collectKeywords(collected)
  const keywords = all[pageId] ?? []
  const verdict = assessCollection(keywords)
  return {
    pageId,
    keywords,
    ...(verdict.ok ? {} : { warning: verdict.reason }),
    sampleSizes,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
