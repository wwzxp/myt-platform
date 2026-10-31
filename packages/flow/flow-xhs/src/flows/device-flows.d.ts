import type { FlowDefinition } from '@myt/flow';
import { type VerificationCodeSource } from '../steps/verification.ts';
/**
 * 改资料（`modify_info`）。
 *
 * 严格按旧顺序：推送头像 → 进编辑页 → 改名（最多 2 次，失败重启 App）→
 * 改头像（最多 2 次）→ 等转圈消失（最多 30s，超时也按成功）。
 */
export declare function createModifyProfileFlow(input: {
    nickname: string;
    avatarPath?: string | undefined;
    imageMode?: 'random' | 'last' | 'first' | undefined;
}): FlowDefinition;
/**
 * 关注账号（`follow_by_search_list`）。
 *
 * 每个关键词：搜索 → 切「用户」标签 → 找关注按钮 → 点击 → 复查未关注则再点一次。
 */
export declare function createFollowUserFlow(input: {
    keywords: string[];
    followCount: number;
}): FlowDefinition;
/**
 * 绑定手机号（`main_bind_phone`）。
 *
 * 顺序：3 轮找账号与安全页（已绑定则直接成功）→ 开绑定页 →
 * 区号 29 轮（不同才切换，含网络异常「不了」）→ 清除 → 输入手机号（5 次重试）→
 * 3 轮取码 + 输入。
 */
export declare function createBindPhoneFlow(input: {
    phone: string;
    countryCode: string;
    codeSource?: VerificationCodeSource | undefined;
    solveSafety?: ((image: Buffer) => Promise<number>) | undefined;
}): FlowDefinition;
/**
 * 设置「仅关注可评论」（移植自 `auto_modify_info.enable_only_following_comments`）。
 *
 * 旧实现：
 * ```
 * open_privacy_settings()          # xhsdiscover://settings/privacy
 * for _ in range(3):
 *     sw = get_only_allow_comments_switch_state(adb_ui())
 *     if sw and not sw["checked"]: tap(sw)
 *     sleep(0.5)
 * ```
 * 注意：旧版**只点关闭**，不检查点击后是否生效；这里保持一致（开关是幂等的，
 * 重复点 3 次不会把已关闭的又打开——只在 `checked` 为真时点）。
 */
export declare const setFollowingCommentsFlow: FlowDefinition;
//# sourceMappingURL=device-flows.d.ts.map