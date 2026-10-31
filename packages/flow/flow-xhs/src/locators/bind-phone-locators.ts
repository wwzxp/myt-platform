import type { UiNode } from '@myt/device'
import { nodeAtPath, type Point } from '../locators/paths.ts'

/**
 * 账号与安全页 / 绑定手机号相关定位（**1:1 移植**自 account_bind_phone.py）。
 */

function centerOf(node: UiNode): Point {
  const [x1, y1, x2, y2] = node.bounds
  return { x: Math.floor((x1 + x2) / 2), y: Math.floor((y1 + y2) / 2) }
}

/** 手机号行的标签（account_bind_phone.py:594）。静态查找表用 Record。 */
export const PHONE_LABELS: Record<string, true> = {
  手机号: true,
  手機號: true,
  'Phone number': true,
  Phone: true,
  Mobile: true,
}

/** 标签判定（等价旧实现 `text in _PHONE_LABELS`）。 */
function isPhoneLabel(text: string): boolean {
  return PHONE_LABELS[text] === true
}

/** 手机号行的父节点路径（`_find_phone_value_text` 的 parent_paths）。 */
export const PHONE_ROW_PATHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
]

/**
 * 找手机号行的值文本。
 *
 * 移植自 `_find_phone_value_text`：
 * 1. 先按两条父路径取容器，要求 `children[0].text ∈ PHONE_LABELS`，返回 `children[1].text`；
 * 2. 兜底：全树搜索标签节点（必须是 TextView），返回其**下一个兄弟**的 text。
 *
 * 找到行但值为空 → `''`；未找到 → `null`。
 */
export function findPhoneValueText(root: UiNode): string | null {
  for (const path of PHONE_ROW_PATHS) {
    const parent = nodeAtPath(root, path)
    if (!parent) continue
    const first = parent.children[0]
    const second = parent.children[1]
    if (first && second && isPhoneLabel(first.text)) return second.text.trim()
  }

  // 兜底：全树搜索
  let found: string | null = null
  const visit = (node: UiNode): void => {
    if (found !== null) return
    const children = node.children
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]
      if (!child) continue
      if (isPhoneLabel(child.text) && child.className === 'android.widget.TextView') {
        const next = children[i + 1]
        if (next) {
          found = next.text.trim()
          return
        }
      }
    }
    children.forEach(visit)
  }
  visit(root)
  return found
}

/** 是否为账号与安全页（手机号行存在即成立）。 */
export function isAccountSecurityPage(root: UiNode): boolean {
  return findPhoneValueText(root) !== null
}

/**
 * 手机号是否已绑定：值匹配 `^\+[\d*]+$`（旧实现 646-662）。
 * 未找到行或值为空都算未绑定。
 */
export function isPhoneBound(root: UiNode): boolean {
  const text = findPhoneValueText(root)
  if (text === null) return false
  return /^\+[\d*]+$/.test(text)
}

/** 只有关注可评论的开关状态读取（`get_only_allow_comments_switch_state`）。 */
export const ONLY_COMMENTS_PATHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2],
  [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
]

export interface SwitchState extends Point {
  checked: boolean
}

/** 读「仅关注可评论」开关；未找到返回 null。 */
export function getOnlyAllowCommentsSwitchState(root: UiNode): SwitchState | null {
  for (const path of ONLY_COMMENTS_PATHS) {
    const node = nodeAtPath(root, path)
    if (node) return { ...centerOf(node), checked: node.checked }
  }
  return null
}
