import type { StepContext } from '@myt/flow'
import type { UiNode } from '@myt/device'
import { currentPage } from '../page-guard.ts'
import type { PageRegistry } from '../page-guard.ts'
import { locateByModel } from '../locate-adapter.ts'
import { clearPhoneInput, sleepRandom, tapHuman, typeWithVerify } from '../actions.ts'
import { isLoopType } from './types.ts'
import type {
  ActionNodeConfig,
  ConditionNodeConfig,
  FlowGraph,
  FlowNode,
  GraphOutcome,
  LoopNodeConfig,
  PortId,
} from './types.ts'

/**
 * 图引擎：按端口路由执行流程图。
 *
 * 与旧引擎的差别：
 * - 旧：`runActions` 顺序执行数组，失败即停，所有分支逻辑写在代码里
 * - 新：按节点端口找下一条边，失败/页面不符走哪条路由**图**决定
 *
 * 执行语义：
 * 1. 从 `entry` 开始
 * 2. 执行节点，得到它选择的端口
 * 3. 按 `(sourceNodeID, sourcePortID)` 找唯一的边，跳到下一个节点
 * 4. 到达 `end` 正常结束；超过 `maxSteps` 抛错
 */

/** 自定义动作注册表：JSON 里只能写名字，实现由业务包注入。 */
export type CustomActions = Record<string, (ctx: StepContext) => Promise<void>>

/** 自定义校验注册表。 */
export type CustomVerifiers = Record<string, (ctx: StepContext) => Promise<boolean>>

/** 自定义测量器（用于 `countAtLeast`）。 */
export type CustomMeasures = Record<string, (ctx: StepContext) => Promise<number>>

/** 定位器表：JSON 里写名字，运行时查表。 */
export type LocatorTable = Record<string, (root: UiNode) => { x: number; y: number; text?: string } | null>

/** 执行图所需的运行时依赖。 */
export interface GraphRuntime {
  /** 页面注册表。 */
  pages: PageRegistry
  /** 兜底定位器表。 */
  locators: LocatorTable
  /** 自定义动作。 */
  actions?: CustomActions
  /** 自定义校验。 */
  verifiers?: CustomVerifiers
  /** 自定义测量。 */
  measures?: CustomMeasures
}

/** 节点执行结果：选了哪个端口。 */
export interface NodeResult {
  /** 走哪个端口。 */
  port: PortId
  /** 失败原因（port 为 failure/mismatch 时）。 */
  reason?: string
}

/**
 * 执行一张图。
 *
 * @param ctx 步骤上下文
 * @param graph 流程图
 * @param runtime 运行时依赖（定位器、自定义动作）
 */
export async function runGraph(
  ctx: StepContext,
  graph: FlowGraph,
  runtime: GraphRuntime,
): Promise<GraphOutcome> {
  const startedAt = Date.now()
  const trail: GraphOutcome['trail'] = []
  const edgesByPort = new Map<string, string>()
  for (const edge of graph.edges) {
    edgesByPort.set(`${edge.sourceNodeID}:${edge.sourcePortID}`, edge.targetNodeID)
  }
  /**
   * 节点索引：**含容器内的子节点**，因为 edges 用节点 id 引用、不分层级。
   */
  const nodeById = new Map<string, FlowNode>()
  const collect = (nodes: readonly FlowNode[]): void => {
    for (const node of nodes) {
      nodeById.set(node.id, node)
      if (node.blocks) collect(node.blocks)
    }
  }
  collect(graph.nodes)

  let current = graph.entry
  let steps = 0
  /** 进入当前节点用的是哪个端口（用于判断 end 是否算成功）。 */
  let enteredFrom: PortId | undefined

  while (steps < graph.data.maxSteps && current) {
    steps += 1
    ctx.throwIfCancelled()

    const node = nodeById.get(current)
    if (!node) {
      return {
        ok: false,
        trail,
        failedAt: current,
        reason: `节点不存在：${current}`,
        ms: Date.now() - startedAt,
      }
    }

    const nodeStartedAt = Date.now()
    if (node.type === 'end') {
      trail.push({ node: node.id, ms: Date.now() - nodeStartedAt })
      // 从哪个端口进入 end 决定成败：只有 success 算正常完成。
      // 经 failure / mismatch 到 end 是「失败后中止」，必须报失败——
      // 否则流程静默成功，实际什么都没做（实测踩过）。
      // 成功进入 end 的端口：
      // - undefined：entry 直接就是 end（退化图）
      // - out：start 直接连 end
      // - success：动作成功
      // - done：循环正常退出（不是失败）
      // - true/false：条件分支的汇合（两条都是正常路径）
      const successPorts: PortId[] = ['out', 'success', 'done', 'true', 'false']
      const ok = enteredFrom === undefined || successPorts.includes(enteredFrom)
      return {
        ok,
        trail,
        reason: ok ? undefined : `经「${enteredFrom}」端口中止`,
        ms: Date.now() - startedAt,
      }
    }

    // 每个节点执行前丢弃上一步的 UI 快照：上一步已改变界面，
    // 复用旧快照会定位到已消失的元素（与步骤引擎 `FlowRunner` 语义一致）。
    ctx.invalidateSnapshot?.()

    // 容器式循环：先把 blocks 跑 max 轮，再走 done 端口
    let result: NodeResult
    if (isLoopType(node.type)) {
      result = await runLoopContainer(ctx, node, runtime, edgesByPort, nodeById, trail, graph.data.maxSteps)
    } else {
      result = await executeNode(ctx, node, runtime)
    }
    trail.push({ node: node.id, port: result.port, ms: Date.now() - nodeStartedAt })

    const next = edgesByPort.get(`${node.id}:${result.port}`)
    if (!next) {
      return {
        ok: false,
        trail,
        failedAt: node.id,
        reason: result.reason ?? `节点「${node.data.title}」的端口 ${result.port} 没有连线`,
        ms: Date.now() - startedAt,
      }
    }
    enteredFrom = result.port
    current = next
  }

  return {
    ok: false,
    trail,
    failedAt: current,
    reason: `超过最大步数 ${graph.data.maxSteps}，可能存在环形连线`,
    ms: Date.now() - startedAt,
  }
}

/**
 * 执行单个节点，返回它选择的端口。
 *
 * 这是第二层测试接缝：每种节点类型可以单独验证。
 */
export async function executeNode(
  ctx: StepContext,
  node: FlowNode,
  runtime: GraphRuntime,
): Promise<NodeResult> {
  switch (node.type) {
    case 'start':
      return { port: 'out' }
    case 'end':
      return { port: 'done' }
    case 'mt-action':
      return executeActionNode(ctx, node, runtime)
    case 'mt-condition':
      return executeConditionNode(ctx, node, runtime)
    case 'mt-loop':
    case 'loop':
      // 容器式循环由 runLoopContainer 处理；单节点执行时视为配置读取
      return { port: 'done' }
  }
}

/** 执行动作节点。 */
async function executeActionNode(
  ctx: StepContext,
  node: FlowNode,
  runtime: GraphRuntime,
): Promise<NodeResult> {
  const config = node.data as unknown as ActionNodeConfig | undefined
  if (!config) return { port: 'failure', reason: `动作节点「${node.data.title}」缺少配置` }

  // ① 页面前置检查（不符走 mismatch）
  const page = await currentPage(ctx, runtime.pages)
  const requires = config.requires ?? []
  if (requires.length > 0 && !requires.includes(page)) {
    return { port: 'mismatch', reason: `当前页面是 ${page}，期望 ${requires.join('/')}` }
  }

  // ② 执行方式缺失：配置写漏了，直接判失败（不能让异常冒出去）
  if (!config.act) {
    return { port: 'failure', reason: `动作节点「${node.data.title}」缺少 act（执行方式）` }
  }

  // ③ 自定义动作（不需要定位）
  if (config.act.kind === 'custom') {
    const run = runtime.actions?.[config.act.name]
    if (!run) return { port: 'failure', reason: `未注册自定义动作：${config.act.name}` }
    try {
      await run(ctx)
    } catch (error) {
      return { port: 'failure', reason: error instanceof Error ? error.message : String(error) }
    }
    if (config.settle) await sleepRandom(ctx, config.settle[0], config.settle[1])
    return { port: 'success' }
  }

  // ④ 不需要定位的动作
  if (config.act.kind === 'back') {
    await ctx.device.back(ctx.serial)
    if (config.settle) await sleepRandom(ctx, config.settle[0], config.settle[1])
    return { port: 'success' }
  }
  if (config.act.kind === 'openUri') {
    await ctx.device.openUri(ctx.serial, config.act.uri)
    if (config.settle) await sleepRandom(ctx, config.settle[0], config.settle[1])
    return { port: 'success' }
  }
  if (config.act.kind === 'sleep') {
    await sleepRandom(ctx, config.act.min, config.act.max)
    return { port: 'success' }
  }
  if (config.act.kind === 'swipe') {
    const { width, height } = await runtimeScreenSize(ctx)
    const act = config.act
    await ctx.device.swipe(
      ctx.serial,
      { x: Math.round(width * act.from.x), y: Math.round(height * act.from.y) },
      { x: Math.round(width * act.to.x), y: Math.round(height * act.to.y) },
      act.durationMs,
    )
    if (config.settle) await sleepRandom(ctx, config.settle[0], config.settle[1])
    return { port: 'success' }
  }

  // ⑤ 需要定位的动作（tap / input）
  if (!config.locate) return { port: 'failure', reason: `动作节点「${node.data.title}」缺少定位配置` }
  const fallback = config.locate.fallback ? runtime.locators[config.locate.fallback] : undefined
  const hit = await locateByModel(ctx, ctx.model, {
    intent: config.locate.intent,
    fallback,
    vision: config.locate.vision,
    strict: config.locate.strict,
  })
  if (!hit.ok || !hit.point) {
    return { port: 'failure', reason: hit.reason ?? `未定位到「${config.locate.intent}」` }
  }

  if (config.act.kind === 'tap') {
    await tapHuman(ctx, hit.point)
  } else {
    // input
    const inputLocator = runtime.locators[config.act.inputLocator]
    if (!inputLocator) {
      return { port: 'failure', reason: `未注册定位器：${config.act.inputLocator}` }
    }
    const text = resolveText(ctx, config.act.text)
    await tapHuman(ctx, hit.point)
    await sleepRandom(ctx, 0.3, 0.6)
    const snapshot = await ctx.snapshot({ refresh: true })
    const current = inputLocator(snapshot.root)
    if (current?.text) await clearPhoneInput(ctx, current.text)
    await typeWithVerify(
      ctx,
      text,
      inputLocator,
      node.data.title ?? node.id,
      config.act.extras ?? [],
      config.act.match ?? 'exact',
    )
  }

  if (config.settle) await sleepRandom(ctx, config.settle[0], config.settle[1])

  // ⑥ 校验
  if (config.verify) {
    const passed = await verify(ctx, config.verify, runtime)
    if (!passed) return { port: 'failure', reason: `节点「${node.data.title}」校验未通过` }
  }
  return { port: 'success' }
}

/** 执行条件节点。 */
async function executeConditionNode(
  ctx: StepContext,
  node: FlowNode,
  runtime: GraphRuntime,
): Promise<NodeResult> {
  const config = node.data as unknown as ConditionNodeConfig | undefined
  if (!config) return { port: 'false', reason: `条件节点「${node.data.title}」缺少配置` }

  switch (config.kind) {
    case 'page': {
      const page = await currentPage(ctx, runtime.pages)
      return { port: config.expect.includes(page) ? 'true' : 'false' }
    }
    case 'exists': {
      const fallback = config.locate.fallback ? runtime.locators[config.locate.fallback] : undefined
      const hit = await locateByModel(ctx, ctx.model, {
        intent: config.locate.intent,
        fallback,
        vision: config.locate.vision,
        strict: config.locate.strict,
      })
      return { port: hit.ok ? 'true' : 'false' }
    }
    case 'param': {
      const value = ctx.flowParams[config.key]
      return { port: value !== undefined && value !== '' ? 'true' : 'false' }
    }
  }
}

/**
 * 执行容器式循环：把 `blocks` 里的子图跑 `max` 轮。
 *
 * 子图内部也按端口路由，与顶层同一套逻辑；入口是 blocks 里第一个没有入边的节点。
 *
 * @returns 一律返回 `done`——循环结束后从 loop 节点的 done 端口继续
 */
async function runLoopContainer(
  ctx: StepContext,
  node: FlowNode,
  runtime: GraphRuntime,
  edgesByPort: Map<string, string>,
  nodeById: Map<string, FlowNode>,
  trail: GraphOutcome['trail'],
  maxSteps: number,
): Promise<NodeResult> {
  const config = node.data.loopFor as LoopNodeConfig | undefined
  const max = config?.max ?? 1
  const gap = config?.gap
  const blocks = node.blocks ?? []
  if (blocks.length === 0) return { port: 'done' }

  // 入口：blocks 里第一个没有入边的节点
  const ids = new Set(blocks.map((b) => b.id))
  const hasIncoming = new Set<string>()
  for (const key of edgesByPort.keys()) {
    const to = edgesByPort.get(key)!
    if (ids.has(to)) hasIncoming.add(to)
  }
  const entry = blocks.find((b) => !hasIncoming.has(b.id))
  if (!entry) {
    return { port: 'failure', reason: `循环「${node.data.title}」的循环体找不到入口` }
  }

  for (let round = 0; round < max; round += 1) {
    ctx.throwIfCancelled()
    let current: string | undefined = entry.id
    let steps = 0

    while (current && steps < maxSteps) {
      steps += 1
      const block = nodeById.get(current)
      if (!block) return { port: 'failure', reason: `循环体内节点不存在：${current}` }
      if (block.type === 'end') break

      const startedAt = Date.now()
      ctx.invalidateSnapshot?.()
      const result = await executeNode(ctx, block, runtime)
      trail.push({ node: block.id, port: result.port, ms: Date.now() - startedAt })

      const next = edgesByPort.get(`${block.id}:${result.port}`)
      if (!next) {
        // 循环体走到没有出口的节点，视为本轮结束
        break
      }
      // 连到循环体外部说明本轮结束
      if (!ids.has(next)) break
      current = next
    }

    if (gap) await sleepRandom(ctx, gap[0], gap[1])
  }

  return { port: 'done' }
}

/** 校验。 */
async function verify(
  ctx: StepContext,
  config: NonNullable<ActionNodeConfig['verify']>,
  runtime: GraphRuntime,
): Promise<boolean> {
  switch (config.kind) {
    case 'page': {
      const page = await currentPage(ctx, runtime.pages)
      return config.expect.includes(page)
    }
    case 'exists': {
      const fallback = config.locate.fallback ? runtime.locators[config.locate.fallback] : undefined
      const hit = await locateByModel(ctx, ctx.model, {
        intent: config.locate.intent,
        fallback,
        vision: config.locate.vision,
        strict: config.locate.strict,
      })
      return hit.ok
    }
    case 'gone': {
      const fallback = config.locate.fallback ? runtime.locators[config.locate.fallback] : undefined
      const hit = await locateByModel(ctx, ctx.model, {
        intent: config.locate.intent,
        fallback,
        vision: config.locate.vision,
        strict: config.locate.strict,
      })
      return !hit.ok
    }
    case 'inputEquals': {
      const locator = runtime.locators[config.locator]
      if (!locator) return false
      const snapshot = await ctx.snapshot({ refresh: true })
      const current = locator(snapshot.root)
      const actual = (current?.text ?? '').trim()
      const expected = resolveText(ctx, config.text).trim()
      return config.match === 'contains' ? actual.includes(expected) : actual === expected
    }
    case 'countAtLeast': {
      const measure = runtime.measures?.[config.measure]
      if (!measure) return false
      return (await measure(ctx)) >= config.target
    }
    case 'custom': {
      const run = runtime.verifiers?.[config.name]
      if (!run) return false
      return run(ctx)
    }
  }
}

/** 流程参数优先：JSON 里的 `text` 若在 `flowParams` 中存在同名键，用参数值。 */
function resolveText(ctx: StepContext, text: string): string {
  const fromParam = ctx.flowParams[text]
  return fromParam !== undefined && fromParam !== '' ? fromParam : text
}

/** 读屏幕尺寸（带缓存，避免每次 swipe 都跑 wm size）。 */
const screenCache = new Map<string, { width: number; height: number }>()

async function runtimeScreenSize(ctx: StepContext): Promise<{ width: number; height: number }> {
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
