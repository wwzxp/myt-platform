import type { UiNode } from '@myt/device'
import { nodeAtPath, type BoundedPoint, type Point } from '../locators/paths.ts'

/**
 * 弹窗与次要控件定位（**1:1 移植**自 auto_login.py）。
 *
 * 这些路径来自旧项目在真机上的长期验证（注释里带版本日期），
 * 顺序、`clickable`/`class` 判定必须原样保留。
 */

function centerOf(node: UiNode): Point {
  const [x1, y1, x2, y2] = node.bounds
  return { x: Math.floor((x1 + x2) / 2), y: Math.floor((y1 + y2) / 2) }
}

/** 逐个路径尝试；末节点可点击即命中。 */
function firstClickable(root: UiNode, paths: number[][]): UiNode | null {
  for (const path of paths) {
    const node = nodeAtPath(root, path)
    if (node && node.clickable) return node
  }
  return null
}

// ── 路径数组（与 auto_login.py 一致） ──

/** 生日页 Next（2 条）。 */
export const BIRTHDAY_NEXT_PATHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4],
]

/** 兴趣页 Skip（2 条）。 */
export const SKIP_PATHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
]

/** 风险插件 Got it（2 条）。 */
export const RISK_PLUGIN_PATHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 5],
]

/** 语言提示 See original（1 条）。 */
export const SEE_ORIGINAL_PATHS: number[][] = [[0, 0, 0, 0, 0, 0, 2, 0]]

/** 自动翻译 Later（1 条）。 */
export const LATER_PATHS: number[][] = [[0, 0, 0, 0, 0, 0, 3, 1]]

/** 网络异常「不了」（需读出 body 才能确认路径，此处按旧实现的调用点占位）。 */

export function getBirthdayNextButtonPosition(root: UiNode): Point | null {
  const node = firstClickable(root, BIRTHDAY_NEXT_PATHS)
  return node ? centerOf(node) : null
}

export function getSkipButtonPosition(root: UiNode): Point | null {
  const node = firstClickable(root, SKIP_PATHS)
  return node ? centerOf(node) : null
}

export function getRiskPluginGotItButtonPosition(root: UiNode): Point | null {
  const node = firstClickable(root, RISK_PLUGIN_PATHS)
  return node ? centerOf(node) : null
}

export function getSeeOriginalButtonPosition(root: UiNode): Point | null {
  const node = firstClickable(root, SEE_ORIGINAL_PATHS)
  return node ? centerOf(node) : null
}

export function getLaterButtonPosition(root: UiNode): Point | null {
  const node = firstClickable(root, LATER_PATHS)
  return node ? centerOf(node) : null
}

export type { BoundedPoint, Point }
