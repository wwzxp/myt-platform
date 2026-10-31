import type { UiNode } from '@myt/device';
import { type BoundedPoint, type Point } from '../locators/paths.ts';
/** 生日页 Next（2 条）。 */
export declare const BIRTHDAY_NEXT_PATHS: number[][];
/** 兴趣页 Skip（2 条）。 */
export declare const SKIP_PATHS: number[][];
/** 风险插件 Got it（2 条）。 */
export declare const RISK_PLUGIN_PATHS: number[][];
/** 语言提示 See original（1 条）。 */
export declare const SEE_ORIGINAL_PATHS: number[][];
/** 自动翻译 Later（1 条）。 */
export declare const LATER_PATHS: number[][];
/** 网络异常「不了」（需读出 body 才能确认路径，此处按旧实现的调用点占位）。 */
export declare function getBirthdayNextButtonPosition(root: UiNode): Point | null;
export declare function getSkipButtonPosition(root: UiNode): Point | null;
export declare function getRiskPluginGotItButtonPosition(root: UiNode): Point | null;
export declare function getSeeOriginalButtonPosition(root: UiNode): Point | null;
export declare function getLaterButtonPosition(root: UiNode): Point | null;
export type { BoundedPoint, Point };
//# sourceMappingURL=dialogs.d.ts.map