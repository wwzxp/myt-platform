import type { UiNode } from '@myt/device';
import { type Point } from '../locators/paths.ts';
/** 个人主页名称（3 条）。 */
export declare const PROFILE_NAME_PATHS: number[][];
/** 编辑页头像（2 条）。 */
export declare const AVATAR_PATHS: number[][];
/** 编辑资料名称（2 条）。 */
export declare const EDIT_NAME_PATHS: number[][];
/** 上传新头像按钮（1 条）。 */
export declare const UPLOAD_AVATAR_PATHS: number[][];
/** 修改名称输入框（2 条）。 */
export declare const EDIT_NAME_INPUT_PATHS: number[][];
/** 修改名称保存按钮（2 条）。 */
export declare const SAVE_BUTTON_PATHS: number[][];
/** 图库页 RecyclerView（1 条，用于枚举图片）。 */
export declare const GALLERY_LIST_PATHS: number[][];
/** 图片选择的「保存/完成」按钮（1 条）。 */
export declare const IMAGE_SAVE_PATHS: number[][];
/** 加载转圈（`get_loading_spinner_position`，单条路径 + 尺寸判据）。 */
export declare const LOADING_SPINNER_PATHS: number[][];
export declare function getProfileNamePosition(root: UiNode): Point | null;
export declare function getAvatarPosition(root: UiNode): Point | null;
export declare function getEditNamePosition(root: UiNode): Point | null;
export declare function getUploadAvatarButtonPosition(root: UiNode): Point | null;
export declare function getEditNameInputPosition(root: UiNode): Point | null;
export declare function getSaveButtonPosition(root: UiNode): Point | null;
/**
 * 图库里的所有图片位置。
 *
 * 移植自 `get_all_image_positions`：取 RecyclerView 下可点击的子节点，
 * 返回中心点与 bounds（选图需要约束点击范围）。
 */
export declare function getAllImagePositions(root: UiNode): Array<Point & {
    bounds: [number, number, number, number];
}>;
/** 选图：`mode=random` 随机；`last` 取最后一张（旧实现默认 last）。 */
export declare function pickImagePosition(images: Array<Point & {
    bounds: [number, number, number, number];
}>, mode?: 'random' | 'last' | 'first', random?: () => number): (Point & {
    bounds: [number, number, number, number];
}) | null;
export declare function getImageSaveButtonPosition(root: UiNode): Point | null;
/**
 * 加载转圈：`get_loading_spinner_position`。
 *
 * 旧实现的判据是「该路径节点存在且是 ImageView」；找不到返回 null。
 */
export declare function getLoadingSpinnerPosition(root: UiNode): Point | null;
//# sourceMappingURL=profile-locators.d.ts.map