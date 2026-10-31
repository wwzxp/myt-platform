import type { UiNode } from '@myt/device'
import { nodeAtPath, type Point } from '../locators/paths.ts'

/**
 * 关注相关定位（**1:1 移植**自 auto_follow.py）。
 *
 * 关注/已关注按钮共用路径数组，区别在于命中节点的 `text` 是否为「已关注」。
 */

function centerOf(node: UiNode): Point {
  const [x1, y1, x2, y2] = node.bounds
  return { x: Math.floor((x1 + x2) / 2), y: Math.floor((y1 + y2) / 2) }
}

/** 「用户」标签页（2 条）。 */
export const USERS_TAB_PATHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1],
  [0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 0, 0, 1, 0],
]

/** 关注 / 已关注按钮（5 条，两函数共用）。 */
export const FOLLOW_BUTTON_PATHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 2, 0, 0, 0, 2],
  [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 2, 0, 0, 2],
  [0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 2],
  [0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 2],
  [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0],
]

/** 「关注」按钮的精确文本（auto_follow.py:219）。静态表用 Record。 */
const FOLLOW_TEXTS: Record<string, true> = { 关注: true, Follow: true, 關注: true }

/** 「已关注」按钮的精确文本（auto_follow.py:313）。 */
const FOLLOWING_TEXTS: Record<string, true> = { Following: true, 已关注: true, 已關注: true }

/**
 * 按路径找文本命中的节点。
 *
 * 旧实现是**精确匹配**（`text not in (...)` 即跳过），不是子串判断——
 * 用 includes 会把「已关注」误判成「关注」。
 */
function findByTexts(root: UiNode, texts: Record<string, true>): UiNode | null {
  for (const path of FOLLOW_BUTTON_PATHS) {
    const node = nodeAtPath(root, path)
    if (!node) continue
    if (texts[node.text.trim()] === true) return node
  }
  return null
}

/** 未关注状态下的「关注」按钮。 */
export function getFollowButtonPosition(root: UiNode): Point | null {
  const node = findByTexts(root, FOLLOW_TEXTS)
  return node ? centerOf(node) : null
}

/** 已关注状态按钮（用于判定是否已关注）。 */
export function getFollowingButtonPosition(root: UiNode): Point | null {
  const node = findByTexts(root, FOLLOWING_TEXTS)
  return node ? centerOf(node) : null
}

export function getUsersTabPosition(root: UiNode): Point | null {
  for (const path of USERS_TAB_PATHS) {
    const node = nodeAtPath(root, path)
    if (node && node.clickable) return centerOf(node)
  }
  return null
}
