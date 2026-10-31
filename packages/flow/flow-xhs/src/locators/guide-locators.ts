import type { UiNode } from '@myt/device'
import { nodeAtPath, type Point } from '../locators/paths.ts'

/**
 * 登录引导阶段的定位函数（**1:1 移植**自 auto_login.py）。
 *
 * 覆盖：生日三列、QQ 登录、东鹏/蓝旗上号器、网络异常、服务器出错。
 */

function centerOf(node: UiNode): Point {
  const [x1, y1, x2, y2] = node.bounds
  return { x: Math.floor((x1 + x2) / 2), y: Math.floor((y1 + y2) / 2) }
}

/** 带 bounds 与 text 的命中（生日滚轮列需要 bounds 计算滑动起点）。 */
export interface PickerColumn {
  x: number
  y: number
  text: string
  bounds: [number, number, number, number]
}

/** 移植自 `_get_picker_column_position`：取末节点，text 缺失时向下找第一个非空文本。 */
function getPickerColumnPosition(root: UiNode, path: number[]): PickerColumn | null {
  const node = nodeAtPath(root, path)
  if (!node) return null
  let text = node.text
  if (!text) {
    for (const child of node.children) {
      const childText = child.text.trim()
      if (childText) {
        text = childText
        break
      }
    }
  }
  return { ...centerOf(node), text, bounds: node.bounds }
}

/** 生日：左列年份（2 条路径）。 */
export const BIRTH_YEAR_PATHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0],
]

/** 生日：中列月份（2 条路径）。 */
export const BIRTH_MONTH_PATHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1],
]

/** 生日：右列日（2 条路径）。 */
export const BIRTH_DAY_PATHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 2],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 2],
]

/** QQ 登录按钮（4 条路径，且要求文案/资源含 QQ）。 */
export const QQ_LOGIN_PATHS: number[][] = [
  [0, 0, 0, 0, 2, 0],
  [0, 0, 0, 0, 0, 0, 2, 1],
  [0, 0, 0, 0, 0, 0, 2, 0],
  [0, 0, 0, 0, 2, 1],
]

/** 东鹏上号器输入框（1 条）。 */
export const DONGPENG_INPUT_PATH: number[] = [0, 0, 0, 0, 0, 0]
/** 东鹏上号器「我授权」按钮（1 条）。 */
export const DONGPENG_BUTTON_PATH: number[] = [0, 0, 0, 0, 0, 1]
/** 蓝旗一键授权输入框（1 条）。 */
export const CARD_PASSWORD_INPUT_PATH: number[] = [0, 0, 1, 0, 1, 1]
/** 蓝旗一键授权按钮（1 条）。 */
export const ONE_CLICK_AUTH_BUTTON_PATH: number[] = [0, 0, 1, 0, 1, 2]

/** 网络异常「不了」（2 条，需 TextView 且可点击）。 */
export const NETWORK_ERROR_PATHS: number[][] = [
  [0, 0, 0, 0, 2, 0, 0],
  [0, 0, 0, 0, 0, 2, 0, 0],
]

/** 服务器出错「刷新试试」（3 条）。 */
export const SERVER_ERROR_PATHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 3, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4],
]

export function getBirthYearPosition(root: UiNode): PickerColumn | null {
  for (const path of BIRTH_YEAR_PATHS) {
    const result = getPickerColumnPosition(root, path)
    if (result) return result
  }
  return null
}

export function getBirthMonthPosition(root: UiNode): PickerColumn | null {
  for (const path of BIRTH_MONTH_PATHS) {
    const result = getPickerColumnPosition(root, path)
    if (result) return result
  }
  return null
}

export function getBirthDayPosition(root: UiNode): PickerColumn | null {
  for (const path of BIRTH_DAY_PATHS) {
    const result = getPickerColumnPosition(root, path)
    if (result) return result
  }
  return null
}

/**
 * QQ 登录按钮：除 `clickable` 外还要求文案或 resource-id 命中 QQ。
 * 移植自 `get_qq_login_button_position`（新增：无 bounds 时跳过而非抛错）。
 */
export function getQqLoginButtonPosition(root: UiNode): Point | null {
  for (const path of QQ_LOGIN_PATHS) {
    const node = nodeAtPath(root, path)
    if (!node || !node.clickable) continue
    const combined = `${node.text} ${node.contentDesc}`
    const isQq = /QQ|qq/.test(combined) || node.resourceId.includes('g0p')
    if (!isQq) continue
    return centerOf(node)
  }
  return null
}

/** 东鹏上号器输入框：`EditText` 或可点击即可（旧实现如此宽松）。 */
export function getDongpengInputPosition(root: UiNode): Point | null {
  const node = nodeAtPath(root, DONGPENG_INPUT_PATH)
  if (!node) return null
  if (node.className.includes('EditText') || node.clickable) return centerOf(node)
  return null
}

export function getDongpengButtonPosition(root: UiNode): Point | null {
  const node = nodeAtPath(root, DONGPENG_BUTTON_PATH)
  return node?.clickable ? centerOf(node) : null
}

/** 蓝旗一键授权输入框（V 跳登录用）。 */
export function getCardPasswordInputPosition(root: UiNode): Point | null {
  const node = nodeAtPath(root, CARD_PASSWORD_INPUT_PATH)
  if (!node) return null
  if (node.className.includes('EditText') || node.clickable) return centerOf(node)
  return null
}

export function getOneClickAuthorizationButtonPosition(root: UiNode): Point | null {
  const node = nodeAtPath(root, ONE_CLICK_AUTH_BUTTON_PATH)
  return node?.clickable ? centerOf(node) : null
}

/** 网络异常「不了」：只认 TextView 且可点击。 */
export function getNetworkErrorCancelButtonPosition(root: UiNode): Point | null {
  for (const path of NETWORK_ERROR_PATHS) {
    const node = nodeAtPath(root, path)
    if (node && node.className === 'android.widget.TextView' && node.clickable) {
      return centerOf(node)
    }
  }
  return null
}

/**
 * 服务器出错「刷新试试」。
 *
 * 旧实现（`auto_login.py:2071-2108`）**不检查 clickable**：能解析出 bounds 就返回。
 */
export function getServerErrorRefreshButtonPosition(root: UiNode): Point | null {
  for (const path of SERVER_ERROR_PATHS) {
    const node = nodeAtPath(root, path)
    if (node) return centerOf(node)
  }
  return null
}

/**
 * 安全验证页的「验证」按钮（3 条路径 + 文字兜底）。
 *
 * 移植自 `get_safety_verification_verify_button_info`：
 * - 命中 class 限定 Button / View / TextView；
 * - 文本为空时取第一个 TextView 子节点的文本；
 * - 全部路径失败后按关键词全文检索（中英繁体）。
 */
export const SAFETY_VERIFY_BUTTON_PATHS: number[][] = [
  [...Array<number>(22).fill(0), 1, 4, 0],
  [...Array<number>(22).fill(0), 1, 0, 0, 0, 0, 0, 0, 4],
  [...Array<number>(22).fill(0), 1, 0, 0, 0, 0, 0, 4],
]

const VERIFY_KEYWORDS = [
  '验证',
  '确认',
  '提交',
  '确定',
  '驗證',
  '確認',
  '送出',
  '確定',
  'Verify',
  'verify',
  'Confirm',
  'confirm',
  'Submit',
  'submit',
  'OK',
  'Continue',
]

export interface VerifyButtonInfo extends Point {
  clickable: boolean
  text: string
}

export function getSafetyVerificationVerifyButtonInfo(root: UiNode): VerifyButtonInfo | null {
  for (const path of SAFETY_VERIFY_BUTTON_PATHS) {
    const node = nodeAtPath(root, path)
    if (!node) continue
    const allowed = ['android.widget.Button', 'android.view.View', 'android.widget.TextView']
    if (!allowed.includes(node.className)) continue
    let text = node.text
    if (!text) {
      const first = node.children[0]
      if (first && first.className === 'android.widget.TextView') text = first.text
    }
    return { ...centerOf(node), clickable: node.enabled && node.clickable, text }
  }

  // 文字兜底
  let found: VerifyButtonInfo | null = null
  const visit = (node: UiNode): void => {
    if (found) return
    const text = node.text || node.contentDesc
    if (text && VERIFY_KEYWORDS.some((keyword) => text.includes(keyword)) && node.clickable) {
      found = { ...centerOf(node), clickable: node.enabled, text }
      return
    }
    node.children.forEach(visit)
  }
  visit(root)
  return found
}
