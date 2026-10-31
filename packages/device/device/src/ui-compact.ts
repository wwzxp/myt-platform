/**
 * 紧凑 UI 树：把 UiSnapshot 压成 LLM 友好的文本。
 *
 * 实测（`data/yadb-layout.xml`）：27 节点 → 12 个有用节点；
 * `dump-setting.xml`：83 节点 → 36 个。
 * 压缩后单页约 350~1100 token，小模型也能整页放进上下文。
 *
 * 格式设计原则：
 * - 每行一个候选节点，行首 `[序号]`
 * - 只保留 `clickable` / 有文字 / 有 desc 的节点（其余对定位无意义）
 * - 坐标用中心点，LLM 直接输出即可，不用算术
 */

/** 一个候选节点的紧凑表示。 */
export interface CompactNode {
  /** 序号（1 起），LLM 输出它或坐标。 */
  index: number
  className: string
  text: string
  desc: string
  clickable: boolean
  /** 中心坐标。 */
  x: number
  y: number
  /** 原始 bounds [x1,y1,x2,y2]，校验用。 */
  bounds: [number, number, number, number]
}

/** 原始 UI 节点（只取用得到的字段，避免依赖 device 包）。 */
export interface RawUiNode {
  className: string
  text: string
  contentDesc: string
  clickable: boolean
  bounds: [number, number, number, number]
  children?: RawUiNode[]
}

/** 类名精简：`android.widget.Button` → `Button`。 */
function shortClass(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx < 0 ? name : name.slice(idx + 1)
}

/** 节点是否值得给 LLM 看。 */
function isUseful(node: RawUiNode): boolean {
  return node.clickable || node.text.trim().length > 0 || node.contentDesc.trim().length > 0
}

/**
 * 收集候选节点（深度优先，保持视觉顺序）。
 *
 * @param root UI 树根
 * @returns 有用节点列表
 */
export function collectCandidates(root: RawUiNode): RawUiNode[] {
  const out: RawUiNode[] = []
  const walk = (node: RawUiNode): void => {
    if (isUseful(node)) out.push(node)
    for (const child of node.children ?? []) walk(child)
  }
  walk(root)
  return out
}

/**
 * 生成紧凑节点列表。
 *
 * @param root UI 树根
 */
export function compactNodes(root: RawUiNode): CompactNode[] {
  return collectCandidates(root).map((node, i) => {
    const [x1, y1, x2, y2] = node.bounds
    return {
      index: i + 1,
      className: shortClass(node.className),
      text: node.text.trim(),
      desc: node.contentDesc.trim(),
      clickable: node.clickable,
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
      bounds: node.bounds,
    }
  })
}

/** 把一个节点渲染成一行。 */
function renderLine(node: CompactNode): string {
  const parts = [`[${node.index}]`, node.className]
  if (node.text) parts.push(`text="${node.text}"`)
  if (node.desc) parts.push(`desc="${node.desc}"`)
  parts.push(node.clickable ? '可点击' : '不可点')
  parts.push(`中心=(${node.x},${node.y})`)
  return parts.join(' | ')
}

/**
 * 渲染成 LLM 输入文本。
 *
 * @param nodes 紧凑节点
 * @param screen 屏幕尺寸（帮助模型理解相对位置）
 */
export function renderCompact(nodes: CompactNode[], screen: { width: number; height: number }): string {
  const header = `屏幕 ${screen.width}x${screen.height}，共 ${nodes.length} 个候选节点：`
  return [header, ...nodes.map(renderLine)].join('\n')
}

/**
 * 校验 LLM 给出的坐标是否落在某个候选节点内。
 *
 * 这是防止幻觉的硬约束：坐标必须命中真实节点才允许执行。
 *
 * @param nodes 候选节点
 * @param x 横坐标
 * @param y 纵坐标
 * @returns 命中的节点；未命中返回 null
 */
export function hitTest(nodes: CompactNode[], x: number, y: number): CompactNode | null {
  // Android 的事件冒泡：TextView 不可点时会落到其可点的父 Button 上。
  // 因此命中判定分两层：先找可点节点（面积最小），没有再退回任意节点。
  let clickableBest: CompactNode | null = null
  let clickableArea = Infinity
  let anyBest: CompactNode | null = null
  let anyArea = Infinity

  for (const node of nodes) {
    const [x1, y1, x2, y2] = node.bounds
    if (x < x1 || x > x2 || y < y1 || y > y2) continue
    const area = (x2 - x1) * (y2 - y1)
    if (node.clickable && area < clickableArea) {
      clickableArea = area
      clickableBest = node
    }
    if (area < anyArea) {
      anyArea = area
      anyBest = node
    }
  }
  return clickableBest ?? anyBest
}
