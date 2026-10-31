/**
 * 把旧模板的裸字段迁到 `inputsValues`（画布节点新形状）。
 *
 * 为什么需要：`data.locate` / `data.act` / `data.judge` / `data.loopFor` 这种
 * 裸字段无法引用上游节点输出、无法插值，也分不清「这段文字是字面量还是参数名」。
 * 新形状统一为 `inputsValues`（常量 / 引用 / 模板三选一），与画布其它节点同构。
 *
 * 用法：
 *   node --experimental-strip-types scripts/migrate-workflow-nodes.ts --dry-run
 *   node --experimental-strip-types scripts/migrate-workflow-nodes.ts
 *
 * 幂等：已含 `inputsValues` 的节点跳过；重复运行结果不变。
 * 备份：首次迁移前把原文件复制到 `data/workflows/.backup/<时间戳>/`。
 */

import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** 画布节点（只描述本脚本关心的字段）。 */
interface CanvasNode {
  id: string
  type: string
  data: Record<string, unknown>
  blocks?: CanvasNode[]
}

/** 迁移统计。 */
interface Stats {
  /** 改了 data 的节点数。 */
  migrated: number
  /** 本来就是新形状、跳过的节点数。 */
  skipped: number
  /** 改了 data 的文件数。 */
  files: number
}

const WORKFLOW_DIR = join(process.cwd(), 'data', 'workflows')

/**
 * 迁移入口。
 *
 * @param dryRun - 只统计不落盘。
 */
async function main(dryRun: boolean): Promise<void> {
  const entries = await readdir(WORKFLOW_DIR, { withFileTypes: true })
  const files = entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name)
  if (files.length === 0) {
    console.log('没有找到模板文件')
    return
  }

  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  const backupDir = join(WORKFLOW_DIR, '.backup', stamp)
  const total: Stats = { migrated: 0, skipped: 0, files: 0 }

  for (const file of files) {
    const path = join(WORKFLOW_DIR, file)
    const raw = await readFile(path, 'utf8')
    const doc = JSON.parse(raw) as Record<string, unknown>
    const nodes = Array.isArray(doc['nodes']) ? (doc['nodes'] as CanvasNode[]) : []

    const stats: Stats = { migrated: 0, skipped: 0, files: 0 }
    walk(nodes, stats)

    if (stats.migrated === 0) {
      console.log(`${basename(file).padEnd(24)} 无需迁移（${stats.skipped} 个节点已是新形状）`)
      continue
    }

    total.migrated += stats.migrated
    total.skipped += stats.skipped
    total.files += 1

    console.log(`${basename(file).padEnd(24)} 迁移 ${stats.migrated} 个节点`)
    if (dryRun) continue

    await mkdir(backupDir, { recursive: true })
    await copyFile(path, join(backupDir, file))
    await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  }

  const verb = dryRun ? '（干跑，未落盘）' : ''
  console.log(`\n合计：${total.files} 个文件、${total.migrated} 个节点已迁移，${total.skipped} 个跳过 ${verb}`)
  if (!dryRun && total.migrated > 0) console.log(`备份目录：${backupDir}`)
}

/**
 * 递归迁移节点（容器节点带 `blocks`）。
 *
 * @param nodes - 节点数组，就地修改。
 * @param stats - 统计累加器。
 */
function walk(nodes: CanvasNode[], stats: Stats): void {
  for (const node of nodes) {
    if (node.type === 'mt-action' || node.type === 'mt-condition' || node.type === 'mt-loop') {
      if (node.data['inputsValues']) {
        stats.skipped += 1
      } else {
        node.data = migrateNode(node.type, node.data)
        stats.migrated += 1
      }
    }
    if (node.blocks) walk(node.blocks, stats)
  }
}

/**
 * 把一个节点的旧裸字段转成 `inputsValues`。
 *
 * 只搬运「执行时真会读的字段」；`title` 留在 `data` 顶层（它是展示名，
 * 不是执行输入）。
 *
 * @param type - 节点类型。
 * @param data - 旧形状的 data。
 * @returns 新形状的 data。
 */
function migrateNode(type: string, data: Record<string, unknown>): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const put = (key: string, content: unknown): void => {
    if (content === undefined || content === null || content === '') return
    values[key] = { type: 'constant', content }
  }

  if (type === 'mt-action') {
    const locate = data['locate'] as Record<string, unknown> | undefined
    if (locate) {
      // 旧模板只有意图定位；没有坐标字段。
      put('locate.mode', 'intent')
      put('locate.intent', locate['intent'])
      put('locate.fallback', locate['fallback'])
      put('locate.vision', locate['vision'])
      put('locate.strict', locate['strict'])
    }
    const act = data['act'] as Record<string, unknown> | undefined
    if (act) {
      put('act.kind', act['kind'])
      put('act.name', act['name'])
      put('act.uri', act['uri'])
      put('act.text', act['text'])
      put('act.inputLocator', act['inputLocator'])
      put('act.match', act['match'])
      if (Array.isArray(act['extras']) && act['extras'].length > 0) {
        put('act.extras', (act['extras'] as string[]).join(','))
      }
      put('act.min', act['min'])
      put('act.max', act['max'])
      put('act.durationMs', act['durationMs'])
      const from = act['from'] as { x?: number; y?: number } | undefined
      if (from) {
        put('act.from.x', from.x)
        put('act.from.y', from.y)
      }
      const to = act['to'] as { x?: number; y?: number } | undefined
      if (to) {
        put('act.to.x', to.x)
        put('act.to.y', to.y)
      }
    }
    const requires = data['requires']
    if (Array.isArray(requires) && requires.length > 0) put('requires', (requires as string[]).join(','))
    const settle = data['settle']
    if (Array.isArray(settle) && settle.length === 2) put('settle', (settle as number[]).join(','))
    if (data['verify']) values['verify'] = { type: 'constant', content: data['verify'] }
  }

  if (type === 'mt-condition') {
    // 旧模板的条件字段是扁平的：`data.kind` / `data.key` / `data.expect` / `data.locate`。
    put('judge.kind', data['kind'])
    put('judge.key', data['key'])
    const expect = data['expect']
    if (Array.isArray(expect) && expect.length > 0) put('judge.expect', (expect as string[]).join(','))
    const locate = data['locate'] as Record<string, unknown> | undefined
    if (locate) {
      put('judge.locate.intent', locate['intent'])
      put('judge.locate.fallback', locate['fallback'])
      put('judge.locate.vision', locate['vision'])
      put('judge.locate.strict', locate['strict'])
    }
  }

  if (type === 'mt-loop') {
    const loopFor = data['loopFor'] as Record<string, unknown> | undefined
    if (loopFor) {
      put('loopFor.max', loopFor['max'])
      const gap = loopFor['gap']
      if (Array.isArray(gap) && gap.length === 2) put('loopFor.gap', gap[0])
      else put('loopFor.gap', gap)
    }
  }

  // `inputs` / `outputs` 声明由画布在渲染时补齐；这里留空，避免写死声明。
  return {
    ...(data['title'] !== undefined ? { title: data['title'] } : {}),
    inputsValues: values,
  }
}

const dryRun = process.argv.includes('--dry-run')
await main(dryRun)
