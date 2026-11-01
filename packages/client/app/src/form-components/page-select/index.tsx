/**
 * 页面多选下拉：选项来自流程的**页面表**（`globalVariable.app.default.pages`）。
 *
 * 抽成公共组件是因为条件节点和动作节点都要用它——
 * 两处各写一份的话，选项格式（「中文名（id）」）和理解迟早会不一致。
 *
 * 页面表改了要立刻反映到选项上：节点不订阅全局变量就不会重渲染，
 * 所以这里主动订 `onListOrAnyVarChange`。
 */
import { useEffect, useState } from 'react'

import { GlobalScope, useService } from '@flowgram.ai/free-layout-editor'
import { Select } from '@douyinfe/semi-ui'

import { GetGlobalVariableSchema } from '../../plugins/variable-panel-plugin'

/** 页面表里的一行（只关心选择需要的两个字段）。 */
interface PageRow {
  id: string
  title?: string
}

/** 读当前流程的页面表。 */
function usePages(): PageRow[] {
  const getSchema = useService(GetGlobalVariableSchema) as () => unknown
  const globalScope = useService(GlobalScope)
  const [, bump] = useState(0)

  useEffect(() => {
    const disposable = globalScope.output.onListOrAnyVarChange(() => bump((n) => n + 1))
    return () => disposable.dispose()
  }, [globalScope])

  const schema = getSchema() as
    | { properties?: Record<string, { default?: { pages?: Array<{ id?: string; title?: string }> } }> }
    | undefined
  return (schema?.properties?.['app']?.default?.pages ?? []).filter(
    (page): page is PageRow => typeof page?.id === 'string' && page.id.trim() !== '',
  )
}

export interface PageSelectProps {
  /** 逗号分隔的页面 id（与节点存储格式一致）。 */
  value?: string | undefined
  onChange: (next: string) => void
  placeholder?: string
  /** 空页面表时的提示。 */
  emptyContent?: string
}

/** 多选版本：存成逗号分隔字符串。 */
export function PageMultiSelect({ value, onChange, placeholder, emptyContent }: PageSelectProps) {
  const pages = usePages()
  const selected = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  return (
    <Select
      multiple
      value={selected}
      onChange={(v) => onChange((v as string[]).join(','))}
      optionList={pages.map((page) => ({
        value: page.id,
        label: page.title ? `${page.title}（${page.id}）` : page.id,
      }))}
      placeholder={placeholder ?? (pages.length ? '选择一个或多个页面' : '页面表是空的')}
      emptyContent={emptyContent ?? '页面表是空的，先到「变量面板 → 页面表」里加'}
      style={{ width: '100%' }}
    />
  )
}

/** 单选的悬浮提示：列出可选值，避免用户猜。 */
export function usePagesHint(): string {
  const pages = usePages()
  return pages.length
    ? `可填：${pages.map((p) => (p.title ? `${p.title} ${p.id}` : p.id)).join('、')}`
    : '还没有页面表；先到「变量面板 → 页面表」里加一条'
}
