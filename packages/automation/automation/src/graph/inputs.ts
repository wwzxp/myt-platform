/**
 * 节点输入求值。
 *
 * 画布存的是**值的来源**（常量 / 引用 / 模板），执行前统一求值成本次运行的
 * 实际值。这一层是边界：外面是可能出错的外部数据，里面拿到的就是确定的字符串。
 *
 * 为什么要有这一层：
 * 旧实现用 `resolveText` 做 `ctx.flowParams[key]` 查表——分不清「这段文字是
 * 字面量还是参数名」，也引用不到上游节点的输出。显式区分来源后，歧义消失。
 */

import type { FlowValue } from './types.ts'

/** 求值所需的运行时上下文。 */
export interface InputScope {
  /** 流程入参（启动时传进来的键值）。 */
  params: Readonly<Record<string, string>>
  /** 已执行节点的产出：节点 id → 该节点的 outputs。 */
  outputs: ReadonlyMap<string, Record<string, unknown>>
}

/**
 * 把一批输入值求成实际值。
 *
 * 求值失败的项保持为 `undefined`——由调用方决定是报错还是回落到默认行为。
 * 这里不抛错，因为一个可选字段缺失不该让整条流程失败。
 *
 * @param values - 画布上存的输入值表；缺省返回空对象。
 * @param scope - 运行时上下文。
 * @returns 键到实际值的映射（键保持画布上写的原样，如 `act.kind`）。
 */
export function parseNodeInputs(
  values: Readonly<Record<string, FlowValue>> | undefined,
  scope: InputScope,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values ?? {})) {
    const resolved = resolve(value, scope)
    if (resolved !== undefined) out[key] = resolved
  }
  return out
}

/**
 * 求一个值。
 *
 * @param value - 画布上存的值。
 * @param scope - 运行时上下文。
 */
function resolve(value: FlowValue, scope: InputScope): unknown {
  switch (value.type) {
    case 'constant':
      return value.content
    case 'ref': {
      const [nodeId, ...rest] = value.content
      if (!nodeId) return undefined
      const outputs = scope.outputs.get(nodeId)
      if (!outputs) return undefined
      let current: unknown = outputs
      for (const key of rest) {
        if (current === null || typeof current !== 'object') return undefined
        current = (current as Record<string, unknown>)[key]
      }
      return current
    }
    case 'template':
      return interpolate(value.content, scope)
    default:
      return undefined
  }
}

/**
 * 模板插值：`{{key}}` 优先查上游输出，其次查流程参数。
 *
 * 支持 `{{nodeId.field}}` 形式引用输出；未知的占位符原样保留，
 * 让用户能在运行结果里看到「哪里没填上」。
 *
 * @param text - 含占位符的文本。
 * @param scope - 运行时上下文。
 */
function interpolate(text: string, scope: InputScope): string {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/gu, (whole, path: string) => {
    const parts = path.split('.')
    // 先试上游输出（第一段是节点 id）。
    const [first, ...rest] = parts
    if (first) {
      const outputs = scope.outputs.get(first)
      if (outputs) {
        let current: unknown = outputs
        for (const key of rest) {
          if (current === null || typeof current !== 'object') return whole
          current = (current as Record<string, unknown>)[key]
        }
        if (current !== undefined && current !== null) return String(current)
      }
      // 再试流程参数。
      const param = scope.params[path]
      if (param !== undefined) return param
    }
    return whole
  })
}

/**
 * 取字符串输入。
 *
 * @param inputs - 已求值的输入表。
 * @param key - 键名（如 `act.kind`）。
 * @param fallback - 缺失时的回落值。
 */
export function strInput(
  inputs: Readonly<Record<string, unknown>>,
  key: string,
  fallback = '',
): string {
  const value = inputs[key]
  if (value === undefined || value === null) return fallback
  return String(value)
}

/**
 * 取数值输入。
 *
 * @param inputs - 已求值的输入表。
 * @param key - 键名。
 * @param fallback - 缺失或非有限数时的回落值。
 */
export function numInput(
  inputs: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
): number {
  const value = Number(inputs[key])
  return Number.isFinite(value) ? value : fallback
}

/**
 * 取布尔输入。
 *
 * @param inputs - 已求值的输入表。
 * @param key - 键名。
 * @param fallback - 缺失时的回落值。
 */
export function boolInput(
  inputs: Readonly<Record<string, unknown>>,
  key: string,
  fallback: boolean,
): boolean {
  const value = inputs[key]
  if (value === undefined || value === null) return fallback
  if (typeof value === 'boolean') return value
  return String(value) === 'true'
}

/**
 * 取逗号分隔的列表输入。
 *
 * @param inputs - 已求值的输入表。
 * @param key - 键名。
 */
export function listInput(inputs: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = inputs[key]
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (value === undefined || value === null) return []
  return String(value)
    .split(/[,，\n]/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}
