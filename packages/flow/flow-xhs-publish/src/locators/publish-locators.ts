import type { UiNode } from '@myt/device'
import { centerOf, firstNode, firstPoint, nodeAtPath, type Point } from './paths.ts'

/**
 * 图文发布相关定位器（**1:1 移植**自 `auto_fb/auto_fb.py`）。
 *
 * 所有路径常量与判据保持原样；注释里的行号指向旧实现，便于对照排查。
 * 路径语义：从 UI 层级 root 开始按索引逐级取子节点（见 `paths.ts`）。
 */

// ─────────────────────────────────────────────────────────────
// 相册权限弹窗
// ─────────────────────────────────────────────────────────────

/**
 * 系统权限弹窗的"允许"按钮候选路径（`get_allow_album_button_position`，281-319 行）。
 *
 * **顺序很重要**：旧代码首条是 `[...,1,0]`，在 Android 14 上命中的是「允许有限访问」，
 * 之后只能访问用户勾选的照片、选图会失败。这里把「全部允许」的路径提到最前，
 * 其余旧路径原样保留作为兜底。
 */
export const ALLOW_ALBUM_PATHS: readonly number[][] = [
  // Android 14：`全部允许`（Button，text 校验保证不会误点「允许有限访问」）
  [0, 0, 0, 0, 0, 0, 1, 1],
  // 旧实现的候选（部分在 Android 14 上会落到「允许有限访问」，由关键词校验兜底）
  [0, 0, 0, 0, 0, 0, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 2],
  [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1],
]

/** "允许"按钮的关键词（旧代码用 lower() 后 contains 匹配）。 */
const ALLOW_KEYWORDS = ['全部', '全選', '全选', '所有', 'all', 'select all', '允许', '允許', 'allow', 'permit']

/**
 * 命中关键词但**不能**点的情况。
 *
 * Android 14 的权限弹窗有三个按钮，都含「允许」二字：
 * 「允许有限访问」「全部允许」「不允许」。旧关键词判据会把前两个都放过，
 * 而首条路径恰好落在「允许有限访问」上——授权后只能访问用户勾选的照片。
 */
const DENY_KEYWORDS = ['有限', '部分', '不允许', '拒絕', '拒绝', 'deny']

/**
 * 定位系统权限弹窗的"允许"按钮。
 *
 * 旧实现先判 `root_frame.get("package") != "com.android.permissioncontroller"` 就直接返回 None
 * （281-319 行），这里保持一致：不是系统权限弹窗就不往下走。
 */
export function getAllowAlbumButtonPosition(root: UiNode): Point | null {
  const frame = root.children[0]
  if (!frame || frame.packageName !== 'com.android.permissioncontroller') return null

  const node = firstNode(root, ALLOW_ALBUM_PATHS, (candidate) => {
    const combined = `${candidate.text} ${candidate.contentDesc}`.toLowerCase()
    if (DENY_KEYWORDS.some((keyword) => combined.includes(keyword))) return false
    return ALLOW_KEYWORDS.some((keyword) => combined.includes(keyword.toLowerCase()))
  })
  return node ? centerOf(node) : null
}

// ─────────────────────────────────────────────────────────────
// 图库页判定与选图
// ─────────────────────────────────────────────────────────────

/**
 * 图库网格的几何识别（替代硬编码层级路径）。
 *
 * 旧实现写死 `[0,0,0,0,0,0,0,0,2,0,0,0,0,0]` 这种路径，小红书一改版就永久失效、
 * 必须单独维护。这里改成按**结构特征**找网格：
 *
 * 1. 树里存在一个可滚动（或子节点是等大矩形的）容器
 * 2. 它的子节点是「一个个图片格子」，每格里有可点的图片节点
 * 3. 选中角标贴在**图片格子的右上角**（几何关系，与层级无关）
 *
 * 这样换版本、换入口都不会失效。
 */

/** 旧实现的小红书内置相册网格路径（仅作兜底，主路径已改几何识别）。 */
export const GALLERY_LIST_PATHS: readonly number[][] = [[0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0]]

/** Android 14+ 系统 Photo Picker 的网格路径（兜底用）。 */
export const PHOTO_PICKER_GRID_PATHS: readonly number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0],
]

/** 一个图库图片格。 */
export interface GalleryImage {
  /** 点选位置（未选中时点格子中心；已选中时点角标外侧）。 */
  x: number
  y: number
  /** 是否已选中。 */
  selected: boolean
  /** 格子边界。 */
  bounds: [number, number, number, number]
}

/** 图库格子的最小边长（像素）：小于这个尺寸的等大节点是工具栏图标，不是图片格。 */
const MIN_GALLERY_CELL = 120

/** 角标相对于格子右上角的允许误差（像素）。 */
const BADGE_TOLERANCE = 120

/** 判断两个矩形是否近似等大（同一行/同一网格的格子）。 */
function similarSize(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  const aw = a[2] - a[0]
  const ah = a[3] - a[1]
  const bw = b[2] - b[0]
  const bh = b[3] - b[1]
  if (aw <= 0 || ah <= 0 || bw <= 0 || bh <= 0) return false
  return Math.abs(aw - bw) <= Math.max(aw, bw) * 0.25 && Math.abs(ah - bh) <= Math.max(ah, bh) * 0.25
}

/**
 * 判断节点是否为「贴在该格子右上角的小方块」——也就是选中角标。
 *
 * 实测结构里角标是 `FrameLayout [196,226][296,326]`，
 * 所属格子是 `[0,226][296,522]`：右边界对齐、上边界对齐、尺寸只有格子的 1/3。
 */
function isBadgeOf(
  badge: [number, number, number, number],
  cell: [number, number, number, number],
): boolean {
  const [bx1, by1, bx2, by2] = badge
  const [cx1, cy1, cx2, cy2] = cell
  const bw = bx2 - bx1
  const bh = by2 - by1
  const cw = cx2 - cx1
  const ch = cy2 - cy1
  if (bw <= 0 || bh <= 0 || cw <= 0 || ch <= 0) return false
  // 必须明显小于格子
  if (bw > cw * 0.6 || bh > ch * 0.6) return false
  // 右边界与上边界贴合格子右上角
  return Math.abs(bx2 - cx2) <= BADGE_TOLERANCE && Math.abs(by1 - cy1) <= BADGE_TOLERANCE
}

/**
 * 判断图片节点是否「铺满」格子（覆盖面积 ≥ 80%）。
 *
 * 图库格子里的 ImageView 几乎等于格子大小；笔记卡片里的缩略图只占一角。
 */
function coversCell(
  image: [number, number, number, number],
  cell: [number, number, number, number],
): boolean {
  const iw = image[2] - image[0]
  const ih = image[3] - image[1]
  const cw = cell[2] - cell[0]
  const ch = cell[3] - cell[1]
  if (iw <= 0 || ih <= 0 || cw <= 0 || ch <= 0) return false
  return iw * ih >= cw * ch * 0.8
}

/** 节点子树里是否有数字角标（已选中的编号 1、2、3…）。 */
function hasNumberBadge(node: UiNode): boolean {
  if (/^\d+$/.test(node.text.trim())) return true
  return node.children.some((child) => hasNumberBadge(child))
}

/** 收集一个格子内部的全部节点。 */
function flatten(node: UiNode, out: UiNode[] = []): UiNode[] {
  out.push(node)
  for (const child of node.children) flatten(child, out)
  return out
}

/**
 * 从一棵 UI 树里找出图库网格，返回所有图片格。
 *
 * 判据不依赖层级路径：遍历整棵树，找「子节点数量 ≥ 2 且各子节点近似等大」的容器。
 */
export function collectGalleryGrid(root: UiNode): GalleryImage[] {
  let best: GalleryImage[] = []

  const visit = (node: UiNode): void => {
    const children = node.children
    if (children.length >= 2) {
      // 子节点是否等大（网格行/网格本体）
      const first = children[0]!.bounds
      const sameSize = children.filter((child) => similarSize(child.bounds, first)).length
      // 尺寸下限：图库格子至少 120×120。顶部工具栏的小图标（扫一扫/分享，
      // 实测 48×48）也「等大」，不加这条会把首页误判成图库。
      const [fx1, fy1, fx2, fy2] = first
      const bigEnough = fx2 - fx1 >= MIN_GALLERY_CELL && fy2 - fy1 >= MIN_GALLERY_CELL
      if (sameSize >= 2 && bigEnough) {
        const cells: GalleryImage[] = []
        for (const child of children) {
          const nodes = flatten(child)
          // 格子里的图片：必须是 ImageView 且尺寸几乎等于格子本身。
          //
          // 只认 ImageView 是关键约束：首页的笔记卡片也「等大 + 可点」，
          // 但卡片里是文字 + 小缩略图，没有「铺满格子的 ImageView」。
          // 不加这条约束时，首页会被误判成图库（实测误判出 8 个格子）。
          const image = nodes.find(
            (candidate) =>
              candidate.clickable &&
              candidate.className.includes('ImageView') &&
              coversCell(candidate.bounds, child.bounds),
          )
          if (!image) continue

          // 角标：贴在格子右上角、且子树里有数字
          const badge = nodes.find((candidate) => isBadgeOf(candidate.bounds, child.bounds))
          const selected = badge ? hasNumberBadge(badge) || badge.selected : false

          const [cx1, cy1, cx2, cy2] = child.bounds
          if (badge) {
            const [bx1, by1, bx2, by2] = badge.bounds
            cells.push({
              x: Math.floor((bx1 + bx2) / 2),
              y: Math.floor((by1 + by2) / 2),
              selected,
              bounds: child.bounds,
            })
          } else {
            // 没有角标节点也仍然点**右上角**，不能点格子中心：
            // 小红书相册里点图片中心会打开全屏预览（实测进入 MaterialPreviewActivity，
            // 该页是纯 ImageView，抓不到任何控件，流程就此卡死）。
            const badgeSize = Math.max(48, Math.floor((cx2 - cx1) * 0.25))
            cells.push({
              x: cx2 - Math.floor(badgeSize / 2),
              y: cy1 + Math.floor(badgeSize / 2),
              selected,
              bounds: child.bounds,
            })
          }
        }
        if (cells.length > best.length) best = cells
      }
    }
    for (const child of children) visit(child)
  }

  visit(root)
  return best
}

/**
 * 判断当前是否图库/图片选择页。
 *
 * 判据：树上能找到至少 2 个等大的图片格。
 * 不再依赖 `NAF` 属性或固定层级——换版本、换入口都能识别。
 */
export function isGalleryPagePresent(root: UiNode): boolean {
  return collectGalleryGrid(root).length >= 2
}

/**
 * 获取图库页所有图片坐标和选中态。
 *
 * 优先用几何识别；识别不到时退回旧实现的两条固定路径（兜底，保证老版本仍可用）。
 */
export function getAllImagePositions(root: UiNode): GalleryImage[] {
  const byGeometry = collectGalleryGrid(root)
  if (byGeometry.length > 0) return byGeometry

  // ── 兜底：旧实现的小红书内置相册路径 ──
  for (const path of GALLERY_LIST_PATHS) {
    const list = nodeAtPath(root, path)
    if (!list) continue
    if (list.className !== 'androidx.recyclerview.widget.RecyclerView') continue

    const images: GalleryImage[] = []
    for (const child of list.children) {
      const innerFrame = child.children[0]
      if (!innerFrame) continue
      const rel = innerFrame.children[0]
      if (!rel) continue
      const checkbox = rel.children[4]
      if (!checkbox) continue

      const [x1, y1, x2, y2] = checkbox.bounds
      images.push({
        x: Math.floor((x1 + x2) / 2) + 5,
        y: Math.floor((y1 + y2) / 2) - 5,
        selected: checkbox.selected,
        bounds: child.bounds,
      })
    }
    if (images.length > 0) return images
  }
  return []
}

/**
 * 选取未选中图片的复选框坐标（`pick_images_by_count`，463-474 行）。
 *
 * 旧逻辑：只看前 `maxVisible` 张，过滤掉已选中的，最多返回 `count` 个。
 */
export function pickImagesByCount(root: UiNode, count = 1, maxVisible = 6): Point[] {
  const all = getAllImagePositions(root)
  const visible = all.slice(0, maxVisible)
  return visible
    .filter((image) => !image.selected)
    .slice(0, count)
    .map((image) => ({ x: image.x, y: image.y }))
}

/** 图库页底部"下一步"按钮（`get_image_save_button_position`，476-510 行）。 */
export const IMAGE_SAVE_PATHS: readonly number[][] = [[0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 1, 1]]

/** 定位图库页"下一步"（476-510 行）。 */
export function getImageSaveButtonPosition(root: UiNode): Point | null {
  return firstPoint(root, IMAGE_SAVE_PATHS)
}

// ─────────────────────────────────────────────────────────────
// 编辑页按钮
// ─────────────────────────────────────────────────────────────

/** 图文编辑页"下一步"候选路径（`get_next_step_button_position`，512-559 行）。 */
export const NEXT_STEP_PATHS: readonly number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 4, 0, 3],
  [0, 0, 0, 0, 0, 0, 0, 5, 0, 3],
  [0, 0, 0, 0, 0, 0, 1, 3, 0, 3],
]

/**
 * 定位图文编辑页"下一步"（512-559 行）。
 *
 * 旧实现按路径找不到时，还有**文字兜底**：遍历所有 clickable 节点，
 * 匹配 text 含 `下一步` / `next`。这里保留该兜底。
 */
export function getNextStepButtonPosition(root: UiNode): Point | null {
  const byPath = firstPoint(root, NEXT_STEP_PATHS)
  if (byPath) return byPath

  const fallback = ['下一步', 'next']
  const walk = (node: UiNode): Point | null => {
    if (node.clickable) {
      const text = node.text.trim().toLowerCase()
      if (fallback.some((keyword) => text.includes(keyword))) return centerOf(node)
    }
    for (const child of node.children) {
      const found = walk(child)
      if (found) return found
    }
    return null
  }
  return walk(root)
}

/** "申请获取您的相册内容位置信息"弹窗的"取消"（`get_album_permission_cancel_button_position`，561-592 行）。 */
export const ALBUM_PERMISSION_CANCEL_PATHS: readonly number[][] = [[0, 0, 0, 0, 0, 0, 0, 1, 0, 3, 0]]

/** 定位相册位置信息弹窗的"取消"（561-592 行）。 */
export function getAlbumPermissionCancelButtonPosition(root: UiNode): Point | null {
  return firstPoint(root, ALBUM_PERMISSION_CANCEL_PATHS)
}

/** "添加标题"输入框候选路径（`get_title_input_position`，594-629 行）。 */
export const TITLE_INPUT_PATHS: readonly number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0],
]

/** 标题输入框命中结果（旧代码返回三元组 `(x, y, text)`）。 */
export interface InputPosition extends Point {
  /** 输入框里已有的文字（旧代码用它决定是否需要先清空）。 */
  text: string
}

/** 定位"添加标题"输入框（594-629 行）。 */
export function getTitleInputPosition(root: UiNode): InputPosition | null {
  return firstInput(root, TITLE_INPUT_PATHS)
}

/** "添加正文"输入框候选路径（`get_body_input_position`，631-667 行）。 */
export const BODY_INPUT_PATHS: readonly number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 0, 0, 0],
]

/** 定位"添加正文"输入框（631-667 行）。 */
export function getBodyInputPosition(root: UiNode): InputPosition | null {
  return firstInput(root, BODY_INPUT_PATHS)
}

/** 正文输入后右下角"完成"按钮（`get_done_button_position`，669-701 行）。 */
export const DONE_BUTTON_PATHS: readonly number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2],
  [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 2],
]

/** 定位"完成"按钮（669-701 行）。 */
export function getDoneButtonPosition(root: UiNode): Point | null {
  return firstPoint(root, DONE_BUTTON_PATHS)
}

/** 底部"存草稿"按钮（`get_save_draft_button_position`，703-734 行）。 */
export const SAVE_DRAFT_PATHS: readonly number[][] = [[0, 0, 0, 0, 0, 0, 0, 3, 0, 0]]

/** 定位"存草稿"（703-734 行）。 */
export function getSaveDraftButtonPosition(root: UiNode): Point | null {
  return firstPoint(root, SAVE_DRAFT_PATHS)
}

/** 底部"发布笔记"按钮（`get_publish_button_position`，736-766 行）。 */
export const PUBLISH_BUTTON_PATHS: readonly number[][] = [[0, 0, 0, 0, 0, 0, 0, 3, 0, 1]]

/** 定位"发布笔记"（736-766 行）。 */
export function getPublishButtonPosition(root: UiNode): Point | null {
  return firstPoint(root, PUBLISH_BUTTON_PATHS)
}

/** "确认保存笔记至草稿箱吗?"弹窗的"确定"（`get_confirm_dialog_button_position`，768-798 行）。 */
export const CONFIRM_DIALOG_PATHS: readonly number[][] = [[0, 0, 0, 0, 4]]

/** 定位确认弹窗的"确定"（768-798 行）。 */
export function getConfirmDialogButtonPosition(root: UiNode): Point | null {
  return firstPoint(root, CONFIRM_DIALOG_PATHS)
}

// ─────────────────────────────────────────────────────────────
// 弹窗与入口
// ─────────────────────────────────────────────────────────────

/** "添加章节 → 我知道了"按钮（`get_got_it_button_position`，1005-1036 行）。 */
export const GOT_IT_PATHS: readonly number[][] = [[0, 0, 0, 0, 2, 0]]

/** 定位"我知道了"（1005-1036 行）。 */
export function getGotItButtonPosition(root: UiNode): Point | null {
  return firstPoint(root, GOT_IT_PATHS)
}

/** 账号静音提示的取消按钮（`get_mute_dialog_cancel_button_position`，1038-1073 行）。 */
export const MUTE_DIALOG_CANCEL_PATHS: readonly number[][] = [[0, 0, 0, 0, 2, 0]]

/**
 * 定位静音提示的取消（1038-1073 行）。
 *
 * 旧实现要求 `text == "Cancel"`，不等则直接返回 None（避免误点别的弹窗）。
 */
export function getMuteDialogCancelButtonPosition(root: UiNode): Point | null {
  const node = nodeAtPath(root, MUTE_DIALOG_CANCEL_PATHS[0]!)
  if (!node || node.text !== 'Cancel') return null
  return centerOf(node)
}

/** 右上角"选择音乐"按钮（`get_music_button_position`，898-928 行）。 */
export const MUSIC_BUTTON_PATHS: readonly number[][] = [[0, 0, 0, 0, 0, 0, 0, 1, 0, 0]]

/** 定位"选择音乐"（898-928 行）。 */
export function getMusicButtonPosition(root: UiNode): Point | null {
  return firstPoint(root, MUSIC_BUTTON_PATHS)
}

/** 底部「我」按钮（`get_bottom_profile_button_position`，930-968 行）。 */
export const BOTTOM_PROFILE_PATHS: readonly number[][] = [[0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 4]]

/**
 * 定位底部「我」（930-968 行）。
 *
 * 旧实现额外要求 `clickable == "true"`，不满足直接返回 None（不再尝试其它路径）。
 */
export function getBottomProfileButtonPosition(root: UiNode): Point | null {
  const node = nodeAtPath(root, BOTTOM_PROFILE_PATHS[0]!)
  if (!node || !node.clickable) return null
  return centerOf(node)
}

/** 加载转圈（`is_loading_spinner_present`，975-1003 行）。 */
export const LOADING_SPINNER_PATHS: readonly number[][] = [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]]

/**
 * 是否有加载转圈（975-1003 行）。
 *
 * 旧判据：路径末节点是 `android.widget.ImageView`，且宽高都在 `10 < size <= 100`。
 */
export function isLoadingSpinnerPresent(root: UiNode): boolean {
  const node = nodeAtPath(root, LOADING_SPINNER_PATHS[0]!)
  if (!node) return false
  if (node.className !== 'android.widget.ImageView') return false
  const [x1, y1, x2, y2] = node.bounds
  const width = x2 - x1
  const height = y2 - y1
  return width > 10 && width <= 100 && height > 10 && height <= 100
}

// ─────────────────────────────────────────────────────────────

/**
 * 判断个人主页「公开」区域下是否有笔记内容（`has_public_notes_content`，800-837 行）。
 *
 * 旧实现不靠 scrollable（中/英文版不同），而是按结构判定：
 * 找内容层 RecyclerView，其 child[0] 是含 tab 按钮 RecyclerView 的 RelativeLayout，
 * 则最后子节点是 FrameLayout 表示有笔记，RelativeLayout 表示空。
 */
export function hasPublicNotesContent(root: UiNode): boolean {
  const hasTabButtons = (node: UiNode): boolean => {
    if (node.className.endsWith('RecyclerView')) {
      if (node.children.some((child) => child.className === 'android.widget.Button')) return true
    }
    return node.children.some((child) => hasTabButtons(child))
  }

  const walk = (node: UiNode): boolean | null => {
    if (node.className.endsWith('RecyclerView')) {
      const children = node.children
      if (children.length >= 2) {
        const first = children[0]!
        if (first.className === 'android.widget.RelativeLayout' && hasTabButtons(first)) {
          return children[children.length - 1]!.className === 'android.widget.FrameLayout'
        }
      }
    }
    for (const child of node.children) {
      const result = walk(child)
      if (result !== null) return result
    }
    return null
  }

  return walk(root) ?? false
}

/**
 * EditText 的占位符文案。
 *
 * 小红书把占位符直接写进 `text` 属性（没有 `hint`），输入框为空时回读会拿到它。
 * 若不归一化：清空后会被当成"仍有残留"，`contains` 校验也会误判通过。
 */
const INPUT_PLACEHOLDERS = new Set([
  '添加正文',
  '添加标题',
  '说点什么...',
  '填写标题',
  // 长文编辑页（LongNoteEditActivity）的占位符
  '粘贴到这里或输入文字，内容将自动保存',
  '输入标题',
  '请输入标题',
])

/** 按路径找 EditText 输入框，返回中心点和当前文字（占位符归一化为空串）。 */
function firstInput(root: UiNode, paths: readonly number[][]): InputPosition | null {
  const node = firstNode(root, paths, (candidate) => candidate.className.includes('EditText'))
  if (!node) return null
  const point = centerOf(node)
  const raw = node.text
  return { x: point.x, y: point.y, text: INPUT_PLACEHOLDERS.has(raw.trim()) ? '' : raw }
}

// ─────────────────────────────────────────────────────────────
// 文字笔记（`fb_wz`，1556-1722 行）
// ─────────────────────────────────────────────────────────────

/** 写想法页「说点什么或提个问题...」输入区域（`get_text_note_input_position`，1556-1587 行）。 */
export const TEXT_NOTE_INPUT_PATHS: readonly number[][] = [[0, 0, 0, 0, 0, 0, 3, 1, 1]]

/** 定位写想法页的输入区域（1556-1587 行）。 */
export function getTextNoteInputPosition(root: UiNode): Point | null {
  return firstPoint(root, TEXT_NOTE_INPUT_PATHS)
}

/** 写想法页真正的文字 EditText（`get_text_edit_input_position`，1589-1625 行）。 */
export const TEXT_EDIT_INPUT_PATHS: readonly number[][] = [
  [0, 0, 0, 0, 0, 0, 3, 0],
  [0, 0, 0, 0, 0, 0, 3, 0, 0],
]

/** 定位写想法页的文字输入框（1589-1625 行）。 */
export function getTextEditInputPosition(root: UiNode): InputPosition | null {
  return firstInput(root, TEXT_EDIT_INPUT_PATHS)
}

/** 文字笔记底部的「下一步」（`get_text_next_step_button_position`，1627-1657 行）。 */
export const TEXT_NEXT_STEP_PATHS: readonly number[][] = [[0, 0, 0, 0, 0, 0, 4]]

/** 定位文字笔记的「下一步」（1627-1657 行）。 */
export function getTextNextStepButtonPosition(root: UiNode): Point | null {
  return firstPoint(root, TEXT_NEXT_STEP_PATHS)
}

/** 预览页底部的「下一步」（`get_preview_next_step_button_position`，1659-1689 行）。 */
export const PREVIEW_NEXT_STEP_PATHS: readonly number[][] = [[0, 0, 0, 0, 0, 0, 2, 2]]

/** 定位预览页的「下一步」（1659-1689 行）。 */
export function getPreviewNextStepButtonPosition(root: UiNode): Point | null {
  return firstPoint(root, PREVIEW_NEXT_STEP_PATHS)
}

/** 「取消」按钮（`get_cancel_button_position`，1691-1721 行）。 */
export const CANCEL_BUTTON_PATHS: readonly number[][] = [[0, 0, 0, 0, 0, 0, 1, 0, 0, 2]]

/** 定位「取消」按钮（1691-1721 行）。 */
export function getCancelButtonPosition(root: UiNode): Point | null {
  return firstPoint(root, CANCEL_BUTTON_PATHS)
}

// ─────────────────────────────────────────────────────────────
// 长文笔记（`fb_long_wz`，1996-2225 行）
// ─────────────────────────────────────────────────────────────

/** 写长文入口（`get_write_article_button_position`，1996-2041 行）。 */
export const WRITE_ARTICLE_PATHS: readonly number[][] = [
  [0, 0, 0, 0, 0, 0, 7, 0, 2],
  [0, 0, 0, 0, 0, 0, 8, 0, 2, 0, 0],
]

/** 定位写长文入口（1996-2041 行）。 */
export function getWriteArticleButtonPosition(root: UiNode): Point | null {
  return firstPoint(root, WRITE_ARTICLE_PATHS)
}

/** 长文标题输入框（`get_article_title_input_position`，2043-2078 行）。 */
export const ARTICLE_TITLE_PATHS: readonly number[][] = [
  // 当前版本（实测 LongNoteEditActivity）
  [0, 0, 0, 0, 0, 0, 0, 2, 0, 1],
  // 旧实现（`get_article_title_input_position`，2043-2078 行）
  [0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1],
]

/** 定位长文标题输入框（2043-2078 行）。 */
export function getArticleTitleInputPosition(root: UiNode): InputPosition | null {
  return firstInput(root, ARTICLE_TITLE_PATHS)
}

/** 长文正文输入框（`get_article_body_input_position`，2080-2115 行）。 */
export const ARTICLE_BODY_PATHS: readonly number[][] = [
  // 当前版本（实测 LongNoteEditActivity）
  [0, 0, 0, 0, 0, 0, 0, 2, 0, 0],
  // 旧实现（`get_article_body_input_position`，2080-2115 行）
  [0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0],
]

/** 定位长文正文输入框（2080-2115 行）。 */
export function getArticleBodyInputPosition(root: UiNode): InputPosition | null {
  return firstInput(root, ARTICLE_BODY_PATHS)
}

/** 格式化按钮（`get_format_button_position`，2117-2147 行）。 */
export const FORMAT_BUTTON_PATHS: readonly number[][] = [[0, 0, 0, 0, 0, 0, 0, 0, 1, 2]]

/** 定位格式化按钮（2117-2147 行）。 */
export function getFormatButtonPosition(root: UiNode): Point | null {
  return firstPoint(root, FORMAT_BUTTON_PATHS)
}

/** 长文「下一步」（`get_next_button_position`，2149-2192 行）。 */
export const ARTICLE_NEXT_PATHS: readonly number[][] = [[0, 0, 0, 0, 0, 0, 0, 0, 6]]

/** 定位长文「下一步」（2149-2192 行）。 */
export function getNextButtonPosition(root: UiNode): Point | null {
  return firstPoint(root, ARTICLE_NEXT_PATHS)
}

/** 「try it」按钮（`get_try_it_button_position`，2194-2225 行）。 */
export const TRY_IT_PATHS: readonly number[][] = [[0, 0, 0, 0, 0, 0, 4]]

/** 定位「try it」（2194-2225 行）。 */
export function getTryItButtonPosition(root: UiNode): Point | null {
  return firstPoint(root, TRY_IT_PATHS)
}

// ─────────────────────────────────────────────────────────────
// 通用：按文字找按钮、按文字找返回
// ─────────────────────────────────────────────────────────────

/**
 * 按文字在整棵树里找按钮，返回中心点。
 *
 * 长文页的「存草稿 / 不保存返回」是弹窗按钮，没有固定层级路径，
 * 只能按文字找。文字匹配用「相等或包含」，优先完全相等。
 */
export function findButtonByText(root: UiNode, texts: readonly string[]): Point | null {
  let fuzzy: Point | null = null
  const walk = (node: UiNode): Point | null => {
    const label = `${node.text} ${node.contentDesc}`.trim()
    if (label) {
      for (const want of texts) {
        if (label === want) return centerOf(node)
        if (!fuzzy && label.includes(want)) fuzzy = centerOf(node)
      }
    }
    for (const child of node.children) {
      const found = walk(child)
      if (found) return found
    }
    return null
  }
  return walk(root) ?? fuzzy
}

/** 顶部返回按钮（文字为「返回」或以「返回」结尾的图标）。 */
export const BACK_BUTTON_TEXTS: readonly string[] = ['返回', '不保存返回']

/** 定位顶部返回按钮。 */
export function getBackButtonPosition(root: UiNode): Point | null {
  return findButtonByText(root, BACK_BUTTON_TEXTS)
}
