import { randomUUID } from 'node:crypto'
import { validateFlowGraph, FlowGraphError } from '@myt/automation'
import { runXhsGraph } from '@myt/flow-xhs-publish/runtime'
import type { StepContext } from '@myt/flow'

/**
 * 流程任务调度：实现 flowgram 前端的 5 个运行时接口。
 *
 * 前端的 `WorkflowRuntimeServerClient` 调的就是这 5 个 HTTP 端点
 * （`/api/task/{validate,run,report,result,cancel}`），因此**前端一行不用改**，
 * 只要把 `runtime-plugin` 的 `mode` 切到 `server` 并指向内核端口。
 *
 * 为什么需要这一层：
 * flowgram 自带的 `@flowgram.ai/runtime-js` 只认识它自己的 `llm`/`http`/`code` 节点，
 * 不认识我们的 `mt-action`/`mt-condition`。它跑在浏览器里，也够不到 ADB。
 * 把执行放到内核（Node），才可能真正驱动手机。
 */

/** flowgram `WorkflowStatus` 的取值（前端按它给节点染色）。 */
export type WorkflowStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'canceled'

/** 单个节点的执行状态（前端 `reports[nodeId]`）。 */
export interface NodeReport {
  id: string
  status: WorkflowStatus
  terminated: boolean
  startTime: number
  endTime?: number
  timeCost: number
  snapshots: unknown[]
}

/** `GET /api/task/report` 的响应体。 */
export interface WorkflowReport {
  id: string
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  workflowStatus: {
    status: WorkflowStatus
    terminated: boolean
    startTime: number
    endTime?: number
    timeCost: number
  }
  reports: Record<string, NodeReport>
  messages: Record<string, unknown[]>
}

/** 一个在跑或跑完的任务。 */
interface FlowTask {
  id: string
  status: WorkflowStatus
  startTime: number
  endTime?: number
  reports: Map<string, NodeReport>
  outputs: Record<string, unknown>
  abort: AbortController
}

/** `TaskRun` 入参（flowgram 约定：`schema` 是整张图的 JSON 字符串）。 */
export interface TaskRunInput {
  inputs?: Record<string, unknown>
  schema: string
}

/** 图执行的依赖：由内核注入（设备、存储、运行记录）。 */
export interface FlowTaskDeps {
  /** 为某台设备构造步骤上下文；与步骤引擎共用同一份构造逻辑。 */
  createContext: (input: {
    serial: string
    deviceId: string
    runId: string
    app: unknown
    abortSignal: AbortSignal
    params: Record<string, string>
  }) => StepContext
  /** 选择执行设备；单机开发时返回默认设备。 */
  pickDevice: (deviceId?: string) => { deviceId: string; serial: string }
}

/** 任务表上限：防止长时间运行把内存撑爆。 */
const MAX_TASKS = 64

/**
 * 流程任务调度器。
 *
 * 设计要点：
 * - `run` **立即返回 taskID**（flowgram 约定），执行在后台继续
 * - 前端靠 `report` 轮询，读的是本对象里的快照，不重复读设备
 * - 快照以「节点」为粒度：前端按 `reports[nodeId].status` 染色
 */
export class FlowTaskRunner {
  private readonly tasks = new Map<string, FlowTask>()
  private readonly deps: FlowTaskDeps

  constructor(deps: FlowTaskDeps) {
    this.deps = deps
  }

  /**
   * 把画布的业务配置提取到图顶层的 `data`。
   *
   * **配置来源是画布本身**：`schema.globalVariable`（JSON Schema）里
   * `properties.app.default` 与 `properties.maxSteps.default` 就是用户的配置值。
   * 用户在变量面板里改的正是它们，所以图是自包含的——换机器、复制文件都带着配置。
   *
   * 为什么不用顶层 `data` 直接存：那样用户看不见也改不了，必须另做 UI。
   *
   * @returns 注入 `data` 之后的图对象（不修改入参）
   */
  private withConfig(input: unknown): unknown {
    const obj = (input ?? {}) as Record<string, unknown>

    // 已经带 data 的（老格式 / 手工构造）直接用
    if (obj['data'] !== undefined) return obj

    const globalVariable = obj['globalVariable']
    if (!globalVariable || typeof globalVariable !== 'object') {
      throw new FlowGraphError(
        '画布缺少 globalVariable：app 与 maxSteps 必须在变量面板里配置（见 docs/spec/流程图引擎与可视化编排.md）',
      )
    }

    const properties = (globalVariable as Record<string, unknown>)['properties']
    if (!properties || typeof properties !== 'object') {
      throw new FlowGraphError('globalVariable 缺少 properties：请在变量面板添加 app 与 maxSteps')
    }

    const props = properties as Record<string, unknown>
    const appSchema = props['app'] as Record<string, unknown> | undefined
    const maxStepsSchema = props['maxSteps'] as Record<string, unknown> | undefined

    const app = appSchema?.['default']
    if (app === undefined) {
      throw new FlowGraphError('globalVariable 缺少 app.default：请在变量面板配置目标 App')
    }
    const maxSteps = maxStepsSchema?.['default']
    if (typeof maxSteps !== 'number') {
      throw new FlowGraphError('globalVariable 缺少 maxSteps.default（数字）：请填写最大执行步数')
    }

    return { ...obj, data: { app, maxSteps } }
  }

  /**
   * `POST /api/task/validate`：只校验，不执行。
   *
   * 返回体必须严格是 flowgram 的 `ValidationResult`：`{ valid, errors?: string[] }`。
   * `errors` 是**字符串数组**，不是对象数组——返回对象会让前端解析失败并显示
   * "Internal Server Error"（实测踩过）。
   */
  validate(schema: string): { valid: boolean; errors?: string[] } {
    try {
      const parsed = JSON.parse(schema) as unknown
      // 前端 schema 只有 `{nodes, edges}`，不带业务配置——补全后再校验。
      const graph = validateFlowGraph(this.withConfig(parsed))
      if (!graph.data.app.packageName) {
        return { valid: false, errors: ['app.packageName 为空'] }
      }
      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const where = error instanceof FlowGraphError && error.subject ? `（节点 ${error.subject}）` : ''
      return { valid: false, errors: [`${message}${where}`] }
    }
  }

  /** `POST /api/task/run`：启动执行，立即返回 taskID。 */
  run(input: TaskRunInput): { taskID: string } {
    const taskID = randomUUID()
    const task: FlowTask = {
      id: taskID,
      status: 'pending',
      startTime: Date.now(),
      reports: new Map(),
      outputs: {},
      abort: new AbortController(),
    }
    this.tasks.set(taskID, task)
    this.evict()

    // 后台执行；不 await——flowgram 约定 run 立即返回
    void this.execute(task, input).catch((error: unknown) => {
      task.status = 'failed'
      task.endTime = Date.now()
      task.outputs = { error: error instanceof Error ? error.message : String(error) }
    })
    return { taskID }
  }

  /** `GET /api/task/report`：取当前进度。 */
  report(taskID: string): WorkflowReport | undefined {
    const task = this.tasks.get(taskID)
    if (!task) return undefined
    const elapsed = (task.endTime ?? Date.now()) - task.startTime
    const reports: Record<string, NodeReport> = {}
    for (const [nodeId, report] of task.reports) reports[nodeId] = report
    return {
      id: task.id,
      inputs: {},
      outputs: task.outputs,
      workflowStatus: {
        status: task.status,
        terminated: task.status !== 'pending' && task.status !== 'processing',
        startTime: task.startTime,
        ...(task.endTime === undefined ? {} : { endTime: task.endTime }),
        timeCost: elapsed,
      },
      reports,
      messages: {},
    }
  }

  /** `GET /api/task/result`：取最终输出。 */
  result(taskID: string): Record<string, unknown> | undefined {
    const task = this.tasks.get(taskID)
    if (!task || !task.endTime) return undefined
    return task.outputs
  }

  /** `PUT /api/task/cancel`：取消执行。 */
  cancel(taskID: string): { success: boolean } {
    const task = this.tasks.get(taskID)
    if (!task) return { success: false }
    task.abort.abort()
    task.status = 'canceled'
    task.endTime = Date.now()
    return { success: true }
  }

  /** 真正执行：把每个节点的结果写进 `task.reports`。 */
  private async execute(task: FlowTask, input: TaskRunInput): Promise<void> {
    task.status = 'processing'
    let parsed: unknown
    try {
      parsed = JSON.parse(input.schema)
    } catch (error) {
      throw new Error(`图 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`)
    }
    const loaded = validateFlowGraph(this.withConfig(parsed))

    const params: Record<string, string> = {}
    for (const [key, value] of Object.entries(input.inputs ?? {})) {
      params[key] = typeof value === 'string' ? value : String(value)
    }
    const device = this.deps.pickDevice(params['deviceId'])
    const ctx = this.deps.createContext({
      serial: device.serial,
      deviceId: device.deviceId,
      runId: task.id,
      app: loaded.data.app,
      abortSignal: task.abort.signal,
      params,
    })

    // 所有节点先置 pending，前端才能画灰态
    for (const node of loaded.nodes) {
      task.reports.set(node.id, {
        id: node.id,
        status: 'pending',
        terminated: false,
        startTime: 0,
        timeCost: 0,
        snapshots: [],
      })
    }

    const outcome = await runXhsGraph(ctx, loaded)

    // 用执行轨迹回填每个节点的最终状态
    for (const entry of outcome.trail) {
      const report = task.reports.get(entry.node)
      if (!report) continue
      report.status = entry.port === undefined || entry.port === 'success' || entry.port === 'true' || entry.port === 'false' || entry.port === 'out' || entry.port === 'done'
        ? 'succeeded'
        : 'failed'
      report.terminated = true
      report.timeCost = entry.ms
    }

    task.status = outcome.ok ? 'succeeded' : 'failed'
    task.endTime = Date.now()
    task.outputs = {
      ok: outcome.ok,
      ...(outcome.failedAt === undefined ? {} : { failedAt: outcome.failedAt }),
      ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
      trail: outcome.trail,
      ms: outcome.ms,
    }
  }

  /** 丢弃最老的任务，保持内存上限。 */
  private evict(): void {
    if (this.tasks.size <= MAX_TASKS) return
    const oldest = [...this.tasks.values()]
      .filter((task) => task.endTime !== undefined)
      .sort((a, b) => a.startTime - b.startTime)[0]
    if (oldest) this.tasks.delete(oldest.id)
  }
}
