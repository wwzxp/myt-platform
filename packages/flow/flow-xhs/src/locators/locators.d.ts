import type { UiNode } from '@myt/device';
import { type Point } from '../locators/paths.ts';
/**
 * 小红书界面定位函数（**1:1 移植**自 auto_login.py）。
 *
 * 为什么原样搬：这些层级路径是在真机上反复试出来的（注释里带日期），
 * 每条路径对应一个 App 版本的界面结构。自己发明选择器会在真机上失效
 * ——已实测：用 text/desc 找协议复选框，点击后状态不切换。
 *
 * 规则（与旧实现一致）：
 * - 按数组顺序逐条尝试路径，命中即返回；
 * - 命中节点必须满足 `clickable="true"`（个别函数还校验 class）；
 * - 全部失败返回 null，由调用方记录 dump 并失败。
 */
export type { Point, BoundedPoint } from '../locators/paths.ts';
/**
 * 手机号登录按钮（**10 条**，与 `auto_login.py:1739-1751` 一致）。
 *
 * 注意：Python 里第 3 条 `[0,0,0,0,0,0,0,2,0]` 被注释掉，**不生效**；
 * 最后两条 20260507 / 20260602 是新增布局。顺序不得调整。
 */
export declare const PHONE_LOGIN_PATHS: number[][];
/** 其他登录方式按钮（9 条路径）。 */
export declare const OTHER_LOGIN_PATHS: number[][];
/** 底部「我」（要求 ViewGroup 且可点击，3 条路径）。 */
export declare const BOTTOM_PROFILE_PATHS: number[][];
/** 区号按钮（5 条路径）。 */
export declare const COUNTRY_CODE_PATHS: number[][];
/** 清空手机号按钮（4 条路径）。 */
export declare const CLEAR_PHONE_PATHS: number[][];
/** 「验证并登录 / Next / Continue」按钮（7 条路径）。 */
export declare const VERIFY_LOGIN_PATHS: number[][];
/** 验证码输入框（4 条路径）。 */
export declare const VERIFICATION_CODE_PATHS: number[][];
/** 「同意并继续」弹窗按钮（4 条路径）。 */
export declare const AGREE_CONTINUE_PATHS: number[][];
/** rednote 欢迎弹窗 Agree（2 条路径）。 */
export declare const WELCOME_AGREE_PATHS: number[][];
/** 通知权限 ALLOW（1 条路径）。 */
export declare const NOTIFICATION_ALLOW_PATHS: number[][];
/** 手机号输入框（5 条路径，最后一条是 20260923 新版）。 */
export declare const PHONE_INPUT_PATHS: number[][];
/** 重发验证码按钮（4 条路径）。 */
export declare const RESEND_PATHS: number[][];
/** 手机号登录按钮：命中后必须排除 QQ / 微博（路径碰撞，旧实现 1768-1771）。 */
export declare function getPhoneLoginButtonPosition(root: UiNode): Point | null;
export declare function getOtherLoginMethodButtonPosition(root: UiNode): Point | null;
export declare function getBottomProfileButtonPosition(root: UiNode): Point | null;
/** 区号按钮：text 为空时取第一个非空子节点文本（旧实现 786-791）。 */
export declare function getCountryCodePosition(root: UiNode): (Point & {
    text: string;
}) | null;
export declare function getClearPhoneButtonPosition(root: UiNode): Point | null;
/** 「验证并登录」：旧实现返回带 enabled 与 text 的结构，用于判断发码是否失败。 */
export declare function getVerifyLoginButtonInfo(root: UiNode): (Point & {
    enabled: boolean;
    text: string;
}) | null;
export declare function getVerificationCodeInputPosition(root: UiNode): Point | null;
export declare function getAgreeContinueButtonPosition(root: UiNode): Point | null;
export declare function getRednoteWelcomeAgreeButtonPosition(root: UiNode): Point | null;
export declare function getRednoteNotificationAllowButtonPosition(root: UiNode): Point | null;
export declare function getPhoneInputPosition(root: UiNode): Point | null;
/** 重发按钮：旧实现返回 clickable 状态，用于判断是否仍需发码。 */
export declare function getResendButtonInfo(root: UiNode): (Point & {
    clickable: boolean;
}) | null;
//# sourceMappingURL=locators.d.ts.map