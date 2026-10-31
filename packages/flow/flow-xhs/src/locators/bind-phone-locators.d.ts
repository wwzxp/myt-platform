import type { UiNode } from '@myt/device';
import { type Point } from '../locators/paths.ts';
/** 手机号行的标签（account_bind_phone.py:594）。静态查找表用 Record。 */
export declare const PHONE_LABELS: Record<string, true>;
/** 手机号行的父节点路径（`_find_phone_value_text` 的 parent_paths）。 */
export declare const PHONE_ROW_PATHS: number[][];
/**
 * 找手机号行的值文本。
 *
 * 移植自 `_find_phone_value_text`：
 * 1. 先按两条父路径取容器，要求 `children[0].text ∈ PHONE_LABELS`，返回 `children[1].text`；
 * 2. 兜底：全树搜索标签节点（必须是 TextView），返回其**下一个兄弟**的 text。
 *
 * 找到行但值为空 → `''`；未找到 → `null`。
 */
export declare function findPhoneValueText(root: UiNode): string | null;
/** 是否为账号与安全页（手机号行存在即成立）。 */
export declare function isAccountSecurityPage(root: UiNode): boolean;
/**
 * 手机号是否已绑定：值匹配 `^\+[\d*]+$`（旧实现 646-662）。
 * 未找到行或值为空都算未绑定。
 */
export declare function isPhoneBound(root: UiNode): boolean;
/** 只有关注可评论的开关状态读取（`get_only_allow_comments_switch_state`）。 */
export declare const ONLY_COMMENTS_PATHS: number[][];
export interface SwitchState extends Point {
    checked: boolean;
}
/** 读「仅关注可评论」开关；未找到返回 null。 */
export declare function getOnlyAllowCommentsSwitchState(root: UiNode): SwitchState | null;
//# sourceMappingURL=bind-phone-locators.d.ts.map