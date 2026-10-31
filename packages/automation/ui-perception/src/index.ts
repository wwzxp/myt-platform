/**
 * UI 感知：把界面（UI 树 / 截图）变成结构化的、可决策的数据。
 *
 * 这一层是**纯函数**：不接触设备（不依赖 `DeviceControl`），也不调用模型。
 * 输入是已经抓好的数据，输出是候选目标、视觉列举结果或裁剪后的图片。
 *
 * 依赖方向：任何抓取层（ADB / 云手机 / 网页）都可以把结果喂进来复用。
 */

export {
  collectActionTargets,
  renderTargets,
  hitTarget,
  narrowTargets,
  inferRegion,
  type ActionTarget,
  type RawNode,
  type ScreenSize,
} from './ui-action-targets.ts'

export {
  buildListPrompt,
  parseListing,
  mapNamesToTargets,
  pickByPosition,
  cropOfRegion,
  type CropRect as RegionCropRect,
  type VisionListing,
} from './ui-vision-listing.ts'

export {
  cropPng,
  decodePng,
  encodePng,
  type CropRect,
} from './png-crop.ts'
