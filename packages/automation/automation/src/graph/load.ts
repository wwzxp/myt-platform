import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PORTS_OF_TYPE,
  type FlowEdge,
  type FlowGraph,
  type FlowNode,
  type NodeType,
  type PortId,
} from './types.ts'

/**
 * 流程图加载与校验。
 *
 * 校验发生在**加载时**而不是执行时：图写错就在启动时报出来，
 * 不要跑到一半才发现某条边指向不存在的节点。
 */

/** 图校验错误（带具体原因，方便定位是哪一行 JSON 写错了）。 */
export class FlowGraphError extends Error {
  /** 出问题的节点 / 边 id（如有）。 */
  readonly subject?: string | undefined

  constructor(message: string, subject?: string) {
    super(message)
    this.name = 'FlowGraphError'
    this.subject = subject
  }
}

/** 读取并校验一个 JSON 图文件。 */
export async function loadFlowGraph(path: string): Promise<FlowGraph> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    throw new FlowGraphError(
      `读取流程图失败：${path}（${error instanceof Error ? error.message : String(error)}）`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new FlowGraphError(
      `流程图不是合法 JSON：${path}（${error instanceof Error ? error.message : String(error)}）`,
    )
  }

  return validateFlowGraph(parsed)
}

/** 从目录加载全部图（文件名即 `<flowId>.json`）。 */
export async function loadFlowGraphs(dir: string, ids: readonly string[]): Promise<FlowGraph[]> {
  return Promise.all(ids.map((id) => loadFlowGraph(join(dir, `${id}.json`))))
}

/** 校验一个已解析的对象是不是合法流程图。 */
export function validateFlowGraph(input: unknown): FlowGraph {
  if (!isObject(input)) throw new FlowGraphError('流程图必须是对象')

  // 画布 JSON 只有 `{nodes, edges}`，没有 id/title——两者都可省略：
  // id 自动生成（前端从不传，硬要求会让 Test Run 直接失败），title 缺省空串。
  const id = typeof input['id'] === 'string' && input['id'] ? input['id'] : 'canvas-flow'
  const title = typeof input['title'] === 'string' ? input['title'] : ''
  // ── 业务配置在 data 扩展位里 ──
  const dataRaw = input['data']
  if (!isObject(dataRaw)) throw new FlowGraphError('流程图缺少 data（业务配置）')
  const maxSteps = num(dataRaw, 'maxSteps')
  const app = validateApp(dataRaw['app'])
  const nodes = validateNodes(input['nodes'])
  const edges = validateEdges(input['edges'])

  // ── 节点 id 唯一 ──
  const byId = new Map<string, FlowNode>()
  for (const node of nodes) {
    if (byId.has(node.id)) throw new FlowGraphError(`节点 id 重复：${node.id}`, node.id)
    byId.set(node.id, node)
  }

  // ── start 只能有一个；entry 省略时自动取它 ──
  const starts = nodes.filter((node) => node.type === 'start')
  if (starts.length !== 1) {
    throw new FlowGraphError(`必须有且只有一个 start 节点，实际 ${starts.length} 个`)
  }
  const entryRaw = input['entry']
  const entry = entryRaw === undefined ? starts[0]!.id : str(input, 'entry')
  if (!byId.has(entry)) throw new FlowGraphError(`entry 指向不存在的节点：${entry}`, entry)
  if (byId.get(entry)?.type !== 'start') {
    throw new FlowGraphError(`entry 必须指向 start 节点，实际指向 ${byId.get(entry)?.type}`, entry)
  }

  // ── end 至少一个 ──
  if (!nodes.some((node) => node.type === 'end')) {
    throw new FlowGraphError('图里没有 end 节点，流程无法正常结束')
  }

  // ── 边的两端存在、端口与源节点类型匹配、同端口不重复 ──
  const seenPorts = new Set<string>()
  for (const edge of edges) {
    if (!byId.has(edge.sourceNodeID)) {
      throw new FlowGraphError(`边指向不存在的源节点：${edge.sourceNodeID}`, edge.sourceNodeID)
    }
    if (!byId.has(edge.targetNodeID)) {
      throw new FlowGraphError(`边指向不存在的目标节点：${edge.targetNodeID}`, edge.targetNodeID)
    }
    const source = byId.get(edge.sourceNodeID)!
    const allowed = PORTS_OF_TYPE[source.type]
    if (!allowed.includes(edge.sourcePortID)) {
      throw new FlowGraphError(
        `${source.type} 节点「${source.id}」没有端口「${edge.sourcePortID}」（可用：${allowed.join('/') || '无'}）`,
        source.id,
      )
    }
    const key = `${edge.sourceNodeID}:${edge.sourcePortID}`
    if (seenPorts.has(key)) {
      throw new FlowGraphError(`端口「${key}」有多条边，执行时无法确定走哪条`, edge.sourceNodeID)
    }
    seenPorts.add(key)
  }

  // ── 除 start 外每个节点至少一条入边；除 end 外每个节点至少一条出边 ──
  const incoming = new Set(edges.map((edge) => edge.targetNodeID))
  const outgoing = new Set(edges.map((edge) => edge.sourceNodeID))
  for (const node of nodes) {
    if (node.type !== 'start' && !incoming.has(node.id)) {
      throw new FlowGraphError(`节点「${node.id}」没有任何入边，永远到不了`, node.id)
    }
    if (node.type !== 'end' && !outgoing.has(node.id)) {
      throw new FlowGraphError(`节点「${node.id}」没有任何出边，走进去就出不来`, node.id)
    }
  }

  // ── 从 entry 出发必须能到达至少一个 end ──
  const reachable = reachableFrom(entry, edges)
  const reachableEnd = nodes.find((node) => node.type === 'end' && reachable.has(node.id))
  if (!reachableEnd) {
    throw new FlowGraphError('从入口出发到不了任何 end 节点，流程无法正常结束')
  }

  return {
    id,
    title,
    nodes,
    edges,
    data: { ...dataRaw, app, maxSteps },
    entry,
  }
}

/** 从某节点出发能到达的节点集合。 */
function reachableFrom(entry: string, edges: readonly FlowEdge[]): Set<string> {
  const visited = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)
    for (const edge of edges) {
      if (edge.sourceNodeID === current && !visited.has(edge.targetNodeID)) {
        queue.push(edge.targetNodeID)
      }
    }
  }
  return visited
}

/** 校验 App 配置。 */
function validateApp(input: unknown): FlowGraph['data']['app'] {
  if (!isObject(input)) throw new FlowGraphError('app 配置缺失')
  const packageName = str(input, 'packageName')
  const homeUri = str(input, 'homeUri')
  const pagesRaw = input['pages']
  if (!Array.isArray(pagesRaw) || pagesRaw.length === 0) {
    throw new FlowGraphError('app.pages 必须是非空数组')
  }
  const pages = pagesRaw.map((item, index) => {
    if (!isObject(item)) throw new FlowGraphError(`app.pages[${index}] 必须是对象`)
    const pageId = str(item, 'id')
    const markers = item['markers']
    if (!Array.isArray(markers) || markers.length === 0) {
      throw new FlowGraphError(`页面「${pageId}」必须至少有一个 marker`)
    }
    return { id: pageId, markers: markers.map((marker) => String(marker)) }
  })
  return {
    packageName,
    homeUri,
    pages,
    recoveryRules: Array.isArray(input['recoveryRules']) ? input['recoveryRules'] : [],
  }
}

/** 校验节点数组（画布格式：`type` + `meta.position` + `data`）。 */
function validateNodes(input: unknown): FlowNode[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new FlowGraphError('nodes 必须是非空数组')
  }
  return input.map((item, index) => {
    if (!isObject(item)) throw new FlowGraphError(`nodes[${index}] 必须是对象`)
    const nodeId = str(item, 'id')
    const typeRaw = str(item, 'type')
    // 白名单从端口表派生：加节点只需改 `PORTS_OF_TYPE`，不会两处不同步。
    const types = Object.keys(PORTS_OF_TYPE) as NodeType[]
    if (!types.includes(typeRaw as NodeType)) {
      throw new FlowGraphError(
        `节点「${nodeId}」的 type 非法：${typeRaw}（可用：${types.join('/')}）`,
        nodeId,
      )
    }
    const meta = item['meta']
    if (!isObject(meta)) {
      throw new FlowGraphError(`节点「${nodeId}」缺少 meta（画布元信息）`, nodeId)
    }
    const position = meta['position']
    if (!isObject(position)) {
      throw new FlowGraphError(`节点「${nodeId}」缺少 meta.position（画布坐标）`, nodeId)
    }
    const data = item['data']
    if (!isObject(data)) {
      throw new FlowGraphError(`节点「${nodeId}」缺少 data（业务数据）`, nodeId)
    }
    return {
      id: nodeId,
      type: typeRaw as NodeType,
      meta: { position: { x: num(position, 'x'), y: num(position, 'y') } },
      data,
    }
  })
}

/** 校验边数组（画布格式：`sourceNodeID` + `sourcePortID` + `targetNodeID`）。 */
function validateEdges(input: unknown): FlowEdge[] {
  if (!Array.isArray(input)) throw new FlowGraphError('edges 必须是数组')
  return input.map((item, index) => {
    if (!isObject(item)) throw new FlowGraphError(`edges[${index}] 必须是对象`)
    const sourcePortID = str(item, 'sourcePortID') as PortId
    const targetPortID = item['targetPortID']
    return {
      sourceNodeID: str(item, 'sourceNodeID'),
      sourcePortID,
      targetNodeID: str(item, 'targetNodeID'),
      ...(targetPortID === undefined ? {} : { targetPortID: String(targetPortID) }),
    }
  })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new FlowGraphError(`字段「${key}」必须是非空字符串`)
  }
  return value
}

function num(input: Record<string, unknown>, key: string): number {
  const value = Number(input[key])
  if (!Number.isFinite(value)) throw new FlowGraphError(`字段「${key}」必须是数字`)
  return value
}
