import type { FlowDefinition, StepContext } from '@myt/flow';
import { type ActionContext } from '../steps/actions.ts';
import { type VerificationCodeSource } from '../steps/verification.ts';
/** 与旧实现一致的常量（auto_login.py）。 */
export declare const MAX_CODE_ATTEMPTS = 6;
export declare const RESEND_DEADLINE_MS = 70000;
export declare const STUCK_LIMIT = 10;
export declare const SEND_CODE_ROUNDS = 2;
export declare const MAX_LOGIN_ATTEMPTS = 2;
/** 旧实现的 `_last_error_reason`：只有这个原因会让外层不再重试。 */
export declare const CODE_SEND_FAILED = "\u9A8C\u8BC1\u7801\u53D1\u9001\u5931\u8D25";
export declare class FlowAbort extends Error {
    readonly reason: string | undefined;
    constructor(message: string, reason?: string);
}
export declare function toActions(ctx: StepContext): ActionContext;
/**
 * 发码阶段（旧实现 2586-2700）。
 *
 * 严格按 2 轮：
 * 1. 有验证码框 → 结束；
 * 2. 点「验证并登录」3 次 + 等转圈；
 * 3. 点「同意并继续」；
 * 4. 若按钮仍 `enabled` → 连点 5 轮 × 3 次，判定「发送失败」并 `continue`；
 * 5. 否则 k 循环 2 轮（0.5–2s，安全验证失败即失败）、j 循环 2 轮（3–6s）。
 */
export declare function sendCodePhase(ctx: StepContext, solve?: (image: Buffer) => Promise<number>): Promise<void>;
/**
 * 发码失败闸门（旧实现 2722-2734）。
 *
 * 有验证码框 → 不算失败；按钮文案是重发类 → 不算失败；
 * 否则按钮仍 enabled → 判定「验证码发送失败」。
 */
export declare function assertCodeSent(ctx: StepContext): Promise<void>;
/**
 * 登录后引导页循环：直到进入「我的」（旧实现 2770-2900）。
 *
 * 分支顺序与旧实现一致：我的 → 生日 → Skip → 风险插件 → See original → Later
 * → 「验证并登录」仍在（验证码错误，抛出让上层重发）→ 同意并继续 → 卡住计数。
 */
export declare function guideUntilHome(ctx: StepContext, solve?: (image: Buffer) => Promise<number>): Promise<void>;
/** 验证码被拒（需要重发），与「发送失败」区分。 */
export declare class CodeRejected extends Error {
    constructor(message: string);
}
/**
 * 验证码输入与重发循环（旧实现 2763-2945，`max_code_attempts = 6`）。
 *
 * 与旧实现一致的关键点：
 * - 每次尝试前先看重发按钮；可点则连点 5 次，仍可点则不取码；
 * - 取到码 → 点框（`right_boundary = x+100`，实点 `x+80`）→ 清空 → 输入；
 * - 输入后进入引导页；若引导页判定「验证码被拒」→ 回到本轮重发等待；
 * - 6 轮用尽 → `code_retry_exhausted`。
 */
export declare function createCodeRetryStep(source: VerificationCodeSource | undefined, solve?: (image: Buffer) => Promise<number>): FlowDefinition['steps'][number];
/** 70s 等待窗口：可点即点；否则点可用的「验证并登录」；再否则按倒计时等待。 */
export declare function waitForResendWindow(ctx: StepContext, act: ActionContext): Promise<void>;
/**
 * 外层重试（旧实现 `main_login` 3065-3095）。
 *
 * 语义必须一致：
 * - 最多 2 次；
 * - 只有 `FlowAbort.reason === CODE_SEND_FAILED` 时立即停止；
 * - 其余失败：`force-stop` 后重启再试。
 */
export declare function loginWithRetry(ctx: StepContext, runOnce: () => Promise<void>, options?: {
    maxAttempts?: number;
}): Promise<void>;
//# sourceMappingURL=login-steps.d.ts.map