import type { UiNode } from '@myt/device'
import { nodeAtPath, type Point } from '../locators/paths.ts'

/**
 * 改资料（头像 / 昵称）相关定位（**1:1 移植**自 auto_modify_info.py）。
 */

function centerOf(node: UiNode): Point {
  const [x1, y1, x2, y2] = node.bounds
  return { x: Math.floor((x1 + x2) / 2), y: Math.floor((y1 + y2) / 2) }
}

/** 个人主页名称（3 条）。 */
export const PROFILE_NAME_PATHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 2],
]

/** 编辑页头像（2 条）。 */
export const AVATAR_PATHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
]

/** 编辑资料名称（2 条）。 */
export const EDIT_NAME_PATHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0],
]

/** 上传新头像按钮（1 条）。 */
export const UPLOAD_AVATAR_PATHS: number[][] = [[0, 0, 0, 0, 0, 0, 0, 0, 1, 0]]

/** 修改名称输入框（2 条）。 */
export const EDIT_NAME_INPUT_PATHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 2, 0],
]

/** 修改名称保存按钮（2 条）。 */
export const SAVE_BUTTON_PATHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2],
  [0, 0, 0, 0, 0, 0, 0, 0, 2],
]

/** 图库页 RecyclerView（1 条，用于枚举图片）。 */
export const GALLERY_LIST_PATHS: number[][] = [[0, 0, 0, 0, 0, 0, 0, 0, 0, 2]]

/** 图片选择的「保存/完成」按钮（1 条）。 */
export const IMAGE_SAVE_PATHS: number[][] = [[0, 0, 0, 0, 0, 0, 0, 1, 1]]

/** 加载转圈（`get_loading_spinner_position`，单条路径 + 尺寸判据）。 */
export const LOADING_SPINNER_PATHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
]

function firstClickable(root: UiNode, paths: number[][]): UiNode | null {
  for (const path of paths) {
    const node = nodeAtPath(root, path)
    if (node && node.clickable) return node
  }
  return null
}

export function getProfileNamePosition(root: UiNode): Point | null {
  const node = firstClickable(root, PROFILE_NAME_PATHS)
  return node ? centerOf(node) : null
}

export function getAvatarPosition(root: UiNode): Point | null {
  const node = firstClickable(root, AVATAR_PATHS)
  return node ? centerOf(node) : null
}

export function getEditNamePosition(root: UiNode): Point | null {
  const node = firstClickable(root, EDIT_NAME_PATHS)
  return node ? centerOf(node) : null
}

export function getUploadAvatarButtonPosition(root: UiNode): Point | null {
  const node = firstClickable(root, UPLOAD_AVATAR_PATHS)
  return node ? centerOf(node) : null
}

export function getEditNameInputPosition(root: UiNode): Point | null {
  const node = firstClickable(root, EDIT_NAME_INPUT_PATHS)
  return node ? centerOf(node) : null
}

export function getSaveButtonPosition(root: UiNode): Point | null {
  const node = firstClickable(root, SAVE_BUTTON_PATHS)
  return node ? centerOf(node) : null
}

/**
 * 图库里的所有图片位置。
 *
 * 移植自 `get_all_image_positions`：取 RecyclerView 下可点击的子节点，
 * 返回中心点与 bounds（选图需要约束点击范围）。
 */
export function getAllImagePositions(root: UiNode): Array<Point & { bounds: [number, number, number, number] }> {
  const list = nodeAtPath(root, GALLERY_LIST_PATHS[0] ?? [])
  if (!list) return []
  return list.children
    .filter((child) => child.clickable)
    .map((child) => ({ ...centerOf(child), bounds: child.bounds }))
}

/** 选图：`mode=random` 随机；`last` 取最后一张（旧实现默认 last）。 */
export function pickImagePosition(
  images: Array<Point & { bounds: [number, number, number, number] }>,
  mode: 'random' | 'last' | 'first' = 'last',
  random: () => number = Math.random,
): (Point & { bounds: [number, number, number, number] }) | null {
  if (images.length === 0) return null
  if (mode === 'first') return images[0] ?? null
  if (mode === 'last') return images[images.length - 1] ?? null
  const index = Math.floor(random() * images.length)
  return images[index] ?? null
}

export function getImageSaveButtonPosition(root: UiNode): Point | null {
  const node = firstClickable(root, IMAGE_SAVE_PATHS)
  return node ? centerOf(node) : null
}

/**
 * 加载转圈：`get_loading_spinner_position`。
 *
 * 旧实现的判据是「该路径节点存在且是 ImageView」；找不到返回 null。
 */
export function getLoadingSpinnerPosition(root: UiNode): Point | null {
  for (const path of LOADING_SPINNER_PATHS) {
    const node = nodeAtPath(root, path)
    if (node && node.className === 'android.widget.ImageView') return centerOf(node)
  }
  return null
}
