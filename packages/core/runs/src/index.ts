import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import { EventLog, type EventRow } from './event-log.ts'

/** 步骤失败分类（shared-steps §9），决定重试还是人工介入。 */
export type ErrorKind = 'transient' | 'wrong-page' | 'precondition' | 'platform-reject' | 'unknown'

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'

export type StepStatus = 'running' | 'succeeded' | 'failed' | 'skipped'

/** 一次运行的事件；追加写入，不修改（runtime-and-storage §2）。 */
export type RunEvent =
  | { type: 'run/started'; runId: string; ts: number; flowId: string; deviceId: string; serial: string }
  | { type: 'run/finished'; runId: string; ts: number; status: RunStatus; steps: number; failedStep?: string | undefined }
  | { type: 'step/started'; runId: string; ts: number; stepId: string; title: string }
  | { type: 'step/succeeded'; runId: string; ts: number; stepId: string; durationMs: number; note?: string | undefined }
  | {
      type: 'step/failed'
      runId: string
      ts: number
      stepId: string
      durationMs: number
      errorKind: ErrorKind
      message: string
    }
  | { type: 'step/retried'; runId: string; ts: number; stepId: string; attempt: number; reason: string }
  | {
      type: 'step/skipped'
      runId: string
      ts: number
      stepId: string
      reason: 'completed-checkpoint' | 'condition' | 'dry-run'
    }
  | { type: 'locator/fallback'; runId: string; ts: number; stepId: string; matchedBy: string }
  | { type: 'assert/failed'; runId: string; ts: number; stepId: string; message: string }
  | { type: 'artifact'; runId: string; ts: number; stepId?: string | undefined; kind: 'screenshot' | 'dump'; sha256: string }

export interface RunRecord {
  runId: string
  flowId: string
  deviceId: string
  serial: string
  startedAt: number
  finishedAt?: number
  status: RunStatus
  events: RunEvent[]
}

export interface RunsConfig {
  /** 保留在内存中的最大运行数；超出后归档最早完成的。 */
  keepRuns?: number
  /**
   * 事件库路径（`runtime-and-storage.md` §4 默认 `data/db.sqlite`）。
   *
   * 不配则纯内存运行（测试与 `:memory:` 场景），行为与接入前一致。
   */
  dbPath?: string
  /** 事件保留天数（§5 默认 90 天）。 */
  retentionDays?: number
}

/**
 * 运行事件流。
 *
 * 只追加事件、不修改历史；`checkpoint` 从事件推导，供断点续跑使用。
 * 内存中的 `RunRecord` 是读模型，事实来源是 SQLite 的 `events` 表——
 * 进程重启后从这里重建投影，未完成的运行标 `interrupted` 且不自动续跑。
 */
export class RunStore extends Service {
  private readonly keepRuns: number
  private readonly runs = new Map<string, RunRecord>()
  private readonly dbPath: string | undefined
  private readonly retentionDays: number
  private log: EventLog | undefined
  /** 库还没打开时先攒着，打开后按序补写（顺序不能乱）。 */
  private pendingWrites: RunEvent[] = []
  private readonly readyPromise: Promise<void>
  private markReady: () => void = () => {}

  constructor(ctx: ConstructorParameters<typeof Service>[0], config: RunsConfig = {}) {
    super(ctx, 'runs')
    this.keepRuns = config.keepRuns ?? 500
    this.dbPath = config.dbPath
    this.retentionDays = config.retentionDays ?? 90
    this.readyPromise = new Promise<void>((resolve) => {
      this.markReady = resolve
    })
    if (this.dbPath) void this.openLog(this.dbPath)
    else this.markReady()
  }

  /**
   * 等事件库就绪（或已确定降级为纯内存）。
   *
   * 构造是同步的、打开是异步的，调用方需要知道「历史投影已重建完成」
   * 才能读 `list()`/`get()`，否则看到的是空表。
   */
  whenReady(): Promise<void> {
    return this.readyPromise
  }

  /**
   * 打开事件库并重建投影。
   *
   * 落库失败只降级为纯内存，绝不阻断跑流程。
   */
  private async openLog(path: string): Promise<void> {
    try {
      const log = await EventLog.open(path, { retentionDays: this.retentionDays })
      for (const event of this.pendingWrites) this.writeEvent(log, event)
      this.pendingWrites = []
      this.log = log
      this.rebuild(log.loadAll())
      log.prune()
    } catch {
      // 保持纯内存模式。
    } finally {
      this.markReady()
    }
  }

  /** 从事件表重建历史运行；本次进程内已在 `runs` 里的不覆盖。 */
  private rebuild(rows: readonly EventRow[]): void {
    const byRun = new Map<string, EventRow[]>()
    for (const row of rows) {
      const list = byRun.get(row.runId)
      if (list) list.push(row)
      else byRun.set(row.runId, [row])
    }

    for (const [runId, table] of byRun) {
      if (this.runs.has(runId)) continue
      const started = table.find((row) => row.type === 'run/started')
      const startedPayload = (started?.payload ?? {}) as { flowId?: string; deviceId?: string; serial?: string }
      const lastFinish = [...table].reverse().find((row) => row.type === 'run/finished')
      const finishedPayload = (lastFinish?.payload ?? {}) as { status?: RunStatus }
      const record: RunRecord = {
        runId,
        flowId: startedPayload.flowId ?? '',
        deviceId: startedPayload.deviceId ?? '',
        serial: startedPayload.serial ?? '',
        startedAt: started?.ts ?? table[0]?.ts ?? Date.now(),
        status: finishedPayload.status ?? 'running',
        events: table.map((row) => ({ ...(row.payload as object), runId, ts: row.ts, type: row.type }) as RunEvent),
      }
      if (lastFinish) record.finishedAt = lastFinish.ts
      this.runs.set(runId, record)

      // 崩溃恢复（§3）：库里仍为 running 说明上次进程没走完，标中断不续跑。
      if (record.status === 'running') {
        record.status = 'interrupted'
        record.finishedAt = Date.now()
        this.append(record, {
          type: 'run/finished',
          runId,
          ts: Date.now(),
          status: 'interrupted',
          steps: record.events.filter((event) => event.type === 'step/started').length,
        })
      }
    }
  }

  /** 事件去掉 runId/ts 后作为 payload 落库。 */
  private writeEvent(log: EventLog, event: RunEvent): void {
    const { runId, ts, type, ...payload } = event as RunEvent & { runId: string; ts: number; type: string }
    log.append(runId, ts, type, payload)
  }

  start(input: { flowId: string; deviceId: string; serial: string }): RunRecord {
    const runId = randomUUID()
    const record: RunRecord = {
      runId,
      flowId: input.flowId,
      deviceId: input.deviceId,
      serial: input.serial,
      startedAt: Date.now(),
      status: 'running',
      events: [],
    }
    this.runs.set(runId, record)
    this.append(record, {
      type: 'run/started',
      runId,
      ts: Date.now(),
      flowId: input.flowId,
      deviceId: input.deviceId,
      serial: input.serial,
    })
    this.evict()
    return record
  }

  private append(record: RunRecord, event: RunEvent): void {
    record.events.push(event)
    // 内存是读模型，事件表才是事实来源：每次追加都同步落库。
    if (this.log) this.writeEvent(this.log, event)
    else if (this.dbPath) this.pendingWrites.push(event)
  }

  private require(runId: string): RunRecord {
    const record = this.runs.get(runId)
    if (!record) throw new Error(`运行不存在：${runId}`)
    return record
  }

  stepStarted(runId: string, stepId: string, title: string): void {
    const record = this.require(runId)
    this.append(record, { type: 'step/started', runId, ts: Date.now(), stepId, title })
  }

  stepSucceeded(runId: string, stepId: string, durationMs: number, note?: string): void {
    const record = this.require(runId)
    this.append(record, { type: 'step/succeeded', runId, ts: Date.now(), stepId, durationMs, note })
  }

  stepFailed(runId: string, stepId: string, durationMs: number, errorKind: ErrorKind, message: string): void {
    const record = this.require(runId)
    this.append(record, {
      type: 'step/failed',
      runId,
      ts: Date.now(),
      stepId,
      durationMs,
      errorKind,
      message,
    })
  }

  stepRetried(runId: string, stepId: string, attempt: number, reason: string): void {
    const record = this.require(runId)
    this.append(record, { type: 'step/retried', runId, ts: Date.now(), stepId, attempt, reason })
  }

  stepSkipped(runId: string, stepId: string, reason: 'completed-checkpoint' | 'condition' | 'dry-run'): void {
    const record = this.require(runId)
    this.append(record, { type: 'step/skipped', runId, ts: Date.now(), stepId, reason })
  }

  locatorFallback(runId: string, stepId: string, matchedBy: string): void {
    const record = this.require(runId)
    this.append(record, { type: 'locator/fallback', runId, ts: Date.now(), stepId, matchedBy })
  }

  assertFailed(runId: string, stepId: string, message: string): void {
    const record = this.require(runId)
    this.append(record, { type: 'assert/failed', runId, ts: Date.now(), stepId, message })
  }

  artifact(runId: string, kind: 'screenshot' | 'dump', sha256: string, stepId?: string): void {
    const record = this.require(runId)
    this.append(record, { type: 'artifact', runId, ts: Date.now(), stepId, kind, sha256 })
  }

  finish(runId: string, status: RunStatus, steps: number, failedStep?: string): void {
    const record = this.require(runId)
    record.status = status
    record.finishedAt = Date.now()
    this.append(record, { type: 'run/finished', runId, ts: Date.now(), status, steps, failedStep })
  }

  /** 进程重启时把所有未完成运行标为中断（不自动续跑）。 */
  markInterrupted(): number {
    let count = 0
    for (const record of this.runs.values()) {
      if (record.status !== 'running') continue
      record.status = 'interrupted'
      record.finishedAt = Date.now()
      this.append(record, {
        type: 'run/finished',
        runId: record.runId,
        ts: Date.now(),
        status: 'interrupted',
        steps: record.events.filter((event) => event.type === 'step/started').length,
      })
      count += 1
    }
    return count
  }

  get(runId: string): RunRecord | undefined {
    return this.runs.get(runId)
  }

  list(filter: { status?: RunStatus; deviceId?: string; limit?: number } = {}): RunRecord[] {
    const rows = [...this.runs.values()].filter((record) => {
      if (filter.status && record.status !== filter.status) return false
      if (filter.deviceId && record.deviceId !== filter.deviceId) return false
      return true
    })
    rows.sort((a, b) => b.startedAt - a.startedAt)
    return filter.limit ? rows.slice(0, filter.limit) : rows
  }

  /** 从事件推导已完成步骤，供断点续跑。 */
  completedSteps(runId: string): Set<string> {
    const record = this.require(runId)
    const done = new Set<string>()
    for (const event of record.events) {
      if (event.type === 'step/succeeded') done.add(event.stepId)
    }
    return done
  }

  /** 按 run 导出 JSONL（`runtime-and-storage.md` §1）。无库时返回空串。 */
  exportJsonl(runId: string): string {
    return this.log?.exportJsonl(runId) ?? ''
  }

  /** 归档超过保留期的事件；返回删除条数。 */
  prune(now: number = Date.now()): number {
    return this.log?.prune(now) ?? 0
  }

  /** 关闭事件库（进程退出时调用）。 */
  close(): void {
    this.log?.close()
    this.log = undefined
  }

  private evict(): void {
    if (this.runs.size <= this.keepRuns) return
    const finished = [...this.runs.values()]
      .filter((record) => record.status !== 'running')
      .sort((a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt))
    for (const record of finished) {
      if (this.runs.size <= this.keepRuns) break
      this.runs.delete(record.runId)
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    runs: RunStore
  }
}

/** Cordis Loader 按包名导入时要求默认导出。 */
export default RunStore
