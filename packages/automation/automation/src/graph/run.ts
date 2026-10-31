import type { StepContext } from '@myt/flow'
import type { UiNode } from '@myt/device'
import { currentPage } from '../page-guard.ts'
import type { PageRegistry } from '../page-guard.ts'
import { locateByModel } from '../locate-adapter.ts'
import { clearPhoneInput, sleepRandom, tapHuman, typeWithVerify } from '../actions.ts'
import { isLoopType } from './types.ts'
import type { FlowGraph, FlowNode, GraphOutcome, NodeType, PortId, VerifyConfig } from './types.ts'
import { boolInput, listInput, numInput, parseNodeInputs, strInput } from './inputs.ts'
import { FlowGraphError } from './load.ts'

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
  /**
   * 已执行节点的产出：节点 id → outputs。
   *
   * 由 `runGraph` 在每次节点执行后写入；节点的 `ref` / `template` 输入从这里取值。
   */
  outputs?: Map<string, Record<string, unknown>>
}

/** 节点执行结果：选了哪个端口。 */
export interface NodeResult {
  /** 走哪个端口。 */
  port: PortId
  /** 失败原因（port 为 failure/mismatch 时）。 */
  reason?: string
  /**
   * 本节点的产出，供下游 `ref` 引用。
   *
   * 省略表示无产出（纯控制节点）。
   */
  outputs?: Record<string, unknown>
}

/** 执行器上下文：节点本身、运行时依赖、已求值的输入。 */
export interface NodeExecutorContext {
  /** 步骤上下文（设备、事件流、取消信号）。 */
  ctx: StepContext
  /** 当前节点。 */
  node: FlowNode
  /** 运行时依赖。 */
  runtime: GraphRuntime
  /** 已求值的输入（`inputsValues` 展开后的实际值）。 */
  inputs: Readonly<Record<string, unknown>>
}

/**
 * 节点执行器。
 *
 * 与 flowgram demo 同形：每种节点一个类，引擎只按 `type` 查表分发，
 * 不认识任何具体节点语义。
 */
export interface NodeExecutor {
  /** 本执行器负责的节点类型。 */
  readonly type: NodeType
  /**
   * 执行一个节点。
   * @param input 上下文（含已求值的输入）。
   */
  execute(input: NodeExecutorContext): Promise<NodeResult>
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
  // 节点产出表：`ref` / `template` 从这里取值。每次运行独立，不跨运行共享。
  if (!runtime.outputs) runtime.outputs = new Map<string, Record<string, unknown>>()
  else runtime.outputs.clear()
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
    // 记下产出，供下游 `ref` / `template` 取值。
    if (result.outputs) runtime.outputs?.set(node.id, result.outputs)
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
 * 页面等待的默认秒数。
 *
 * 取 step 引擎 `runAction` 的重试预算（5 轮 × 0.3–0.8s ≈ 3s）；
 * 个别跳转慢的步骤在模板里用 `waitSeconds` 单独放大。
 */
const DEFAULT_PAGE_WAIT_SECONDS = 3

/** 轮询页面的间隔区间（秒）。 */
const PAGE_WAIT_GAP: readonly [number, number] = [0.3, 0.8]

/**
 * 等页面变成期望的之一。
 *
 * 与 step 引擎的 `waitForPage` 同一策略：按固定间隔轮询，超时即失败。
 * 为什么不用固定 sleep：不同机型/负载下跳转耗时差好几秒，等固定值要么
 * 不够（读到旧页）要么浪费（每次都白等）。
 *
 * @param ctx - 步骤上下文。
 * @param runtime - 运行时依赖（页面表）。
 * @param expect - 期望的页面 id 列表。
 * @param timeoutSeconds - 最长等待秒数。
 */
async function waitForRequiredPage(
  ctx: StepContext,
  runtime: GraphRuntime,
  expect: readonly string[],
  timeoutSeconds: number,
): Promise<{ ok: boolean; page: string }> {
  const startedAt = Date.now()
  let page = await currentPage(ctx, runtime.pages)
  while (!expect.includes(page) && Date.now() - startedAt < timeoutSeconds * 1000) {
    await sleepRandom(ctx, PAGE_WAIT_GAP[0], PAGE_WAIT_GAP[1])
    ctx.throwIfCancelled()
    page = await currentPage(ctx, runtime.pages)
  }
  return { ok: expect.includes(page), page }
}

/** 纯控制节点的执行器：固定返回一个端口。 */
function constantExecutor(type: NodeType, port: PortId): NodeExecutor {
  return { type, execute: async () => ({ port }) }
}

/** 全部执行器清单；新增节点类型时只需在此登记。 */
const EXECUTOR_LIST: readonly NodeExecutor[] = [
  constantExecutor('start', 'out'),
  constantExecutor('end', 'done'),
  // 容器式循环由 runLoopContainer 处理；单节点执行时视为配置读取。
  constantExecutor('mt-loop', 'done'),
  constantExecutor('loop', 'done'),
  // 循环体的起止标记：容器自动插入，执行时只做透传。
  constantExecutor('block-start', 'out'),
  constantExecutor('block-end', 'done'),
  { type: 'mt-action', execute: executeActionNode },
  { type: 'mt-condition', execute: executeConditionNode },
  { type: 'condition', execute: executeConditionNode },
  { type: 'http', execute: executeUnsupported },
  { type: 'code', execute: executeUnsupported },
  { type: 'llm', execute: executeUnsupported },
  { type: 'variable', execute: executeUnsupported },
]

const EXECUTORS: ReadonlyMap<NodeType, NodeExecutor> = new Map(
  EXECUTOR_LIST.map((executor) => [executor.type, executor]),
)

/**
 * 尚未实现的节点：明确报错，不静默当作成功。
 *
 * 静默成功会让用户以为流程跑通了，实际什么都没做——比报错难排查得多。
 */
async function executeUnsupported({ node }: NodeExecutorContext): Promise<NodeResult> {
  return { port: 'out', reason: `节点类型「${node.type}」尚未实现执行器` }
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
  const executor = EXECUTORS.get(node.type)
  if (!executor) {
    throw new FlowGraphError(`节点「${node.id}」的类型「${node.type}」没有执行器`, node.id)
  }
  const inputs = parseNodeInputs(node.data.inputsValues, {
    params: ctx.flowParams,
    outputs: runtime.outputs ?? new Map(),
  })
  return executor.execute({ ctx, node, runtime, inputs })
}

/** 执行动作节点。 */
async function executeActionNode(input: NodeExecutorContext): Promise<NodeResult> {
  const { ctx, node, runtime, inputs } = input
  const title = node.data.title ?? node.id

  // ① 页面前置检查：**先等**再判。
  // 界面跳转有延迟，点完按钮立刻查页面会读到旧页——step 引擎用
  // `waitForPage(..., 8_000)` 解决，这里用同一套策略。
  const requires = listInput(inputs, 'requires')
  const skipIfOn = listInput(inputs, 'skipIfOn')
  const waitSeconds = numInput(inputs, 'waitSeconds', DEFAULT_PAGE_WAIT_SECONDS)
  let page = await currentPage(ctx, runtime.pages)
  // 已经到位：不必再点一次（step 引擎的「已在发布编辑页 → 跳过」）。
  // 必须在「等 requires」之前判——已到位时 requires 通常不再匹配，
  // 先等就会白等到超时再报 mismatch。
  if (skipIfOn.includes(page)) return { port: 'success' }
  if (requires.length > 0 && !requires.includes(page)) {
    const settled = await waitForRequiredPage(ctx, runtime, requires, waitSeconds)
    page = settled.page
    if (skipIfOn.includes(page)) return { port: 'success' }
    if (!settled.ok) {
      return {
        port: 'mismatch',
        reason: `等待 ${waitSeconds}s 后当前页面仍是 ${page}，期望 ${requires.join('/')}`,
      }
    }
  }

  // ② 执行方式（做什么）缺失：配置写漏了，直接判失败
  const kind = strInput(inputs, 'actKind')
  if (!kind) return { port: 'failure', reason: `动作节点「${title}」缺少执行方式（做什么）` }

  const settle = settleOf(inputs)

  // ③ 自定义动作（不需要定位）
  if (kind === 'custom') {
    const name = strInput(inputs, 'actName')
    const run = runtime.actions?.[name]
    if (!run) return { port: 'failure', reason: `未注册自定义动作：${name}` }
    try {
      await run(ctx)
    } catch (error) {
      return { port: 'failure', reason: error instanceof Error ? error.message : String(error) }
    }
    if (settle) await sleepRandom(ctx, settle[0], settle[1])
    return { port: 'success' }
  }

  // ④ 不需要定位的动作
  if (kind === 'back') {
    await ctx.device.back(ctx.serial)
    if (settle) await sleepRandom(ctx, settle[0], settle[1])
    return { port: 'success' }
  }
  if (kind === 'openUri') {
    const uri = strInput(inputs, 'actUri')
    if (!uri) return { port: 'failure', reason: `动作节点「${title}」缺少要打开的链接` }
    await ctx.device.openUri(ctx.serial, uri)
    if (settle) await sleepRandom(ctx, settle[0], settle[1])
    return { port: 'success' }
  }
  if (kind === 'sleep') {
    await sleepRandom(ctx, numInput(inputs, 'actMin', 1), numInput(inputs, 'actMax', 1))
    return { port: 'success' }
  }
  if (kind === 'swipe') {
    const { width, height } = await runtimeScreenSize(ctx)
    await ctx.device.swipe(
      ctx.serial,
      {
        x: Math.round(width * numInput(inputs, 'actFromX', 0.5)),
        y: Math.round(height * numInput(inputs, 'actFromY', 0.8)),
      },
      {
        x: Math.round(width * numInput(inputs, 'actToX', 0.5)),
        y: Math.round(height * numInput(inputs, 'actToY', 0.2)),
      },
      numInput(inputs, 'actDurationMs', 300),
    )
    if (settle) await sleepRandom(ctx, settle[0], settle[1])
    return { port: 'success' }
  }

  // ⑤ 需要定位的动作（tap / input）
  const target = await resolveTarget(input, title)
  if (!target.ok) return { port: 'failure', reason: target.reason }

  if (kind === 'tap') {
    await tapHuman(ctx, target.point)
  } else if (kind === 'input') {
    const text = strInput(inputs, 'actText')
    const inputLocator = runtime.locators[strInput(inputs, 'actInputLocator')]
    if (!inputLocator) {
      return { port: 'failure', reason: `未注册定位器：${strInput(inputs, 'actInputLocator')}` }
    }
    await tapHuman(ctx, target.point)
    await sleepRandom(ctx, 0.3, 0.6)
    const snapshot = await ctx.snapshot({ refresh: true })
    const current = inputLocator(snapshot.root)
    if (current?.text) await clearPhoneInput(ctx, current.text)
    const extras = listInput(inputs, 'actExtras')
    const match = strInput(inputs, 'actMatch', 'exact') === 'contains' ? 'contains' : 'exact'
    await typeWithVerify(ctx, text, inputLocator, title, extras, match)
  } else {
    return { port: 'failure', reason: `动作节点「${title}」的执行方式「${kind}」未实现` }
  }

  if (settle) await sleepRandom(ctx, settle[0], settle[1])

  // ⑥ 校验
  const verifyConfig = inputs['verify'] as VerifyConfig | undefined
  if (verifyConfig) {
    const passed = await verify(ctx, verifyConfig, runtime)
    if (!passed) return { port: 'failure', reason: `节点「${title}」校验未通过` }
  }
  return { port: 'success' }
}

/** 定位结果：要么拿到坐标，要么带原因失败。 */
type TargetResult = { ok: true; point: { x: number; y: number } } | { ok: false; reason: string }

/**
 * 按「怎么找」解析出屏幕坐标。
 *
 * 三种模式：`intent`（模型在 UI 树上找）、`point`（绝对坐标）、
 * `ratio`（比例坐标，换机型不失效）。
 *
 * @param input - 执行器上下文。
 * @param title - 节点展示名，用于错误信息。
 */
async function resolveTarget(input: NodeExecutorContext, title: string): Promise<TargetResult> {
  const { ctx, runtime, inputs } = input
  const mode = strInput(inputs, 'locateMode', 'intent')

  if (mode === 'point') {
    const x = numInput(inputs, 'locatePointX', Number.NaN)
    const y = numInput(inputs, 'locatePointY', Number.NaN)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, reason: `「${title}」的坐标不合法（需要两个数字）` }
    }
    return { ok: true, point: { x: Math.round(x), y: Math.round(y) } }
  }

  if (mode === 'ratio') {
    const rx = numInput(inputs, 'locateRatioX', Number.NaN)
    const ry = numInput(inputs, 'locateRatioY', Number.NaN)
    if (!Number.isFinite(rx) || !Number.isFinite(ry)) {
      return { ok: false, reason: `「${title}」的比例坐标不合法（需要两个 0-1 的数字）` }
    }
    if (rx < 0 || rx > 1 || ry < 0 || ry > 1) {
      return { ok: false, reason: `「${title}」的比例坐标必须在 0 到 1 之间` }
    }
    const { width, height } = await runtimeScreenSize(ctx)
    return { ok: true, point: { x: Math.round(width * rx), y: Math.round(height * ry) } }
  }

  const intent = strInput(inputs, 'locateIntent')
  if (!intent) return { ok: false, reason: `「${title}」缺少「找什么」（目标描述）` }
  const fallbackName = strInput(inputs, 'locateFallback')
  const hit = await locateByModel(ctx, ctx.model, {
    intent,
    fallback: fallbackName ? runtime.locators[fallbackName] : undefined,
    vision: boolInput(inputs, 'locateVision', true),
    strict: boolInput(inputs, 'locateStrict', false),
  })
  if (!hit.ok || !hit.point) {
    return { ok: false, reason: hit.reason ?? `未定位到「${intent}」` }
  }
  return { ok: true, point: hit.point }
}

/**
 * 取「执行后等待」区间。
 *
 * @param inputs - 已求值的输入表。
 */
function settleOf(inputs: Readonly<Record<string, unknown>>): [number, number] | undefined {
  const raw = inputs['settle']
  if (raw === undefined || raw === null || raw === '') return undefined
  if (Array.isArray(raw) && raw.length === 2) return [Number(raw[0]), Number(raw[1])]
  const parts = String(raw).split(/[,，]/u).map((v) => Number(v.trim()))
  if (parts.length === 2 && parts.every((v) => Number.isFinite(v))) return [parts[0]!, parts[1]!]
  return undefined
}

async function executeConditionNode(input: NodeExecutorContext): Promise<NodeResult> {
  const { ctx, node, runtime, inputs } = input
  const title = node.data.title ?? node.id
  const kind = strInput(inputs, 'judgeKind')
  if (!kind) return { port: 'false', reason: `条件节点「${title}」缺少判断类型` }

  if (kind === 'page') {
    const expect = listInput(inputs, 'judgeExpect')
    // 「等离开这些页再判」：上一步刚点完，界面可能还在旧页，
    // 立刻判会把「正在跳转」误判成「不在目标页」。
    const waitWhile = listInput(inputs, 'judgeWaitWhile')
    const waitSeconds = numInput(inputs, 'judgeWaitSeconds', 0)
    let page = await currentPage(ctx, runtime.pages)
    if (waitWhile.includes(page) && waitSeconds > 0) {
      const deadline = Date.now() + waitSeconds * 1000
      while (waitWhile.includes(page) && Date.now() < deadline) {
        await sleepRandom(ctx, PAGE_WAIT_GAP[0], PAGE_WAIT_GAP[1])
        ctx.throwIfCancelled()
        page = await currentPage(ctx, runtime.pages)
      }
    }
    return { port: expect.includes(page) ? 'true' : 'false' }
  }

  if (kind === 'exists') {
    const intent = strInput(inputs, 'judgeLocateIntent')
    if (!intent) return { port: 'false', reason: `条件节点「${title}」缺少「找什么」` }
    const fallbackName = strInput(inputs, 'judgeLocateFallback')
    const hit = await locateByModel(ctx, ctx.model, {
      intent,
      fallback: fallbackName ? runtime.locators[fallbackName] : undefined,
      vision: boolInput(inputs, 'judgeLocateVision', true),
      strict: boolInput(inputs, 'judgeLocateStrict', false),
    })
    return { port: hit.ok ? 'true' : 'false' }
  }

  if (kind === 'param') {
    const key = strInput(inputs, 'judgeKey')
    const value = ctx.flowParams[key]
    return { port: value !== undefined && value !== '' ? 'true' : 'false' }
  }

  return { port: 'false', reason: `条件节点「${title}」的判断类型「${kind}」未实现` }
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
  const inputs = parseNodeInputs(node.data.inputsValues, {
    params: ctx.flowParams,
    outputs: runtime.outputs ?? new Map(),
  })
  const max = numInput(inputs, 'loopMax', 1)
  // gap 是「每轮间隔秒数区间」，画布上一个值同时作用于上下界。
  const gapSeconds = numInput(inputs, 'loopGap', 0)
  const gap: [number, number] | undefined = gapSeconds > 0 ? [gapSeconds, gapSeconds] : undefined
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
  config: VerifyConfig,
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
        intent: config.locate.intent ?? '',
        fallback,
        vision: config.locate.vision,
        strict: config.locate.strict,
      })
      return hit.ok
    }
    case 'gone': {
      const fallback = config.locate.fallback ? runtime.locators[config.locate.fallback] : undefined
      const hit = await locateByModel(ctx, ctx.model, {
        intent: config.locate.intent ?? '',
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
