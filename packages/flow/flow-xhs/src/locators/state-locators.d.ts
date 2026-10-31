import type { UiNode } from '@myt/device';
import { type BoundedPoint, type Point } from '../locators/paths.ts';
/** 区号列表页的 ListView 路径（1 条，与旧实现一致）。 */
export declare const COUNTRY_LIST_PATH: number[];
export interface CountryEntry extends BoundedPoint {
    country: string;
    code: string;
}
/**
 * 解析区号列表。
 *
 * 旧实现结构假设：ListView → FrameLayout 项 → [0]=国家名 TextView，[1]=区号 TextView。
 * 解析不到返回空数组（旧实现同样返回 `results` 而不会抛错）。
 */
export declare function getCountryCodeList(root: UiNode): CountryEntry[];
export declare const RESEND_BUTTON_PATHS: number[][];
export interface ResendInfo extends Point {
    clickable: boolean;
    text: string;
}
/**
 * 重发按钮信息。
 *
 * 关键细节（旧实现注释）：可点击状态以**父 Button** 为准，
 * 子 TextView 在倒计时禁用态也可能 `enabled=true`，不能用子节点判断。
 */
export declare function getResendButtonInfo(root: UiNode): ResendInfo | null;
/** 从按钮文案提取倒计时秒数；无数字时返回 null（表示可点击）。 */
export declare function parseCountdownFromText(text: string): number | null;
export declare const FOCUSED_INPUT_PATHS: number[][];
/** 读当前聚焦输入框的文本；未找到返回 null（旧实现语义）。 */
export declare function getFocusedInputContent(root: UiNode): string | null;
/**
 * 账号下线弹窗判定：**只按层级结构，不校验文字**（旧实现如此）。
 * 路径 [0,0,0,0] 的节点需有 ≥4 个子节点，且第 4 个可点击。
 */
export declare function isAccountOfflineDialog(root: UiNode): boolean;
/**
 * 判断页面是否在加载转圈。
 *
 * 旧实现的判据：
 * - 先找 ≥200×200 的 FrameLayout 作为「全屏参照」；
 * - 找 40–160 px 见方、宽高差 ≤20 的 ImageView；
 * - 有全屏参照时要求该图中心距屏幕中心 ≤22%；
 * - 无全屏参照时要求整页节点数 ≤15（纯加载页）。
 */
export declare function isLoadingSpinnerPresent(root: UiNode): boolean;
/** 安全验证网格容器的路径（3 条，与旧实现一致）。 */
export declare const SAFETY_GRID_PATHS: number[][];
export interface SafetyGridCell {
    index: number;
    x: number;
    y: number;
    bounds: [number, number, number, number];
    selected: boolean;
}
/**
 * 找安全验证页的 6 宫格。
 *
 * 移植自 `_find_safety_verification_grid_cells`，判据必须逐条一致：
 * - 容器**恰好 6 个子节点**；
 * - 三种结构：ViewGroup+Button / View(clickable)+Image / View(非clickable)+Image；
 * - 选中态：`selected`/`checked` 为 true，或（ViewGroup 结构）Button 下有额外角标子树，
 *   或（WebView 结构）子节点数 > 2。
 */
export declare function findSafetyVerificationGridCells(root: UiNode): Promise<SafetyGridCell[]>;
export declare function isSafetyVerificationPage(root: UiNode): Promise<boolean>;
//# sourceMappingURL=state-locators.d.ts.map