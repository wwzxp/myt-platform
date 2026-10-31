import { createContext, useContext } from 'react'

/**
 * 当前编辑的流程。
 *
 * 画布组件树很深（`Editor` → `FreeLayoutEditorProvider` → 各插件），
 * 用 context 传「正在编辑哪个流程」比逐层透传 props 干净。
 */
export interface WorkflowContextValue {
  /** 当前流程的文件名（含 `.json`）。保存时用它作路径。 */
  fileName: string
  /** 用户可见的名字（去掉 `.json`）。 */
  name: string
  /** 保存状态，供 UI 显示「保存中…」/「已保存」。 */
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  /** 最近一次保存的错误消息。 */
  saveError?: string
  /** 手动触发保存（工具栏按钮用）。 */
  save: () => Promise<void>
}

export const WorkflowContext = createContext<WorkflowContextValue | null>(null)

/**
 * 读取当前流程上下文。
 *
 * 返回 `null` 只可能发生在编辑器之外（例如组件被单独渲染）；
 * 编辑器内部的组件可以直接使用返回值。
 */
export function useWorkflowContext(): WorkflowContextValue | null {
  return useContext(WorkflowContext)
}
