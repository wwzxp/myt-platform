import type { StepContext } from '@myt/flow'

import { translateTerms, type AlignTable } from './keyword-align.ts'
import type { AlignModel } from './keyword-align-store.ts'
import { readScreenText, type VisionModel } from './screen-ocr.ts'
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
  /**
   * 页面内容特征：界面上必须同时出现的文字。
   *
   * 用于「焦点 Activity 与真实页面不一致」的场景——实测小红书长文编辑页
   * 内嵌在文字编辑页里，`mCurrentFocus` 报的是旧的 `IndexActivityV2`，
   * 只能靠界面上的「一键排版」「输入标题」这类文字认出来。
   */
  contentMarkers?: readonly string[]
  /**
   * 界面关键词：用来判断页面 id 的**独有**词（中文）。
   *
   * 与 `contentMarkers` 的区别：
   * - `contentMarkers` 要求**全部**出现，用于「焦点 Activity 不对」的兜底；
   * - `keywords` 按**命中数量**打分，需要领先第二名才算数，用于更宽松的判定。
   *
   * 跨语言由 `keyword-align.ts` 处理：词表只维护中文，英文界面先查对齐表转中文。
   */
  keywords?: readonly string[]
  /**
   * 属性条件：按 XML 属性匹配页面，**任意一组命中最少一个节点**即判为该页。
   *
   * 组内条件是 AND；数组之间是 OR。值以 `~` 开头表示「包含」，否则精确相等。
   *
   * 之所以做成通用结构而不是某个 App 的特例：`class`、`selected`、`checked`
   * 这些是 Android 标准属性，`androidx.appcompat.app.ActionBar$Tab` 这类类名
   * 在所有用 ActionBar 的 App 上都一样；`resource-id` 在混淆过的 App 上不可靠，
   * 但别的 App 可能正好是稳定指纹——交给使用者决定。
   *
   * 例：
   * ```json
   * [{ "class": "~ActionBar$Tab", "selected": "true", "content-desc": "发现" }]
   * ```
   */
  attributes?: ReadonlyArray<Readonly<Record<string, string>>>
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

  /**
   * 用界面文字识别页面（Activity 认不出时的兜底）。
   *
   * 只考虑声明了 `contentMarkers` 的页面，且要求**全部**特征文字都出现。
   * 按注册顺序取第一个命中项——所以具体页面要排在通用页面之前。
   *
   * @param texts - 当前界面上的全部文字。
   */
  resolveByContent(texts: readonly string[]): string {
    const joined = texts.join('\n')
    for (const page of this.pages) {
      const markers = page.contentMarkers
      if (!markers || markers.length === 0) continue
      if (markers.every((marker) => joined.includes(marker))) return page.id
    }
    return UNKNOWN_PAGE
  }

  /** 是否有任何页面声明了内容特征（没有就不必取快照）。 */
  hasContentMarkers(): boolean {
    return this.pages.some((page) => (page.contentMarkers?.length ?? 0) > 0)
  }

  /** 是否有任何页面声明了界面关键词。 */
  hasKeywords(): boolean {
    return this.pages.some((page) => (page.keywords?.length ?? 0) > 0)
  }

  /** 收集全部页面的关键词（去重，供跨语言对齐用）。 */
  allKeywords(): readonly string[] {
    const out = new Set<string>()
    for (const page of this.pages) for (const kw of page.keywords ?? []) out.add(kw)
    return [...out]
  }

  /** 是否有任何页面声明了属性条件。 */
  hasAttributes(): boolean {
    return this.pages.some((page) => (page.attributes?.length ?? 0) > 0)
  }

  /**
   * 用 XML 属性判定页面。
   *
   * `nodes` 是每个节点的属性表（键为属性名，值与 XML 一致）。
   * 任意一组条件命中最少一个节点即可；多页命中取「条件最具体」的（字段最多）。
   *
   * @param nodes - 节点属性列表
   */
  resolveByAttributes(nodes: ReadonlyArray<Readonly<Record<string, string>>>): string {
    const matches = (node: Readonly<Record<string, string>>, rule: Readonly<Record<string, string>>): boolean => {
      for (const [key, expected] of Object.entries(rule)) {
        const actual = node[key] ?? ''
        const wantsContains = expected.startsWith('~')
        const target = wantsContains ? expected.slice(1) : expected
        if (target === '') continue
        if (wantsContains ? !actual.includes(target) : actual !== target) return false
      }
      return true
    }

    let best: { id: string; weight: number } | undefined
    for (const page of this.pages) {
      for (const rule of page.attributes ?? []) {
        const fields = Object.keys(rule).filter((k) => (rule[k] ?? '') !== '')
        if (fields.length === 0) continue
        if (!nodes.some((node) => matches(node, rule))) continue
        // 条件字段越多越具体：避免「任意 Tab 选中」压过「特定 Tab 选中」。
        if (!best || fields.length > best.weight) best = { id: page.id, weight: fields.length }
      }
    }
    return best?.id ?? UNKNOWN_PAGE
  }

  /**
   * 用界面关键词判定页面。
   *
   * 规则：命中数最多的页面胜出，且必须**领先**第二名；
   * 打平或一个都没命中就返回 `UNKNOWN_PAGE`。
   * 这样避免「全部」「视频」这类跨页通用词把结果搅浑。
   *
   * @param texts - 界面上的全部文字（中文；英文需先经对齐表转换）。
   */
  resolveByKeywords(texts: readonly string[]): string {
    // 逐条比对而不是拼接后 `includes`：
    // 拼起来会让「随便什么文字」这类正文命中关键词「文字」，实测踩过。
    const entries = texts.map((t) => t.trim()).filter(Boolean)
    const matches = (entry: string, keyword: string): boolean => {
      if (keyword.length < 2) return false
      if (!entry.includes(keyword)) return false
      // 整条相等最常见（按钮标签），直接放行。
      if (entry === keyword) return true
      // 否则要求关键词占该条文字的一半以上：
      // 允许「实况图」命中「实况图（3）」这类带后缀的标签，
      // 但排除正文里偶然出现的词（「随便什么文字」只占 1/3，剔除）。
      return keyword.length * 2 >= entry.length
    }

    // 打分而不是数命中个数：词越长越具体，权重越高。
    const weightOf = (keyword: string): number => keyword.length

    const scored = this.pages
      .map((page) => {
        const hits = (page.keywords ?? []).filter((kw) => entries.some((t) => matches(t, kw)))
        return { id: page.id, hits, score: hits.reduce((sum, kw) => sum + weightOf(kw), 0) }
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)

    const first = scored[0]
    if (!first) return UNKNOWN_PAGE

    // 最低分门槛：约等于「一个 3 字词」或「两个 2 字词」。
    const MIN_SCORE = 3
    if (first.score < MIN_SCORE) return UNKNOWN_PAGE

    const second = scored[1]
    // 打平就不判——宁可 unknown，也不要随机选一个。
    if (second && second.score >= first.score) return UNKNOWN_PAGE
    return first.id
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
/** 对齐表来源：可以是静态表，也可以是会自动补词的缓存。 */
export type AlignSource =
  | AlignTable
  | {
      /** 取当前表。 */
      get(): AlignTable
      /** 补齐缺失词（内部可能调用模型）。 */
      ensure(terms: readonly string[], zhWords: readonly string[], model: AlignModel): Promise<number>
    }

/** 静态对齐表：键值都是字符串。 */
function isPlainTable(value: AlignTable): boolean {
  return Object.values(value).every((v) => typeof v === 'string')
}

/** 判断传入的是「缓存对象」而不是「静态表」。 */
function isAlignCache(source: AlignSource): source is Extract<AlignSource, { get(): AlignTable }> {
  return typeof (source as { get?: unknown }).get === 'function'
}

export interface CurrentPageOptions {
  /** 跨语言对齐（静态表或缓存）。 */
  align?: AlignSource | undefined
  /** 文本模型：自动补对齐表用。 */
  model?: AlignModel | undefined
  /** 视觉模型：XML 抓不到文字时，从截图里读字。 */
  vision?: VisionModel | undefined
}

export async function currentPage(
  ctx: StepContext,
  pages: PageRegistry,
  alignOrOptions?: AlignSource | CurrentPageOptions,
  model?: AlignModel,
): Promise<string> {
  // 兼容两种调用：老签名 (ctx, pages, align, model) 与新签名 (ctx, pages, { align, model, vision })
  const isOptionsObject = (v: unknown): v is CurrentPageOptions =>
    typeof v === 'object' && v !== null && ('vision' in v || ('align' in v && !isPlainTable(v as AlignTable)))
  // 没显式传就退回 ctx 上挂的默认能力（由 RunOptions.pageIdentify 装配）。
  const explicit: CurrentPageOptions | undefined = isOptionsObject(alignOrOptions)
    ? alignOrOptions
    : alignOrOptions !== undefined || model !== undefined
      ? { align: alignOrOptions as AlignSource | undefined, model }
      : undefined
  const fallback = ctx.pageIdentify
  const options: CurrentPageOptions = explicit ?? {
    align: fallback?.align as AlignSource | undefined,
    model: fallback?.alignModel,
    vision: fallback?.vision,
  }
  const align = options.align
  const vision = options.vision
  model = options.model
  const activity = await currentActivity(ctx)
  if (activity) {
    const byActivity = pages.resolve(activity)
    if (byActivity !== UNKNOWN_PAGE) return byActivity
  }

  // 下面全是「Activity 认不出」时的文字兜底。
  // 实测长文编辑页内嵌在文字编辑页里，焦点常驻在旧 Activity 上。
  if (!pages.hasContentMarkers() && !pages.hasKeywords() && !pages.hasAttributes()) {
    return UNKNOWN_PAGE
  }
  const cache = align && isAlignCache(align) ? align : undefined

  let texts: string[]
  const attrs: Record<string, string>[] = []
  try {
    const snapshot = await ctx.snapshot({ refresh: true })
    texts = []
    const walk = (node: {
      text?: string
      contentDesc?: string
      className?: string
      resourceId?: string
      packageName?: string
      selected?: boolean
      checked?: boolean
      clickable?: boolean
      enabled?: boolean
      focused?: boolean
      scrollable?: boolean
      children?: readonly unknown[]
    }): void => {
      if (node.text) texts.push(node.text)
      if (node.contentDesc) texts.push(node.contentDesc)
      // 属性表用 XML 里的原始键名，方便页面表直接照抄 dumpsys/uiautomator 的值。
      if (pages.hasAttributes()) {
        attrs.push({
          text: node.text ?? '',
          'content-desc': node.contentDesc ?? '',
          class: node.className ?? '',
          'resource-id': node.resourceId ?? '',
          package: node.packageName ?? '',
          selected: node.selected ? 'true' : 'false',
          checked: node.checked ? 'true' : 'false',
          clickable: node.clickable ? 'true' : 'false',
          enabled: node.enabled ? 'true' : 'false',
          focused: node.focused ? 'true' : 'false',
          scrollable: node.scrollable ? 'true' : 'false',
        })
      }
      for (const child of node.children ?? []) walk(child as never)
    }
    walk(snapshot.root as never)
  } catch {
    return UNKNOWN_PAGE
  }

  // 属性优先：类是标准控件、选中态是系统状态，比文字更稳，也比文字更便宜。
  if (pages.hasAttributes()) {
    const byAttr = pages.resolveByAttributes(attrs)
    if (byAttr !== UNKNOWN_PAGE) return byAttr

    // 属性的值也可能被本地化（`content-desc="发现"` / `"Explore"`），
    // 与关键词同一套对齐表：把文本类属性翻译后再试一次。
    if (align) {
      const table = cache ? cache.get() : (align as AlignTable)
      const translated = attrs.map((node) => ({
        ...node,
        text: table[(node['text'] ?? '').toLowerCase()] ?? node['text'] ?? '',
        'content-desc': table[(node['content-desc'] ?? '').toLowerCase()] ?? node['content-desc'] ?? '',
      }))
      const byAttrZh = pages.resolveByAttributes(translated)
      if (byAttrZh !== UNKNOWN_PAGE) return byAttrZh
    }
  }

  // 先试 contentMarkers（要求全部出现，最严格）。
  const byContent = pages.resolveByContent(texts)
  if (byContent !== UNKNOWN_PAGE) return byContent

  // 再试关键词打分。
  // 不做语言判断：实测英文界面里混着大量中文正文（帖子文案），
  // 按字符占比猜语言会误判成中文、跳过翻译。改成「先原文、不中再翻译」。
  if (!pages.hasKeywords()) return UNKNOWN_PAGE

  const direct = pages.resolveByKeywords(texts)
  if (direct !== UNKNOWN_PAGE) return direct

  // XML 里几乎没有文字（纯图片页）：让视觉模型把字读出来，再走同一套匹配。
  // 模型只负责「读」，判断仍由关键词完成——实测直接让模型选页面会全错。
  if (vision && texts.filter((t) => t.trim().length >= 2).length < 3) {
    const shot = await ctx.device.screenshot(ctx.serial)
    const read = await readScreenText(shot, vision)
    if (read.length > 0) {
      const byRead = pages.resolveByKeywords(read)
      if (byRead !== UNKNOWN_PAGE) return byRead
      if (align) {
        const table = cache ? cache.get() : (align as AlignTable)
        const byReadZh = pages.resolveByKeywords(translateTerms(read, table))
        if (byReadZh !== UNKNOWN_PAGE) return byReadZh
      }
    }
  }

  if (!align) return UNKNOWN_PAGE

  const tableOf = (): AlignTable => (cache ? cache.get() : (align as AlignTable))
  const translated = pages.resolveByKeywords(translateTerms(texts, tableOf()))
  if (translated !== UNKNOWN_PAGE) return translated

  // 还是认不出，而且给得起模型：补一轮对齐表再试一次。
  // 只补「表里没有的词」，补完落盘，之后不再调用模型。
  if (!model || !cache) return UNKNOWN_PAGE
  try {
    const added = await cache.ensure(texts, pages.allKeywords(), model)
    if (added === 0) return UNKNOWN_PAGE
    return pages.resolveByKeywords(translateTerms(texts, tableOf()))
  } catch {
    // 模型不可用时按 unknown 处理，不影响主流程。
    return UNKNOWN_PAGE
  }
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
