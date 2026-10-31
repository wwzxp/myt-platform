import { Service } from '@deepseek-ai/cordis'
import type { DeviceControl, TapOptions, UiSnapshot } from '@myt/device'
import { DEFAULT_HUMAN_POLICY, Random, type HumanPolicy } from '@myt/human'
import { center, locate, describe, type Locator } from '@myt/locator'
import type { ErrorKind, RunStore } from '@myt/runs'

/** 单个步骤的执行上下文；步骤只通过它与外界交互。 */
export interface StepContext {
  serial: string
  deviceId: string
  runId: string
  device: DeviceControl
  runs: RunStore
  /** yadb 本地路径；未配置时 `ensureYadb` 会失败。 */
  yadbPath?: string | undefined
  /** 拟人化随机源（可注入种子复现）。 */
  random: Random
  humanPolicy: HumanPolicy
  /** 流程运行参数（手机号、文案等）；由 `FlowRegistry.resolve` 的 params 透传。 */
  flowParams: Record<string, string>
  /**
   * 本地模型调用函数（提示词 → 原始输出）。
   *
   * 未配置时为 undefined，步骤必须回落到自己的确定性定位路径——
   * 这是「模型不可用流程仍能跑」的保证。
   */
  model?: ((prompt: string) => Promise<string>) | undefined
  /**
   * 目标 App 的包名与页面配置（由流程定义提供）。
   *
   * 引擎不认识任何具体 App：页面表、恢复规则、首页深链都从这里取。
   */
  app?: {
    /** 包名（强杀/深链要用）。 */
    packageName: string
    /** 首页深链（回到起点）。 */
    homeUri: string
    /** 页面注册表。 */
    pages: unknown
    /** 异常恢复规则表。 */
    recoveryRules: readonly unknown[]
  } | undefined
  /** 若已被取消则抛错；长循环需要每轮调用。 */
  throwIfCancelled: () => void
  /** 当前快照的惰性获取：同一 step 内多次定位只抓一次。 */
  snapshot(options?: { refresh?: boolean }): Promise<UiSnapshot>
  /** 按定位策略查找并点击；未命中即抛错（由步骤重试策略决定是否重试）。 */
  tapTarget(locator: Locator, options?: TapOptions): Promise<void>
  /** 仅查找，不点击。 */
  findTarget(locator: Locator): Promise<{ x: number; y: number; matchedBy: string }>
  /**
   * 丢弃缓存的 UI 快照。
   *
   * 步骤之间必须调用——上一步操作改变了界面，复用旧快照会定位到已消失的元素。
   */
  invalidateSnapshot(): void
}

export interface StepDefinition {
  id: string
  title: string
  /**
   * 已完成后是否跳过。默认 true：断点续跑时不重放已完成步骤。
   * 有副作用的步骤（发布、评论）必须显式设为 false 或配合 `onceOnly`。
   */
  idempotent?: boolean
  /** 只允许执行一次且不可重放（例如已点「发布」）。 */
  onceOnly?: boolean
  /** 失败重试次数（不含首次）。默认 0。 */
  retries?: number
  /**
   * 步骤主体。
   *
   * 返回字符串时作为该步骤的 `notice` 写入事件流（供 UI 展示提取到的 sid 等产物）；
   * 返回 void 表示无产物。
   */
  run(ctx: StepContext): Promise<void | string>
}

export interface FlowDefinition {
  id: string
  title: string
  steps: StepDefinition[]
  /**
   * 抓取 UI 的通道。
   *
   * 旧 curl 里由内核按 `flowId.startsWith('xhs.login')` 推断（业务知识漏到内核）；
   * 现在由流程自己声明，内核不再猜。
   *
   * - `yadb`：需要完整 dump（登录类，节点多）
   * - `uiautomator`：轻量场景
   * - 缺省 `uiautomator`
   */
  uiChannel?: 'uiautomator' | 'yadb' | undefined
  /**
   * 目标 App 配置（包名、首页深链、页面表、恢复规则）。
   *
   * 由业务包提供，引擎不认识任何具体 App。
   * 类型保持宽松：`@myt/flow` 不依赖 `@myt/automation`（避免循环依赖）。
   */
  app?: unknown | undefined
}

/**
 * 业务包契约：一个可插拔的业务能力集。
 *
 * 内核只做 `ctx.plugin(pack)`，**不写任何具体流程 id**。
 * 加新业务（如抖音）= 新增一个包 + 一行 plugin。
 *
 * 实现方在 `register` 里把自己的流程注册进 `FlowRegistry`；
 * 需要宿主能力（如 S5 代理）时从 `capabilities` 取，不直接 import kernel。
 */
/** 一个动作的参数输入项（UI 据此渲染表单，不再写死 prompt 链）。 */
export interface ActionParam {
  /** 参数名（即传给流程的 key）。 */
  name: string
  /** 中文标签。 */
  label: string
  /** 输入类型。 */
  type: 'text' | 'number' | 'password' | 'textarea' | 'select' | 'confirm'
  /** `select` 的候选。 */
  options?: Array<{ value: string; label: string }>
  /** 默认值（`confirm` 用 `'true'` / `'false'`）。 */
  defaultValue?: string
  /** 是否必填（空值时拒绝提交）。 */
  required?: boolean
  /** 提示文案。 */
  hint?: string
}

/** 一个可执行的业务动作（对应 UI 上的一个按钮/菜单项）。 */
export interface ActionDefinition {
  /** 动作 id（如 `modify-profile`），UI 与 API 都用它。 */
  id: string
  /** 展示名。 */
  label: string
  /** 对应流程 id；为空表示该动作由内核直接执行（不走流程）。 */
  flowId: string
  /** 参数表单；空数组表示无参。 */
  params: ActionParam[]
  /** 是否出现在「单项任务」对话框里。 */
  single?: boolean
  /** 是否需要先选中设备。 */
  requiresSelection?: boolean
  /**
   * 对应登录链上的哪一步（如 `follow-user`）。
   *
   * 链式编排用它把「链动作」解析成流程；缺省表示不参与链。
   */
  chainAction?: string
}

/**
 * 链步骤的触发条件。
 *
 * 用声明式表达式描述「什么时候跑这一步」，替代原先写死在内核的 if/else 顺序。
 * 表达式的原子只引用**运行期输入**（UI 传的 opts 键、运行数据、剩余次数），
 * 不包含任何默认值——默认值仍由 `DEFAULT_LOGIN_MODE` 与 UI 决定。
 */
export interface ChainCondition {
  /** 全部满足。 */
  all?: ChainCondition[]
  /** 任一满足。 */
  any?: ChainCondition[]
  /** 取反。 */
  not?: ChainCondition
  /** 运行开关为真（键名即 UI 传的 opts 键）。 */
  flag?: string
  /** 运行数据非空（如 `nickname`、`followKeywords`）。 */
  has?: string
  /** 剩余次数大于 0。 */
  remaining?: 'loop' | 'retry'
  /** 本次运行中该动作尚未执行过（防重复）。 */
  once?: string
}

/** 链上的一个步骤声明。 */
export interface ChainStepSpec {
  /** 链动作 id（对应 `ActionDefinition.chainAction`）。 */
  action: string
  /** 触发条件；缺省表示无条件。 */
  when?: ChainCondition
  /**
   * 参数模板。
   *
   * 值形如 `'${nickname}'` 时从运行数据取；其余按字面量传。
   */
  params?: Record<string, string> | undefined
}

/**
 * 链配方：一条业务流程编排。
 *
 * 内核只按配方顺序执行，不认识任何具体动作 id。
 * 换业务 = 换一份配方，内核一行不改。
 */
export interface ChainRecipe {
  /** 登录前依次执行（容器切换 → 代理 → 一键新机）。 */
  before: ChainStepSpec[]
  /**
   * 登录成功后依次执行。
   *
   * 注意：这是**第一轮**；某个动作成功后需要续接的步骤写在 `afterAction`。
   */
  afterLogin: ChainStepSpec[]
  /**
   * 某个动作成功后的续接步骤。
   *
   * 旧版 `MODIFY_PROFILE → BIND_PHONE → FOLLOW_USER` 就是这里的 `modify-profile` 键。
   * 有续接时，第一轮里的同名动作会被跳过（避免重复执行）。
   */
  afterAction?: Record<string, ChainStepSpec[]>
  /** 收尾：备份 → 清除。 */
  finalize: ChainStepSpec[]
  /** 循环回到的动作 id；缺省表示不循环。 */
  loopBackTo?: string
}

export interface FlowPack {
  /** 包标识（如 `xhs`），用于日志与诊断。 */
  id: string
  /** 展示名（如「小红书」）。 */
  title: string
  /**
   * 本包对外暴露的动作（UI 据此渲染按钮与表单）。
   *
   * 缺省表示只注册流程、不暴露 UI 动作。
   */
  actions?: ActionDefinition[]
  /**
   * 登录链配方（业务编排）。
   *
   * 缺省表示该包不参与链式编排。
   */
  chain?: ChainRecipe
  /**
   * 注册流程。
   *
   * @param flows 流程注册表
   * @param capabilities 内核暴露的可选能力（宿主 API、配置读取等）
   */
  register(flows: FlowRegistry, capabilities: FlowPackCapabilities): void
}

/**
 * 内核暴露给业务包的能力。
 *
 * 只放**业务真正需要**的，避免把整个内核泄漏给包。
 */
export interface FlowPackCapabilities {
  /** 安全验证识图（6 宫格 → 两位数答案）。由内核注入，包内不关心 LLM 配置来源。 */
  solveSafety?: (image: Buffer, params: Record<string, string>) => Promise<number>
  /** 直接调用宿主 SDK（S5 代理等无法走流程的动作）。 */
  host?: {
    setS5Proxy(options: {
      deviceIp: string
      apiPort: number
      proxyIp: string
      proxyPort: number
      username: string
      password: string
      timeoutMs?: number
    }): Promise<boolean>
  }
}

export interface RunOptions {
  /** 从已有运行续跑：跳过已完成步骤。 */
  resumeFrom?: string | undefined
  /** 只记录不执行（用于校验流程定义）。 */
  dryRun?: boolean | undefined
  /** yadb 本地路径；登录类流程需要。 */
  yadbPath?: string | undefined
  /** 拟人化随机种子；给定后流程可复现。 */
  seed?: number | undefined
  /** UI 抓取通道；小红书登录必须用 yadb（与旧实现一致）。 */
  uiChannel?: 'uiautomator' | 'yadb'
  /** 流程参数（透传给 `StepContext.flowParams`）。 */
  params?: Record<string, string>
  /** 取消信号：步骤之间与步骤内部（调用 throwIfCancelled）生效。 */
  abortSignal?: AbortSignal | undefined
  /** 本地模型调用函数；不传则流程只能走确定性定位。 */
  model?: ((prompt: string) => Promise<string>) | undefined
}
export interface RunResult {
  runId: string
  status: 'succeeded' | 'failed' | 'cancelled'
  steps: number
  failedStep?: string
  errorKind?: ErrorKind
  message?: string
}

/** 运行被取消（与失败区分：cancel 不写 failed 步骤）。 */
export class RunCancelled extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunCancelled'
  }
}

/** 把任意异常收敛到错误分类；Provider 抛错时带 message 即可。 */
function classify(error: unknown): { kind: ErrorKind; message: string } {
  const message = error instanceof Error ? error.message : String(error)
  // 顺序即优先级：设备/环境前提先判，避免被「not found」误判成页面问题。
  if (/device '.*' not found|device offline|unauthorized|no devices/i.test(message)) {
    return { kind: 'precondition', message }
  }
  if (/permission|root|ADBKeyboard|not installed/i.test(message)) return { kind: 'precondition', message }
  if (/timeout|超时|ETIMEDOUT/.test(message)) return { kind: 'transient', message }
  if (/定位失败|not found|未找到/.test(message)) return { kind: 'wrong-page', message }
  if (/风控|验证码|频繁|限制/.test(message)) return { kind: 'platform-reject', message }
  return { kind: 'unknown', message }
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** 构造 `StepContext` 的参数（步骤引擎与图引擎共用）。 */
export interface CreateStepContextInput {
  serial: string
  deviceId: string
  runId: string
  /** 目标 App 配置（宽松类型，避免 `@myt/flow` 依赖 `@myt/automation`）。 */
  app?: unknown | undefined
  options?: RunOptions
}

/**
 * 构造步骤执行上下文。
 *
 * 步骤引擎（`FlowRunner`）和图引擎（`@myt/automation` 的 `runGraph`）共用同一份构造逻辑——
 * 两套引擎必须看到一致的 `ctx`：同样的快照缓存、同样的取消语义、同样的定位回退记录。
 * 各写一份会漂移（实测踩过：图引擎的 snapshot 不复用缓存，每步都重新 dump）。
 */
export function createStepContext(
  device: DeviceControl,
  runs: RunStore,
  input: CreateStepContextInput,
): StepContext {
  const { serial, deviceId, runId, app } = input
  const options = input.options ?? {}
  const random = new Random(options.seed)
  const humanPolicy = DEFAULT_HUMAN_POLICY
  const channel = options.uiChannel ?? 'uiautomator'
  const signal = options.abortSignal
  let cached: UiSnapshot | null = null

  const ctx: StepContext = {
    serial,
    deviceId,
    runId,
    device,
    runs,
    yadbPath: options.yadbPath,
    random,
    humanPolicy,
    flowParams: options.params ?? {},
    model: options.model,
    app: app as StepContext['app'],
    throwIfCancelled() {
      if (signal?.aborted) throw new RunCancelled('运行已取消')
    },
    async snapshot(snapshotOptions = {}) {
      if (!cached || snapshotOptions.refresh) {
        cached = await device.dumpUi(serial, { channel })
      }
      return cached
    },
    async findTarget(locator) {
      const snapshot = await ctx.snapshot()
      const hit = locate(snapshot, locator)
      if (!hit) throw new Error(`定位失败：${locator.kind}=${String(locator.value)}`)
      if (hit.fallback) runs.locatorFallback(runId, 'locate', hit.matchedBy)
      const point = center(hit.node)
      return { ...point, matchedBy: hit.matchedBy }
    },
    async tapTarget(locator, tapOptions) {
      const point = await ctx.findTarget(locator)
      await device.tap(serial, point.x, point.y, tapOptions)
    },
    invalidateSnapshot() {
      cached = null
    },
  }
  return ctx
}

/**
 * 流程执行器。
 *
 * 与旧项目的差别：步骤是显式的（可跳过、可重试、可分类），
 * 每次执行都写入事件流，失败能定位到具体步骤而不是整条流程重来。
 */
export class FlowRunner {
  private readonly runs: RunStore
  private readonly device: DeviceControl

  constructor(runs: RunStore, device: DeviceControl) {
    this.runs = runs
    this.device = device
  }

  async run(
    flow: FlowDefinition,
    input: { deviceId: string; serial: string },
    options: RunOptions = {},
  ): Promise<RunResult> {
    const record = options.resumeFrom
      ? this.runs.get(options.resumeFrom)
      : this.runs.start({ flowId: flow.id, deviceId: input.deviceId, serial: input.serial })

    if (!record) throw new Error(`无法续跑：运行不存在 ${options.resumeFrom}`)
    const runId = record.runId
    const completed = options.resumeFrom ? this.runs.completedSteps(runId) : new Set<string>()

    const ctx = createStepContext(this.device, this.runs, {
      serial: input.serial,
      deviceId: input.deviceId,
      runId,
      app: flow.app,
      options,
    })
    const signal = options.abortSignal

    let executed = 0
    for (const step of flow.steps) {
      if (signal?.aborted) {
        this.runs.finish(runId, 'cancelled', executed)
        return { runId, status: 'cancelled', steps: executed, message: '运行已取消' }
      }
      if (completed.has(step.id)) {
        this.runs.stepSkipped(runId, step.id, 'completed-checkpoint')
        continue
      }
      if (options.dryRun) {
        this.runs.stepSkipped(runId, step.id, 'dry-run')
        continue
      }

      const attemptCount = (step.retries ?? 0) + 1
      let lastError: { kind: ErrorKind; message: string } | null = null

      for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
        const startedAt = Date.now()
        this.runs.stepStarted(runId, step.id, step.title)
        try {
          ctx.invalidateSnapshot()
          const notice = await step.run(ctx)
          this.runs.stepSucceeded(
            runId,
            step.id,
            Date.now() - startedAt,
            typeof notice === 'string' ? notice : undefined,
          )
          executed += 1
          lastError = null
          break
        } catch (error) {
          if (error instanceof RunCancelled || signal?.aborted) {
            this.runs.finish(runId, 'cancelled', executed, step.id)
            return { runId, status: 'cancelled', steps: executed, failedStep: step.id, message: '运行已取消' }
          }
          const info = classify(error)
          lastError = info
          this.runs.stepFailed(runId, step.id, Date.now() - startedAt, info.kind, info.message)
          // 只有 transient / wrong-page 值得重试；其余立即失败。
          const retryable = info.kind === 'transient' || info.kind === 'wrong-page'
          if (!retryable || attempt === attemptCount) break
          this.runs.stepRetried(runId, step.id, attempt, info.message)
          await delay(500 * attempt)
        }
      }

      if (lastError) {
        this.runs.finish(runId, 'failed', executed, step.id)
        return { runId, status: 'failed', steps: executed, failedStep: step.id, errorKind: lastError.kind, message: lastError.message }
      }
    }

    this.runs.finish(runId, 'succeeded', executed)
    return { runId, status: 'succeeded', steps: executed }
  }
}

export { describe }

/** 流程注册表：按 id 注册，供 API 与 UI 按名称触发。 */
export class FlowRegistry extends Service {
  private readonly flows = new Map<string, FlowDefinition>()
  private readonly factories = new Map<string, (params: Record<string, unknown>) => FlowDefinition>()

  constructor(ctx: ConstructorParameters<typeof Service>[0]) {
    super(ctx, 'flows')
  }

  register(flow: FlowDefinition): () => void {
    if (this.flows.has(flow.id)) throw new Error(`流程重复注册：${flow.id}`)
    this.flows.set(flow.id, flow)
    return () => {
      this.flows.delete(flow.id)
    }
  }

  /**
   * 注册参数化流程：运行时用 `params` 构造具体步骤。
   * 只读流程用 `register`，需要输入（手机号、文案…）的流程用这个。
   */
  registerFactory(
    id: string,
    meta: { title: string },
    factory: (params: Record<string, unknown>) => FlowDefinition,
  ): () => void {
    if (this.factories.has(id)) throw new Error(`流程工厂重复注册：${id}`)
    this.factories.set(id, factory)
    this.factoryMeta.set(id, meta)
    return () => {
      this.factories.delete(id)
      this.factoryMeta.delete(id)
    }
  }

  private readonly factoryMeta = new Map<string, { title: string }>()

  get(id: string): FlowDefinition | undefined {
    return this.flows.get(id)
  }

  /** 解析流程：静态流程直接返回；参数化流程用 params 构造。 */
  resolve(id: string, params: Record<string, unknown> = {}): FlowDefinition | undefined {
    const fixed = this.flows.get(id)
    if (fixed) return fixed
    const factory = this.factories.get(id)
    return factory ? factory(params) : undefined
  }

  list(): Array<{ id: string; title: string; steps: number | null; params: boolean }> {
    const rows = [...this.flows.values()].map((flow) => ({
      id: flow.id,
      title: flow.title,
      steps: flow.steps.length as number | null,
      params: false,
    }))
    for (const [id, meta] of this.factoryMeta) {
      rows.push({ id, title: meta.title, steps: null, params: true })
    }
    return rows
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    flows: FlowRegistry
  }
}

/** Cordis Loader 按包名导入时要求默认导出。 */
export default FlowRegistry
