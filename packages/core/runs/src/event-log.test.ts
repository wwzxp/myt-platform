import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RunStore } from './index.ts'
import { EventLog, redactPayload } from './event-log.ts'

let dir: string
let dbPath: string
/** Windows 上句柄不关就删不掉库文件，所以每个用例统一回收。 */
const opened: Array<{ close(): void }> = []

function openStore(): RunStore {
  const store = new RunStore(new Context(), { dbPath })
  opened.push(store)
  return store
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'myt-runs-'))
  dbPath = join(dir, 'db.sqlite')
})

afterEach(async () => {
  for (const handle of opened.splice(0)) handle.close()
  // WAL 模式下还有 -wal/-shm 旁文件，force 兜住。
  await rm(dir, { recursive: true, force: true })
})

describe('RunStore 落库', () => {
  it('重启后从事件表重建运行，字段与事件顺序都还原', async () => {
    const store = openStore()
    const record = store.start({ flowId: 'xhs.publish.text', deviceId: 'dev-1', serial: '127.0.0.1:5565' })
    store.stepStarted(record.runId, 'prepare', '准备')
    store.stepSucceeded(record.runId, 'prepare', 1200)
    store.locatorFallback(record.runId, 'prepare', 'hardcoded')
    store.stepFailed(record.runId, 'submit', 300, 'platform-reject', '平台拒绝')
    store.finish(record.runId, 'failed', 2, 'submit')
    await store.whenReady()
    store.close()

    const reopened = openStore()
    await reopened.whenReady()
    const rebuilt = reopened.get(record.runId)

    expect(rebuilt?.flowId).toBe('xhs.publish.text')
    expect(rebuilt?.deviceId).toBe('dev-1')
    expect(rebuilt?.status).toBe('failed')
    expect(rebuilt?.events.map((event) => event.type)).toEqual([
      'run/started',
      'step/started',
      'step/succeeded',
      'locator/fallback',
      'step/failed',
      'run/finished',
    ])
    // 判别式字段要能还原，否则 UI 拿不到 durationMs/errorKind。
    expect(rebuilt?.events[2]).toMatchObject({ type: 'step/succeeded', stepId: 'prepare', durationMs: 1200 })
    expect(rebuilt?.events[4]).toMatchObject({ type: 'step/failed', errorKind: 'platform-reject' })
  })

  it('库里仍是 running 的运行在重启后标 interrupted，且不自动续跑', async () => {
    const log = await EventLog.open(dbPath)
    log.append('crashed', Date.now(), 'run/started', { flowId: 'f', deviceId: 'd', serial: 's' })
    log.append('crashed', Date.now(), 'step/started', { stepId: 'a', title: 'A' })
    log.close()

    const store = openStore()
    await store.whenReady()
    expect(store.get('crashed')?.status).toBe('interrupted')
    // 中断事件本身也要落库，否则下次重启会重复标一次。
    const log2 = await EventLog.open(dbPath)
    expect(log2.exportJsonl('crashed')).toContain('"status":"interrupted"')
    log2.close()
  })

  it('seq 在单 run 内单调递增且内容不变（只追加）', async () => {
    const store = openStore()
    const record = store.start({ flowId: 'f', deviceId: 'd', serial: 's' })
    store.stepStarted(record.runId, 'a', 'A')
    store.stepSucceeded(record.runId, 'a', 10)
    await store.whenReady()

    const log = await EventLog.open(dbPath)
    const rows = log.loadAll().filter((row) => row.runId === record.runId)
    expect(rows.map((row) => row.seq)).toEqual([0, 1, 2])
    // 追加第二条 started 不应改写第一条。
    expect(rows.filter((row) => row.type === 'step/started')).toHaveLength(1)
    log.close()
  })

  it('按 run 导出 JSONL', async () => {
    const store = openStore()
    const record = store.start({ flowId: 'f', deviceId: 'd', serial: 's' })
    store.finish(record.runId, 'succeeded', 0)
    await store.whenReady()

    const lines = store.exportJsonl(record.runId).split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]!)).toMatchObject({ runId: record.runId, type: 'run/finished' })
  })

  it('不配 dbPath 时保持纯内存，行为与接入前一致', async () => {
    const store = new RunStore(new Context(), {})
    const record = store.start({ flowId: 'f', deviceId: 'd', serial: 's' })
    store.finish(record.runId, 'succeeded', 0)
    await store.whenReady()
    expect(store.get(record.runId)?.status).toBe('succeeded')
    expect(store.exportJsonl(record.runId)).toBe('')
  })
})

describe('EventLog 保留期', () => {
  it('删除超期事件，重复清理幂等', async () => {
    const log = await EventLog.open(dbPath, { retentionDays: 90 })
    const old = Date.now() - 200 * 24 * 3600 * 1000
    log.append('old', old, 'run/started', {})
    log.append('fresh', Date.now(), 'run/started', {})

    expect(log.prune()).toBe(1)
    expect(log.prune()).toBe(0)
    expect(log.loadAll().map((row) => row.runId)).toEqual(['fresh'])
    log.close()
  })
})

describe('redactPayload', () => {
  it('脱敏敏感键，保留非敏感字段与结构', () => {
    const redacted = redactPayload({
      password: 'p@ss',
      nested: { sid: 'SID123', name: '张三' },
      list: [{ apiKey: 'k' }, 'plain'],
    })

    expect(redacted).toEqual({
      password: '[redacted]',
      nested: { sid: '[redacted]', name: '张三' },
      list: [{ apiKey: '[redacted]' }, 'plain'],
    })
  })

  it('大小写与下划线/连字符变体都命中', () => {
    const redacted = redactPayload({ Card_Key: 'x', cardKey: 'y', API_KEY: 'z', proxyPassword: 'w' }) as Record<
      string,
      string
    >
    expect(Object.values(redacted)).toEqual(['[redacted]', '[redacted]', '[redacted]', '[redacted]'])
  })
})
