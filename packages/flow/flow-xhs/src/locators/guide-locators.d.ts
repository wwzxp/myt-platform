import type { UiNode } from '@myt/device';
import { type Point } from '../locators/paths.ts';
/** 带 bounds 与 text 的命中（生日滚轮列需要 bounds 计算滑动起点）。 */
export interface PickerColumn {
    x: number;
    y: number;
    text: string;
    bounds: [number, number, number, number];
}
/** 生日：左列年份（2 条路径）。 */
export declare const BIRTH_YEAR_PATHS: number[][];
/** 生日：中列月份（2 条路径）。 */
export declare const BIRTH_MONTH_PATHS: number[][];
/** 生日：右列日（2 条路径）。 */
export declare const BIRTH_DAY_PATHS: number[][];
/** QQ 登录按钮（4 条路径，且要求文案/资源含 QQ）。 */
export declare const QQ_LOGIN_PATHS: number[][];
/** 东鹏上号器输入框（1 条）。 */
export declare const DONGPENG_INPUT_PATH: number[];
/** 东鹏上号器「我授权」按钮（1 条）。 */
export declare const DONGPENG_BUTTON_PATH: number[];
/** 蓝旗一键授权输入框（1 条）。 */
export declare const CARD_PASSWORD_INPUT_PATH: number[];
/** 蓝旗一键授权按钮（1 条）。 */
export declare const ONE_CLICK_AUTH_BUTTON_PATH: number[];
/** 网络异常「不了」（2 条，需 TextView 且可点击）。 */
export declare const NETWORK_ERROR_PATHS: number[][];
/** 服务器出错「刷新试试」（3 条）。 */
export declare const SERVER_ERROR_PATHS: number[][];
export declare function getBirthYearPosition(root: UiNode): PickerColumn | null;
export declare function getBirthMonthPosition(root: UiNode): PickerColumn | null;
export declare function getBirthDayPosition(root: UiNode): PickerColumn | null;
/**
 * QQ 登录按钮：除 `clickable` 外还要求文案或 resource-id 命中 QQ。
 * 移植自 `get_qq_login_button_position`（新增：无 bounds 时跳过而非抛错）。
 */
export declare function getQqLoginButtonPosition(root: UiNode): Point | null;
/** 东鹏上号器输入框：`EditText` 或可点击即可（旧实现如此宽松）。 */
export declare function getDongpengInputPosition(root: UiNode): Point | null;
export declare function getDongpengButtonPosition(root: UiNode): Point | null;
/** 蓝旗一键授权输入框（V 跳登录用）。 */
export declare function getCardPasswordInputPosition(root: UiNode): Point | null;
export declare function getOneClickAuthorizationButtonPosition(root: UiNode): Point | null;
/** 网络异常「不了」：只认 TextView 且可点击。 */
export declare function getNetworkErrorCancelButtonPosition(root: UiNode): Point | null;
/**
 * 服务器出错「刷新试试」。
 *
 * 旧实现（`auto_login.py:2071-2108`）**不检查 clickable**：能解析出 bounds 就返回。
 */
export declare function getServerErrorRefreshButtonPosition(root: UiNode): Point | null;
/**
 * 安全验证页的「验证」按钮（3 条路径 + 文字兜底）。
 *
 * 移植自 `get_safety_verification_verify_button_info`：
 * - 命中 class 限定 Button / View / TextView；
 * - 文本为空时取第一个 TextView 子节点的文本；
 * - 全部路径失败后按关键词全文检索（中英繁体）。
 */
export declare const SAFETY_VERIFY_BUTTON_PATHS: number[][];
export interface VerifyButtonInfo extends Point {
    clickable: boolean;
    text: string;
}
export declare function getSafetyVerificationVerifyButtonInfo(root: UiNode): VerifyButtonInfo | null;
//# sourceMappingURL=guide-locators.d.ts.map