import type { PageSpec, RecoveryRule } from '@myt/automation'

/**
 * 小红书的页面表与异常恢复规则。
 *
 * 引擎不认识这些——业务包注册自己的页面定义，引擎按顺序匹配。
 * **顺序很重要**：更具体的页面要排在前面（`post-editor` 在 `album` 之前）。
 */
export const XHS_PAGES: readonly PageSpec[] = [
  // 系统级弹窗优先：它盖在任何页面之上。
  {
    id: 'permission',
    markers: ['GrantPermissionsActivity', 'permissioncontroller'],
    keywords: ['允许', '拒绝', '仅在使用中允许'],
  },
  {
    id: 'photo-picker',
    markers: ['PhotoPickerUserSelectActivity', 'photopicker'],
    keywords: ['最近项目', '所有照片'],
  },
  // 具体业务页。
  {
    id: 'post-editor',
    markers: ['CapaPostNotePlatformActivity', 'PostNotePlatformActivity'],
    keywords: ['发布笔记', '添加位置', '话题'],
  },
  // 长文编辑页内嵌在文字编辑页里，焦点常驻旧 Activity，只能靠界面文字认出。
  {
    id: 'article-editor',
    markers: ['LongNoteEditActivity'],
    contentMarkers: ['输入标题', '一键排版'],
    keywords: ['一键排版', '标题'],
  },
  {
    id: 'review',
    markers: ['CapaPictureReviewV3Activity', 'PictureReviewV3Activity'],
    keywords: ['一键成片', '下一步'],
  },
  {
    id: 'image-editor',
    markers: ['ImageEditActivity'],
    // 「文字」这类两字泛词不进词表：正文里一旦出现就会误命中。
    keywords: ['滤镜', '贴纸', '裁切', '标记', '调节', '拼图'],
  },
  {
    id: 'preview',
    markers: ['MaterialPreviewActivity'],
    // 纯图片页抓到 0 个文字，关键词只作辅助。
    keywords: [],
  },
  {
    id: 'text-note',
    markers: ['CapaPortraitEditV2Activity', 'PortraitEditV2Activity'],
    contentMarkers: ['写想法'],
    keywords: ['写想法', '添加话题'],
  },
  {
    id: 'album',
    markers: ['CapaAlbumActivity', 'entrancev2'],
    // 实况图/全屏图是这个页独有的，个人主页也有「草稿箱」，不能单靠它。
    keywords: ['实况图', '全屏图', '草稿箱'],
  },
  {
    id: 'profile',
    markers: ['ProfileActivity', 'UserProfileActivity'],
    keywords: ['笔记', '收藏', '赞过'],
  },
  {
    id: 'home',
    markers: ['IndexActivity'],
    // 首页的 tab（推荐/RED/热点…）文字始终都在、只有选中态不同，
    // 关键词分不开——通用工具不为此设特例，这些 tab 视为同一个页面。
    keywords: ['关注', '发现', '同城', '市集', '搜索'],
  },
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
