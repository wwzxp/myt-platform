import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'

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
}

/**
 * 运行事件流。
 *
 * 只追加事件、不修改历史；`checkpoint` 从事件推导，供断点续跑使用。
 * 首期落内存（进程退出即丢失），落库按 `runtime-and-storage.md` 后续接 SQLite。
 */
export class RunStore extends Service {
  private readonly keepRuns: number
  private readonly runs = new Map<string, RunRecord>()

  constructor(ctx: ConstructorParameters<typeof Service>[0], config: RunsConfig = {}) {
    super(ctx, 'runs')
    this.keepRuns = config.keepRuns ?? 500
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
