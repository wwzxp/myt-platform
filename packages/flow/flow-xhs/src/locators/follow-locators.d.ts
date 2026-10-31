import type { UiNode } from '@myt/device';
import { type Point } from '../locators/paths.ts';
/** 「用户」标签页（2 条）。 */
export declare const USERS_TAB_PATHS: number[][];
/** 关注 / 已关注按钮（5 条，两函数共用）。 */
export declare const FOLLOW_BUTTON_PATHS: number[][];
/** 未关注状态下的「关注」按钮。 */
export declare function getFollowButtonPosition(root: UiNode): Point | null;
/** 已关注状态按钮（用于判定是否已关注）。 */
export declare function getFollowingButtonPosition(root: UiNode): Point | null;
export declare function getUsersTabPosition(root: UiNode): Point | null;
//# sourceMappingURL=follow-locators.d.ts.map