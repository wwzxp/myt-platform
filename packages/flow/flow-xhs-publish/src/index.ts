/**
 * 小红书**发布**业务包。
 *
 * 与上号包 `@myt/flow-xhs` 完全解耦：只用 `@myt/device` 与 `@myt/automation`，
 * 删掉任一包都不影响另一个。
 *
 * 三个流程：
 * - `xhs.publish.image`   图文笔记（`fb_image`）
 * - `xhs.publish.text`    文字笔记（`fb_wz`）
 * - `xhs.publish.article` 长文笔记（`fb_long_wz`）
 */

export { createPublishImageFlow, type PublishImageInput } from './flows/publish-image.ts'
export { createPublishTextFlow, type PublishTextInput } from './flows/publish-text.ts'
export { createPublishArticleFlow, type PublishArticleInput } from './flows/publish-article.ts'
export { xhsPublishPack } from './pack.ts'
export {
  collectPageKeywords,
  type CollectPageOptions,
  type CollectPageResult,
} from './collect.ts'

export {
  XHS_PAGES,
  XHS_PACKAGE,
  XHS_RECOVERY_RULES,
  DEEPLINK_HOME,
  DEEPLINK_PROFILE,
  DEEPLINK_PUBLISH_IMAGE,
  DEEPLINK_WZ,
} from './pages.ts'

export {
  prepareEnvironment,
  submitNote,
  verifyPublished,
  pullToRefresh,
  scrollAlbumPage,
  pickImagesAction,
  pagesOf,
} from './shared.ts'

export {
  getAllImagePositions,
  getAlbumPermissionCancelButtonPosition,
  getAllowAlbumButtonPosition,
  getBodyInputPosition,
  getBottomProfileButtonPosition,
  getConfirmDialogButtonPosition,
  getDoneButtonPosition,
  getGotItButtonPosition,
  getImageSaveButtonPosition,
  getMusicButtonPosition,
  getMuteDialogCancelButtonPosition,
  getNextStepButtonPosition,
  getPublishButtonPosition,
  getSaveDraftButtonPosition,
  getTitleInputPosition,
  hasPublicNotesContent,
  isGalleryPagePresent,
  isLoadingSpinnerPresent,
  pickImagesByCount,
  type GalleryImage,
  type InputPosition,
} from './locators/publish-locators.ts'
