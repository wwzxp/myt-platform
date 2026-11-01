/**
 * 对齐表的生成与缓存。
 *
 * `keyword-align.ts` 只做纯逻辑（提示词/解析/查表），这里负责：
 * 1. 缺词时调一次模型生成；
 * 2. 合并进缓存；
 * 3. 落盘，下次直接读，不再调模型。
 *
 * 一次生成、长期复用——对齐表是可审查的普通 JSON，不是黑盒。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { buildAlignPrompt, parseAlignTable, type AlignTable } from './keyword-align.ts'

/** 调用模型的接口，便于测试替换（与 `ui-locate.ts` 的 `LocateModel` 一致）。 */
export type AlignModel = (prompt: string) => Promise<string>

/** 读取对齐表；文件不存在或损坏都返回空表（不抛错，避免拖垮流程）。 */
export function loadAlignTable(file: string): AlignTable {
  try {
    if (!existsSync(file)) return {}
    const raw = readFileSync(file, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const table: AlignTable = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && key.trim() && value.trim()) table[key] = value
    }
    return table
  } catch {
    return {}
  }
}

/** 写入对齐表（自动建目录）。 */
export function saveAlignTable(file: string, table: AlignTable): void {
  mkdirSync(dirname(file), { recursive: true })
  const sorted = Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8')
}

/** 对齐表缓存：内存 + 可选落盘。 */
export class AlignCache {
  private table: AlignTable
  private readonly file?: string | undefined

  constructor(options: { file?: string } = {}) {
    this.file = options.file
    this.table = this.file ? loadAlignTable(this.file) : {}
  }

  /** 当前对齐表（只读视图）。 */
  get(): AlignTable {
    return this.table
  }

  /** 已收录多少条。 */
  get size(): number {
    return Object.keys(this.table).length
  }

  /**
   * 补齐缺失的词。
   *
   * 只把**表里没有**的界面词送给模型，已有的一律不再问——
   * 既省调用，也避免同一词被翻译成另一个结果。
   *
   * @param terms - 界面上的词（可能是英文/日文等）
   * @param zhWords - 我们的中文词表（模型只能从这里选）
   * @param model - 模型调用；失败时抛错，由调用方决定是否降级
   * @returns 新增条数
   */
  async ensure(terms: readonly string[], zhWords: readonly string[], model: AlignModel): Promise<number> {
    const known = new Set(Object.keys(this.table))
    const missing = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].filter(
      (t) => !known.has(t.toLowerCase()),
    )
    if (missing.length === 0 || zhWords.length === 0) return 0

    const raw = await model(buildAlignPrompt(missing, zhWords))
    const parsed = parseAlignTable(raw)
    let added = 0
    for (const [key, value] of Object.entries(parsed)) {
      if (this.table[key]) continue
      this.table[key] = value
      added += 1
    }
    if (added > 0 && this.file) saveAlignTable(this.file, this.table)
    return added
  }
}
