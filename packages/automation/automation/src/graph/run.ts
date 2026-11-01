import type { StepContext } from '@myt/flow'
import { dirname } from 'node:path'
import type { UiNode } from '@myt/device'
import type { Point } from '../types.ts'
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
  /**
   * 相册图片格识别器：从 UI 树里找出「可点的图片格」及其选中态。
   *
   * 各 App 的相册结构不同，所以由业务提供；但「选 N 张」的算法在引擎里，
   * 保证选图这件事在图上是可见的原语，而不是黑盒动作。
   */
  gallery?: (root: UiNode) => GalleryImagePoint[]
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
      // 中止原因要同时给两件事：哪个端口中止的（定位连线），
      // 以及链路上第一个节点级原因（定位为什么）。只给前者会把真实原因吞掉，
      // 只给后者则看不出是从哪条分支退出的。
      const cause = trail.find((step) => step.reason !== undefined)?.reason
      const abortedBy = `经「${enteredFrom}」端口中止`
      return {
        ok,
        trail,
        reason: ok ? undefined : cause === undefined ? abortedBy : `${abortedBy}：${cause}`,
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
    trail.push({
      node: node.id,
      port: result.port,
      ms: Date.now() - nodeStartedAt,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
    })

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

/**
 * 轮询等待「页面或元素就绪」，就绪不了就重开深链再试。
 *
 * 对应 step 版 `wait-gallery` 的语义：
 * ```
 * for (5 轮) {
 *   等待；页面在期望内 → 成功
 *   元素存在 → 成功
 *   重开深链；再等 6 秒；到了 → 成功
 * }
 * 抛错
 * ```
 *
 * @param ctx - 步骤上下文。
 * @param runtime - 运行时依赖。
 * @param spec - 接受页、就绪元素、深链、轮数、间隔、每轮等待。
 */
async function retryUntilReady(
  ctx: StepContext,
  runtime: GraphRuntime,
  spec: {
    acceptPages: readonly string[]
    readyLocators: readonly string[]
    openUri: string
    /** 目标包名；省略时交给 `openUri` 自行解析。 */
    packageName: string
    rounds: number
    gap: readonly [number, number]
    waitPerRound: number
  },
): Promise<boolean> {
  for (let round = 0; round < spec.rounds; round += 1) {
    ctx.throwIfCancelled()
    await sleepRandom(ctx, spec.gap[0], spec.gap[1])

    // ① 页面已就绪
    const page = await currentPage(ctx, runtime.pages)
    if (spec.acceptPages.includes(page)) return true

    // ② 页面未变但元素已出现（例如权限弹窗盖在相册上）
    if (spec.readyLocators.length > 0) {
      ctx.invalidateSnapshot?.()
      const snapshot = await ctx.snapshot({ refresh: true })
      for (const name of spec.readyLocators) {
        const locator = runtime.locators[name]
        if (locator?.(snapshot.root)) return true
      }
    }

    // ③ 重开深链，再等一轮
    await ctx.device.openUri(ctx.serial, spec.openUri, spec.packageName || undefined)
    const arrived = await waitForRequiredPage(ctx, runtime, spec.acceptPages, spec.waitPerRound)
    if (arrived.ok) return true
  }
  return false
}

/**
 * 等某个定位器能在界面上找到目标。
 *
 * 用于「页面已切换但控件还没渲染」的场景。定位器来自业务包的 `LocatorTable`，
 * 与动作执行时用的是同一张表，不会出现「等的是一个元素、点的是另一个」。
 *
 * @param ctx - 步骤上下文。
 * @param runtime - 运行时依赖（定位器表）。
 * @param locatorName - 定位器名。
 * @param timeoutSeconds - 最长等待秒数。
 */
async function waitForLocator(
  ctx: StepContext,
  runtime: GraphRuntime,
  locatorName: string,
  timeoutSeconds: number,
): Promise<boolean> {
  const locator = runtime.locators[locatorName]
  if (!locator) return false
  const deadline = Date.now() + timeoutSeconds * 1000
  while (Date.now() < deadline) {
    ctx.invalidateSnapshot?.()
    const snapshot = await ctx.snapshot({ refresh: true })
    if (locator(snapshot.root)) return true
    ctx.throwIfCancelled()
    await sleepRandom(ctx, PAGE_WAIT_GAP[0], PAGE_WAIT_GAP[1])
  }
  return false
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

  // 节点级重试：`failure` / `mismatch` 都算失败，按 `retries` 重试。
  // 放在这里而不是各个动作里，是为了「重试」这件事只有一种实现——
  // 之前散落在自定义动作的 for 循环里，图上完全看不见。
  const retries = numInput(inputs, 'retries', 0)
  const retryGap = numInput(inputs, 'retryGap', 1)
  let result = await executor.execute({ ctx, node, runtime, inputs })
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (result.port === 'success' || result.port === 'true' || result.port === 'done') break
    if (result.port !== 'failure' && result.port !== 'mismatch') break
    ctx.throwIfCancelled()
    await sleepRandom(ctx, retryGap, retryGap * 2)
    ctx.invalidateSnapshot?.()
    result = await executor.execute({ ctx, node, runtime, inputs })
  }
  return result
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

  // 按数量选图：数已选中的图，不够就点下一张，滚到底还差就失败。
  // 算法留在通用引擎里，业务只给「要选几张」。
  if (kind === 'pickImages') {
    const target = numInput(inputs, 'actCount', 1)
    const maxScroll = numInput(inputs, 'actMaxScroll', 10)
    let selected = 0
    let emptyScrolls = 0
    for (let attempt = 0; attempt < maxScroll * 3 + 20 && selected < target; attempt += 1) {
      ctx.throwIfCancelled()
      const snapshot = await ctx.snapshot({ refresh: true })
      const images = runtime.gallery?.(snapshot.root) ?? []
      if (images.length === 0 && attempt === 0) {
        return { port: 'failure', reason: '当前界面没有可选的图片格（业务包未提供 gallery 识别，或不在相册页）' }
      }
      const unselected = images.filter((img: GalleryImagePoint) => !img.selected)
      selected = images.filter((img: GalleryImagePoint) => img.selected).length
      if (selected >= target) break
      if (unselected.length === 0) {
        await swipeUp(ctx)
        emptyScrolls += 1
        if (emptyScrolls >= maxScroll) break
        continue
      }
      for (const img of unselected) {
        if (selected >= target) break
        await tapHuman(ctx, img.point)
        selected += 1
        await sleepRandom(ctx, 0.15, 0.35)
      }
      emptyScrolls = 0
    }
    if (selected < target) {
      return { port: 'failure', reason: `只选到 ${selected}/${target} 张` }
    }
    if (settle) await sleepRandom(ctx, settle[0], settle[1])
    return { port: 'success' }
  }

  // 等页面：轮询直到落在期望页面之一，超时算失败（走 failure 端口）。
  // 比「自定义动作里 for 循环 + openUri 重试」可读：定时、期望、超时全在节点上。
  if (kind === 'waitPage') {
    const expect = listInput(inputs, 'actPages')
    if (expect.length === 0) {
      return { port: 'failure', reason: `动作节点「${title}」没有填要等的页面` }
    }
    const timeout = numInput(inputs, 'actTimeout', 10)
    const deadline = Date.now() + timeout * 1000
    let page = await currentPage(ctx, runtime.pages)
    while (!expect.includes(page) && Date.now() < deadline) {
      ctx.throwIfCancelled()
      await sleepRandom(ctx, PAGE_WAIT_GAP[0], PAGE_WAIT_GAP[1])
      page = await currentPage(ctx, runtime.pages)
    }
    if (!expect.includes(page)) {
      return { port: 'failure', reason: `等了 ${timeout}s，当前页面仍是 ${page}，期望 ${expect.join('/')}` }
    }
    if (settle) await sleepRandom(ctx, settle[0], settle[1])
    return { port: 'success' }
  }

  // 等元素：轮询直到模型/兜底能定位到目标，超时算失败。
  if (kind === 'waitElement') {
    const intent = strInput(inputs, 'actLocateIntent')
    if (!intent) return { port: 'failure', reason: `动作节点「${title}」没有填要找的元素` }
    const fallbackName = strInput(inputs, 'actLocateFallback')
    const timeout = numInput(inputs, 'actTimeout', 10)
    const deadline = Date.now() + timeout * 1000
    for (;;) {
      const hit = await locateByModel(ctx, ctx.model, {
        intent,
        fallback: fallbackName ? runtime.locators[fallbackName] : undefined,
        vision: boolInput(inputs, 'actLocateVision', true),
        strict: boolInput(inputs, 'actLocateStrict', false),
      })
      if (hit.ok) break
      if (Date.now() >= deadline) {
        return { port: 'failure', reason: `等了 ${timeout}s 仍未出现：${intent}` }
      }
      ctx.throwIfCancelled()
      await sleepRandom(ctx, PAGE_WAIT_GAP[0], PAGE_WAIT_GAP[1])
    }
    if (settle) await sleepRandom(ctx, settle[0], settle[1])
    return { port: 'success' }
  }
  // 推送文件：只填本地路径与目标目录，文件名自动沿用（面向非开发者）。
  // 推完自动加执行权限（755）：临时目录里推上去的多半是要直接运行的工具
  // （如 yadb），而 `adb push` 默认给 644，不加就执行不了。
  if (kind === 'push') {
    const src = strInput(inputs, 'actSrc')
    if (!src) return { port: 'failure', reason: `动作节点「${title}」缺少本地路径` }
    const destDir = strInput(inputs, 'actDestDir') || '/data/local/tmp/'
    const localPath = resolveAdbTokens(ctx, src)
    const dest = joinDevicePath(destDir, localPath)
    try {
      await ctx.device.adb(ctx.serial, ['push', localPath, dest])
      await ctx.device.adb(ctx.serial, ['shell', 'chmod', '755', dest])
    } catch (error) {
      return { port: 'failure', reason: error instanceof Error ? error.message : String(error) }
    }
    if (settle) await sleepRandom(ctx, settle[0], settle[1])
    return { port: 'success' }
  }
  // 安装应用：本地 APK + 应用名（应用名只用于标题/提示，不做校验）。
  // 内部先推到临时目录再安装，用户不用关心设备路径。
  if (kind === 'installApp') {
    const src = strInput(inputs, 'actSrc')
    if (!src) return { port: 'failure', reason: `动作节点「${title}」缺少本地安装包路径` }
    const localPath = resolveAdbTokens(ctx, src)
    const dest = joinDevicePath('/data/local/tmp/', localPath)
    try {
      await ctx.device.adb(ctx.serial, ['push', localPath, dest])
      await ctx.device.adb(ctx.serial, ['shell', 'pm', 'install', '-r', '-t', dest])
    } catch (error) {
      return { port: 'failure', reason: error instanceof Error ? error.message : String(error) }
    }
    if (settle) await sleepRandom(ctx, settle[0], settle[1])
    return { port: 'success' }
  }
  // 推送到相册：把本地图片推进手机相册，后面的选图才能选到。
  // 路径直接填在这个节点上，不再依赖流程输入——业务用户不用理解「参数」。
  if (kind === 'pushToGallery') {
    const raw = strInput(inputs, 'actImages')
    const paths = splitPaths(raw)
    if (paths.length === 0) {
      return {
        port: 'failure',
        reason: `动作节点「${title}」没有填写图片路径；要发纯文字请用「发布文字笔记」`,
      }
    }
    try {
      // 倒序推送：相册按时间排序，倒着推才能让第一张排在最前。
      for (const localPath of [...paths].reverse()) {
        await ctx.device.pushToGallery(ctx.serial, resolveAdbTokens(ctx, localPath))
      }
    } catch (error) {
      return { port: 'failure', reason: error instanceof Error ? error.message : String(error) }
    }
    // 下游「选择图片」按流程输入的 imagePaths 计数，这里同步一份。
    ;(ctx.flowParams as Record<string, string>)['imagePaths'] = paths.join(',')
    if (settle) await sleepRandom(ctx, settle[0], settle[1])
    return { port: 'success' }
  }
  // 启用输入法：填「输入法名称」即可，引擎在设备已装的输入法里匹配。
  // 设备拿不到可读显示名（`ime list -a` 的 nonLocalizedLabel 为 null），
  // 所以按标识里的片段匹配：`adbkeyboard`、`sogou` 都能命中；
  // 也接受完整标识（含 `/`）直接使用。
  if (kind === 'enableIme') {
    const raw = strInput(inputs, 'actIme')?.trim() ?? ''
    if (!raw) return { port: 'failure', reason: `动作节点「${title}」缺少输入法名称` }
    let ime = raw
    try {
      if (!raw.includes('/')) {
        // 必须用 `ime list -a`：`-s` 只列**已启用**的，刚装上还没启用的输入法不在里面，
        // 那样「安装应用 → 启用输入法」这条链会误报「设备上没有匹配的输入法」。
        const listed = await ctx.device.shell(ctx.serial, 'ime list -a')
        // 只认「以冒号结尾且含 `/`」的行——`-a` 里还有 `sourceDir=/data/…` 这类噪音。
        const ids = listed
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter((line) => line.endsWith(':') && line.includes('/'))
          .map((line) => line.slice(0, -1))
        const unique = [...new Set(ids)]
        const hits = unique.filter((id) => id.toLowerCase().includes(raw.toLowerCase()))
        if (hits.length === 0) {
          return {
            port: 'failure',
            reason: `设备上没有匹配「${raw}」的输入法。可用：${unique.join('、') || '（无）'}`,
          }
        }
        if (hits.length > 1) {
          return {
            port: 'failure',
            reason: `「${raw}」匹配到多个输入法，请写得更具体：${hits.join('、')}`,
          }
        }
        ime = hits[0]!
      }
      await ctx.device.adb(ctx.serial, ['shell', 'ime', 'enable', ime])
      await ctx.device.adb(ctx.serial, ['shell', 'ime', 'set', ime])
    } catch (error) {
      return { port: 'failure', reason: error instanceof Error ? error.message : String(error) }
    }
    if (settle) await sleepRandom(ctx, settle[0], settle[1])
    return { port: 'success' }
  }
  // 设备命令：参数原样交给 adb（`adb -s <serial> <args…>`）。
  // 覆盖 `shell` 做不到的 `push`/`install`/`pull`，也不做白名单——
  // 按约定由画布配置者自负后果。
  if (kind === 'adb') {
    const raw = strInput(inputs, 'actArgs')
    if (!raw) return { port: 'failure', reason: `动作节点「${title}」缺少设备命令` }
    const args = splitCommandArgs(resolveAdbTokens(ctx, raw))
    if (args.length === 0) return { port: 'failure', reason: `动作节点「${title}」的设备命令为空` }
    try {
      await ctx.device.adb(ctx.serial, args)
    } catch (error) {
      return { port: 'failure', reason: error instanceof Error ? error.message : String(error) }
    }
    if (settle) await sleepRandom(ctx, settle[0], settle[1])
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

  // ④.4 轮询等待 + 重开深链：对应 step 版 wait-gallery 的 5 轮循环。
  // 每轮：判页面 → 判元素 → 重开深链 → 再等。
  // 单独做成一个能力，是因为「页面对但内容没加载」这类等待无法用
  // requires（它只看页面 id）或 readyLocator（它只看元素）单独表达。
  const retryOpenUri = strInput(inputs, 'retryOpenUri')
  if (retryOpenUri) {
    const ok = await retryUntilReady(ctx, runtime, {
      acceptPages: listInput(inputs, 'acceptPages'),
      readyLocators: listInput(inputs, 'readyLocators'),
      openUri: retryOpenUri,
      packageName: strInput(inputs, 'packageName'),
      rounds: Math.max(1, numInput(inputs, 'rounds', 5)),
      gap: [numInput(inputs, 'gap', 0.5), numInput(inputs, 'gap', 0.5) + 0.5],
      waitPerRound: numInput(inputs, 'roundWaitSeconds', 6),
    })
    if (!ok) {
      return {
        port: boolInput(inputs, 'optional', false) ? 'success' : 'failure',
        reason: `轮询 ${Math.max(1, numInput(inputs, 'rounds', 5))} 轮后仍未就绪`,
      }
    }
    return { port: 'success' }
  }

  // ④.5 目标页面已达成 → 成功退出，不再执行动作。
  // 对应 step 版 `if (page === 'post-editor') return` 的「已到位跳过」，
  // 但这里放在动作之前，所以 requires 允许范围可以更严格。
  const successPages = listInput(inputs, 'successPages')
  if (successPages.length > 0) {
    const now = await currentPage(ctx, runtime.pages)
    if (successPages.includes(now)) return { port: 'success', reason: `已在 ${now}，跳过` }
  }

  // ⑤ 等目标真的出现在界面上再动手。
  // 实测教训：Activity 已切换 ≠ 界面渲染完成，直接往下走会把标题输进正文框。
  const readyLocator = strInput(inputs, 'readyLocator')
  if (readyLocator) {
    const ready = await waitForLocator(ctx, runtime, readyLocator, numInput(inputs, 'readySeconds', 8))
    if (!ready) {
      return { port: 'failure', reason: `「${title}」等待元素就绪超时：${readyLocator}` }
    }
  }

  // ⑥ 需要定位的动作（tap / input）
  const target = await resolveTarget(input, title)
  if (!target.ok) {
    // 可选动作：找不到就是「界面上本来就没有这个弹窗」，直接算成功。
    // 与 step 引擎 `optional: true` 完全同义——弹窗类步骤全靠它。
    if (boolInput(inputs, 'optional', false)) {
      return { port: 'success', reason: `可选动作未命中，视为成功：${target.reason}` }
    }
    // 找不到但页面已经变了：说明前一步点完后界面自己跳走了。
    if (successPages.length > 0) {
      const now = await currentPage(ctx, runtime.pages)
      if (successPages.includes(now)) return { port: 'success', reason: `已在 ${now}` }
    }
    return { port: 'failure', reason: target.reason }
  }

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

  // ⑥ 点完若已到目标页，直接成功（不必再走后续校验）。
  if (successPages.length > 0) {
    const arrived = await waitForRequiredPage(ctx, runtime, successPages, numInput(inputs, 'arriveSeconds', 5))
    if (arrived.ok) return { port: 'success' }
  }

  // ⑦ 校验
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
  // 重试预算：与 step 引擎 `rounds` / `gap` 同义。
  const rounds = Math.max(1, numInput(inputs, 'rounds', 1))
  const gapSeconds = numInput(inputs, 'gap', 0)

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
  let lastReason = ''
  for (let round = 0; round < rounds; round += 1) {
    ctx.throwIfCancelled()
    const hit = await locateByModel(ctx, ctx.model, {
      intent,
      fallback: fallbackName ? runtime.locators[fallbackName] : undefined,
      vision: boolInput(inputs, 'locateVision', true),
      strict: boolInput(inputs, 'locateStrict', false),
    })
    if (hit.ok && hit.point) return { ok: true, point: hit.point }
    lastReason = hit.reason ?? `未定位到「${intent}」`
    // 最后一轮不再等待。
    if (round < rounds - 1) await sleepRandom(ctx, gapSeconds, gapSeconds + 0.3)
    // 每轮之间刷新 UI 快照，否则会反复在同一份旧树上找不到。
    ctx.invalidateSnapshot?.()
  }
  return { ok: false, reason: lastReason }
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

/**
 * 把「设备命令」一行文本切成 adb 参数数组。
 *
 * 支持单/双引号包裹（路径里有空格时必须）：`push "C:/a b/x.apk" /data/local/tmp/`。
 * 引号只用于分组，不会传给 adb。
 */
export function splitCommandArgs(text: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let started = false

  for (const char of text) {
    if (quote) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (/\s/u.test(char)) {
      if (started) {
        args.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += char
    started = true
  }
  if (started) args.push(current)
  return args
}

/**
 * 把「图片路径」这类多值输入切成数组。
 *
 * 分隔符接受英文逗号、中文逗号与换行——用户从资源管理器复制多行路径是常态。
 */
export function splitPaths(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(/[,，\n]/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

/**
 * 把本地文件路径拼到设备目录下，沿用原文件名。
 *
 * 设备侧统一用 `/`；本地可能是 `C:\a\b.apk` 或 `/a/b.apk`。
 * 目录结尾有无 `/` 都兼容。
 */
export function joinDevicePath(destDir: string, localPath: string): string {
  const name = localPath.split(/[/\\]/u).filter(Boolean).pop() ?? 'file'
  const dir = destDir.replace(/\/+$/u, '')
  return `${dir}/${name}`
}

/**
 * 替换「设备命令」里的内置占位符，并把内置文件的相对路径解析成绝对路径。
 *
 * - `{{yadbPath}}` / `{{adbKeyboardApk}}`：老的占位符写法，继续兼容。
 * - `resources/tools/…`：模板里的**可读默认值**（用户能直接改成自己的路径）。
 *   解析基准取 `MYT_YADB_PATH` 所在目录——宿主总会设置它。
 */
function resolveAdbTokens(ctx: StepContext, text: string): string {
  const apk = process.env['MYT_ADB_KEYBOARD_APK'] ?? ''
  const yadbDir = process.env['MYT_YADB_PATH'] ? dirname(process.env['MYT_YADB_PATH']) : ''
  // 模板里给用户看的是**可读文字**（「内置 ADB 输入法」），不是 `{{…}}` 花括号；
  // 这里把这两句翻译成真实路径。用户把字段改成自己的路径时按字面使用。
  const resolved = text
    .replace(/内置\s*ADB\s*输入法/giu, apk)
    .replace(/内置\s*yadb/giu, ctx.yadbPath ?? '')
    // 兼容旧模板里的占位符写法。
    .replace(/\{\{\s*yadbPath\s*\}\}/giu, ctx.yadbPath ?? '')
    .replace(/\{\{\s*adbKeyboardApk\s*\}\}/giu, apk)

  if (!yadbDir) return resolved
  return resolved.replace(/(^|[\s"'])resources\/tools\//giu, `$1${yadbDir}/`)
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

  // 「设备上装了某应用吗」：`pm list packages <名字>` 的输出里有没有它。
  // 不要求写全包名，`adbkeyboard` 这种片段也能匹配（与 `pm list packages` 语义一致）。
  if (kind === 'apkInstalled') {
    const name = strInput(inputs, 'judgePackage')
    if (!name) return { port: 'false', reason: `条件节点「${title}」缺少应用名` }
    const out = await ctx.device.shell(ctx.serial, `pm list packages ${name}`)
    return { port: out.includes(name) ? 'true' : 'false' }
  }

  // 「设备上某文件存在吗」：`ls <路径>` 不报错即存在。
  if (kind === 'fileExists') {
    const path = strInput(inputs, 'judgePath')
    if (!path) return { port: 'false', reason: `条件节点「${title}」缺少文件路径` }
    try {
      await ctx.device.shell(ctx.serial, `ls ${path}`)
      return { port: 'true' }
    } catch {
      return { port: 'false' }
    }
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
      // 期望值可能是参数名，也可能是 `{{param}}` 模板；两种都支持，
      // 否则模板里写 `{{title}}` 会拿字面量去比对，永远不相等。
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
  // `{{name}}` 形式：按参数插值（与 inputsValues 的 template 语义一致）。
  const interpolated = text.replace(/\{\{\s*([\w.-]+)\s*\}\}/gu, (whole, key: string) => {
    const value = ctx.flowParams[key]
    return value !== undefined ? value : whole
  })
  if (interpolated !== text) return interpolated
  // 裸参数名（旧写法）：参数存在且非空则取参数值。
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


/** 相册里一个可点的图片格（由业务提供识别函数）。 */
export interface GalleryImagePoint {
  point: Point
  selected: boolean
}

/** 在 UI 树里按文字找可点的位置；先精确后包含。 */
export function findTextPoint(root: UiNode, texts: readonly string[]): Point | null {
  let fuzzy: Point | null = null
  const walk = (node: UiNode): Point | null => {
    const label = `${node.text} ${node.contentDesc}`.trim()
    if (label) {
      for (const want of texts) {
        if (!want) continue
        if (label === want && node.clickable) return centerOf(node)
        if (fuzzy === null && label.includes(want)) fuzzy = centerOf(node)
      }
    }
    for (const child of node.children) {
      const hit = walk(child)
      if (hit) return hit
    }
    return null
  }
  return walk(root) ?? fuzzy
}

/** 节点中心点。 */
function centerOf(node: UiNode): Point {
  const [x1, y1, x2, y2] = node.bounds
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) }
}

/** 向上滑一屏的 40%（滚动列表的通用做法）。 */
async function swipeUp(ctx: StepContext): Promise<void> {
  const snapshot = await ctx.snapshot()
  const [x1, y1, x2, y2] = snapshot.root.bounds
  const cx = Math.round((x1 + x2) * 0.535)
  const from = Math.round(y1 + (y2 - y1) * 0.75)
  const to = Math.round(y1 + (y2 - y1) * 0.35)
  await ctx.device.swipe(ctx.serial, { x: cx, y: from }, { x: cx, y: to }, 300)
}
