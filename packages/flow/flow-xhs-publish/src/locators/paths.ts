import type { UiNode } from '@myt/device'

/**
 * 层级路径工具（**1:1 移植**自 `auto_fb.py` 的 `list(target)[idx]` 走法）。
 *
 * 旧代码的定位方式是「从 root 开始，按索引逐级取子节点」，
 * 路径写死在每个 `get_xxx_position` 里。这里保持完全一致的语义。
 */

export interface Point {
  x: number
  y: number
}

/** 取路径末节点；任一级越界返回 null。 */
export function nodeAtPath(root: UiNode, path: number[]): UiNode | null {
  let current: UiNode = root
  // 旧代码从 root 开始逐级 list(target)[idx]，路径第一位是 root 自身的索引。
  for (const index of path.slice(1)) {
    const child = current.children[index]
    if (!child) return null
    current = child
  }
  return current
}

/** 节点中心点（旧代码 `(x1+x2)//2, (y1+y2)//2`）。 */
export function centerOf(node: UiNode): Point {
  const [x1, y1, x2, y2] = node.bounds
  return { x: Math.floor((x1 + x2) / 2), y: Math.floor((y1 + y2) / 2) }
}

/** 按路径取中心点；越界返回 null。 */
export function pointAtPath(root: UiNode, path: number[]): Point | null {
  const node = nodeAtPath(root, path)
  return node ? centerOf(node) : null
}

/** 按多条路径依次尝试，返回第一个命中的中心点。 */
export function firstPoint(root: UiNode, paths: readonly number[][]): Point | null {
  for (const path of paths) {
    const node = nodeAtPath(root, path)
    if (node) return centerOf(node)
  }
  return null
}

/** 按多条路径依次尝试，返回第一个满足条件的节点。 */
export function firstNode(
  root: UiNode,
  paths: readonly number[][],
  predicate: (node: UiNode) => boolean,
): UiNode | null {
  for (const path of paths) {
    const node = nodeAtPath(root, path)
    if (node && predicate(node)) return node
  }
  return null
}
