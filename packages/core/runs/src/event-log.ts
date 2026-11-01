import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

/**
 * `node:sqlite` 走原生 `require` 而不是 `await import()`。
 *
 * vitest 的模块解析器会把 `node:sqlite` 剥成 `sqlite` 再去找包，
 * 直接报 `Failed to load url sqlite`。内置模块交给 Node 自己解析最省事。
 */
const requireBuiltin = createRequire(import.meta.url)

/**
 * 事件日志（`runtime-and-storage.md` §1/§2/§5）。
 *
 * 落 SQLite（WAL），表 `events`：**只追加**，不修改、不删除；
 * 保留期到了才归档。内存里的 `RunRecord.events` 是读模型，
 * 这里才是事实来源——进程重启后投影从这张表重建。
 */
export type EventRow = {
  runId: string
  seq: number
  ts: number
  type: string
  payload: unknown
}

/** 敏感字段名（小写比较）。命中即脱敏，绝不让它们进事件表。 */
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'credential',
  'creditcard',
  'cardkey',
  'card_key',
  'apikey',
  'api_key',
  'sid',
  'cookie',
] as const

/** 脱敏后的占位符。保留键名，方便排查「这里本该有值」。 */
const REDACTED = '[redacted]'

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[_-]/g, '')
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern.replace(/[_-]/g, '')))
}

/**
 * 递归脱敏。
 *
 * 规则 3 要求「写入前脱敏」，所以在**落库那一刻**做，而不是指望每个事件
 * 的生产者自觉——漏一个就把凭据写进磁盘了。
 */
export function redactPayload(value: unknown, depth: number = 0): unknown {
  if (depth > 12) return value
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => redactPayload(item, depth + 1))

  const source = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactPayload(item, depth + 1)
  }
  return out
}

/**
 * 事件表句柄。
 *
 * 打开是异步的（`node:sqlite` 要动态 import），而 `RunStore` 的构造是同步的，
 * 所以这里提供 `enqueue`：DB 就绪前先排队，就绪后按序补写。
 * 事件顺序不能乱，因此队列是 FIFO 且只由单线程 JS 驱动。
 */
export class EventLog {
  private db: DatabaseSync | undefined
  private readonly pending: Array<() => void> = []
  private readonly nextSeq = new Map<string, number>()
  private closed = false

  private constructor(
    private readonly path: string,
    private readonly retentionDays: number,
  ) {}

  /** 打开（或创建）事件库。`:memory:` 供测试使用。 */
  static async open(path: string, options: { retentionDays?: number } = {}): Promise<EventLog> {
    const log = new EventLog(path, options.retentionDays ?? 90)
    await log.init()
    return log
  }

  private async init(): Promise<void> {
    const actual = this.path === ':memory:' ? this.path : resolve(this.path)
    if (actual !== ':memory:') await mkdir(dirname(actual), { recursive: true })
    const { DatabaseSync } = requireBuiltin('node:sqlite') as typeof import('node:sqlite')
    const db = new DatabaseSync(actual)
    try {
      // WAL：单机下并发读不阻塞写（§1 的假设就是单机）。
      db.exec('PRAGMA journal_mode = WAL')
      db.exec('PRAGMA synchronous = NORMAL')
      db.exec(`
        CREATE TABLE IF NOT EXISTS events (
          run_id  TEXT    NOT NULL,
          seq     INTEGER NOT NULL,
          ts      INTEGER NOT NULL,
          type    TEXT    NOT NULL,
          payload TEXT    NOT NULL,
          PRIMARY KEY (run_id, seq)
        ) WITHOUT ROWID
      `)
      // 保留期清理与「按时间导出 JSONL」都要走 ts。
      db.exec('CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)')
    } catch (error: unknown) {
      db.close()
      throw error
    }
    this.db = db
    this.flush()
  }

  private flush(): void {
    while (this.pending.length > 0) this.pending.shift()!()
  }

  /** 追加一条事件；DB 未就绪时排队。永不抛错——写日志不该弄挂业务。 */
  append(runId: string, ts: number, type: string, payload: unknown): void {
    const write = (): void => {
      const db = this.db
      if (!db) return
      const seq = this.nextSeq.get(runId) ?? 0
      this.nextSeq.set(runId, seq + 1)
      try {
        db.prepare('INSERT INTO events (run_id, seq, ts, type, payload) VALUES (?, ?, ?, ?, ?)').run(
          runId,
          seq,
          ts,
          type,
          JSON.stringify(redactPayload(payload)) ?? 'null',
        )
      } catch {
        // 写日志失败不能打断流程；内存里的事件仍在。
      }
    }
    if (this.db) write()
    else this.pending.push(write)
  }

  /** 读出全部未归档事件，供启动时重建投影。 */
  loadAll(): EventRow[] {
    const db = this.db
    if (!db) return []
    const rows = db
      .prepare('SELECT run_id, seq, ts, type, payload FROM events ORDER BY run_id, seq')
      .all() as Array<{ run_id: string; seq: number; ts: number; type: string; payload: string }>
    return rows.map((row) => {
      this.nextSeq.set(row.run_id, Math.max(this.nextSeq.get(row.run_id) ?? 0, row.seq + 1))
      return {
        runId: row.run_id,
        seq: row.seq,
        ts: row.ts,
        type: row.type,
        payload: JSON.parse(row.payload) as unknown,
      }
    })
  }

  /** 删除超过保留期的事件；返回删除条数。 */
  prune(now: number = Date.now()): number {
    const db = this.db
    if (!db) return 0
    const cutoff = now - this.retentionDays * 24 * 60 * 60 * 1000
    const result = db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff)
    return Number(result.changes ?? 0)
  }

  /** 按 run 导出 JSONL（`runtime-and-storage.md` §1「可导出 JSONL」）。 */
  exportJsonl(runId: string): string {
    const db = this.db
    if (!db) return ''
    const rows = db
      .prepare('SELECT seq, ts, type, payload FROM events WHERE run_id = ? ORDER BY seq')
      .all(runId) as Array<{ seq: number; ts: number; type: string; payload: string }>
    return rows.map((row) => JSON.stringify({ runId, ...row, payload: JSON.parse(row.payload) })).join('\n')
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db?.close()
    this.db = undefined
  }
}
