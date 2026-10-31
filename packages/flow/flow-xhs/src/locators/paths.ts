import type { UiNode } from '@myt/device'

export interface Point {
  x: number
  y: number
}

/** 带边界的命中结果（区号列表等需要约束点击范围）。 */
export interface BoundedPoint extends Point {
  bounds: [number, number, number, number]
  text: string
}

/** 取路径末节点；任一级越界返回 null。 */
export function nodeAtPath(root: UiNode, path: number[]): UiNode | null {
  let current: UiNode = root
  // root 自身是第一级，所以从第 1 位开始走子节点。
  for (const index of path.slice(1)) {
    const child = current.children[index]
    if (!child) return null
    current = child
  }
  return current
}





