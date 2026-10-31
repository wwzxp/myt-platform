import type { PageSpec, RecoveryRule } from '@myt/automation'

/**
 * 小红书的页面表与异常恢复规则。
 *
 * 引擎不认识这些——业务包注册自己的页面定义，引擎按顺序匹配。
 * **顺序很重要**：更具体的页面要排在前面（`post-editor` 在 `album` 之前）。
 */
export const XHS_PAGES: readonly PageSpec[] = [
  // 系统级弹窗优先：它盖在任何页面之上。
  { id: 'permission', markers: ['GrantPermissionsActivity', 'permissioncontroller'] },
  { id: 'photo-picker', markers: ['PhotoPickerUserSelectActivity', 'photopicker'] },
  // 具体业务页。
  { id: 'post-editor', markers: ['CapaPostNotePlatformActivity', 'PostNotePlatformActivity'] },
  { id: 'article-editor', markers: ['LongNoteEditActivity'] },
  { id: 'review', markers: ['CapaPictureReviewV3Activity', 'PictureReviewV3Activity'] },
  { id: 'image-editor', markers: ['ImageEditActivity'] },
  { id: 'preview', markers: ['MaterialPreviewActivity'] },
  { id: 'text-note', markers: ['CapaPortraitEditV2Activity', 'PortraitEditV2Activity'] },
  { id: 'album', markers: ['CapaAlbumActivity', 'entrancev2'] },
  { id: 'profile', markers: ['ProfileActivity', 'UserProfileActivity'] },
  { id: 'home', markers: ['IndexActivity'] },
]

/** 小红书包名。 */
export const XHS_PACKAGE = 'com.xingin.xhs'

/** 首页深链（实测能从任意深层页面一次到位）。 */
export const DEEPLINK_HOME = 'xhsdiscover://home'

/** 个人页深链。 */
export const DEEPLINK_PROFILE = 'xhsdiscover://profile'

/** 图文发布页深链（`open_fb_image_page`，269-271 行）。 */
export const DEEPLINK_PUBLISH_IMAGE = 'xhsdiscover://post_note/'

/** 写想法页深链（`open_fb_wz_page`，273-275 行）。 */
export const DEEPLINK_WZ = 'xhsdiscover://post_new_note?page={"page_type":"now_portal_home_page"}'

/**
 * 小红书已知异常的恢复规则。
 *
 * 每条都来自实测：
 * - 权限弹窗不点「全部允许」会只授权部分照片，后面选图看不到图
 * - 素材预览页是纯 ImageView，抓不到控件，只能按坐标点右下角
 * - 文字笔记的预览页要再点一次「下一步」
 */
export const XHS_RECOVERY_RULES: readonly RecoveryRule[] = [
  {
    name: '系统权限弹窗',
    matches: ['permissioncontroller', 'GrantPermissions'],
    actions: [{ kind: 'tapText', texts: ['全部允许', '允许', 'ALLOW'] }],
  },
  {
    name: '素材预览页',
    matches: ['MaterialPreviewActivity'],
    // 纯 ImageView 页面，只能按坐标点右下角「下一步」（实测 788,1544）。
    actions: [{ kind: 'tap', x: 788, y: 1544 }],
  },
  {
    name: '发布预览页',
    matches: ['CapaPictureReviewV3Activity', 'PictureReviewV3Activity'],
    actions: [{ kind: 'tapText', texts: ['下一步'] }],
  },
  {
    name: '系统 Photo Picker',
    matches: ['PhotoPickerUserSelectActivity'],
    actions: [{ kind: 'back' }],
  },
]
