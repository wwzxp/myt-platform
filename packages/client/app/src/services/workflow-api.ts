/**
 * 流程图 API 客户端。
 *
 * 前端与内核的数据接口。所有调用都指向内核（默认 `127.0.0.1:7788`），
 * 路径与 `@myt/workflows` 的 `WorkflowApi` 一一对应。
 */

/** 内核地址（可用 `MYT_KERNEL_BASE` 覆盖，便于开发时指向其它端口）。 */
const KERNEL_BASE: string =
  (import.meta as unknown as { env?: Record<string, string> }).env?.['VITE_KERNEL_BASE'] ??
  'http://127.0.0.1:7788'

/** 流程摘要（列表页用）。 */
export interface WorkflowSummary {
  id: string
  name: string
  fileName: string
  nodeCount: number
  updatedAt: number
}

/** 画布文档（与 flowgram 的 `FlowDocumentJSON` 对齐）。 */
export type WorkflowDocument = Record<string, unknown>

/** 统一的请求封装：非 2xx 抛出带服务端消息的错误。 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${KERNEL_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  })
  if (!response.ok) {
    // 内核的错误体统一是 `{ error: string }`
    let message = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      /* 非 JSON 响应，保留状态码 */
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

/** 列出全部流程（按修改时间倒序）。 */
export async function listWorkflows(): Promise<WorkflowSummary[]> {
  return request<WorkflowSummary[]>('/api/workflows')
}

/** 新建空白流程。 */
export async function createWorkflow(name: string): Promise<{ fileName: string; id: string }> {
  return request('/api/workflows', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

/** 读一个流程的完整画布 JSON。 */
export async function loadWorkflow(fileName: string): Promise<WorkflowDocument> {
  return request(`/api/workflows/${encodeURIComponent(fileName)}`)
}

/** 保存画布（body 即完整画布 JSON）。 */
export async function saveWorkflow(
  fileName: string,
  doc: WorkflowDocument,
): Promise<{ fileName: string }> {
  return request(`/api/workflows/${encodeURIComponent(fileName)}`, {
    method: 'PUT',
    body: JSON.stringify(doc),
  })
}

/** 删除流程。 */
export async function deleteWorkflow(fileName: string): Promise<{ removed: boolean }> {
  return request(`/api/workflows/${encodeURIComponent(fileName)}`, { method: 'DELETE' })
}

/** 重命名（已存在的名字会自动加序号）。 */
export async function renameWorkflow(fileName: string, name: string): Promise<{ fileName: string }> {
  return request('/api/workflows/rename', {
    method: 'POST',
    body: JSON.stringify({ fileName, name }),
  })
}

/** 复制流程（换新 id）。 */
export async function duplicateWorkflow(fileName: string): Promise<{ fileName: string }> {
  return request('/api/workflows/duplicate', {
    method: 'POST',
    body: JSON.stringify({ fileName }),
  })
}

/** 数据目录信息（用于「数据在 C 盘」的提示）。 */
export async function getDataDir(): Promise<{ dir: string; onSystemDrive: boolean }> {
  return request('/api/data-dir')
}
