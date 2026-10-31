import { sleep } from '@myt/human';
import { clearInput, inputWithHumanLike, tapRepeatedly, waitSpinnerGone } from "../steps/actions.js";
import { generateRandomAdultBirthday, scrollBirthdateTo } from "../steps/birthday.js";
import { getAgreeContinueButtonPosition, getBottomProfileButtonPosition, getVerificationCodeInputPosition, getVerifyLoginButtonInfo, } from "../locators/locators.js";
import { getLaterButtonPosition, getRiskPluginGotItButtonPosition, getSeeOriginalButtonPosition, getSkipButtonPosition, } from "../steps/dialogs.js";
import { getBirthYearPosition } from "../locators/guide-locators.js";
import { getBirthdayNextButtonPosition } from "../steps/dialogs.js";
import { fetchVerificationCode, handleSafetyVerificationPage, } from "../steps/verification.js";
import { getResendButtonInfo, parseCountdownFromText, findSafetyVerificationGridCells } from "../locators/state-locators.js";
/** 与旧实现一致的常量（auto_login.py）。 */
export const MAX_CODE_ATTEMPTS = 6;
export const RESEND_DEADLINE_MS = 70_000;
export const STUCK_LIMIT = 10;
export const SEND_CODE_ROUNDS = 2;
export const MAX_LOGIN_ATTEMPTS = 2;
const XHS_PACKAGE = 'com.xingin.xhs';
/** 旧实现的 `_last_error_reason`：只有这个原因会让外层不再重试。 */
export const CODE_SEND_FAILED = '验证码发送失败';
export class FlowAbort extends Error {
    reason;
    constructor(message, reason) {
        super(message);
        this.name = 'FlowAbort';
        this.reason = reason;
    }
}
export function toActions(ctx) {
    return {
        serial: ctx.serial,
        device: ctx.device,
        runs: ctx.runs,
        runId: ctx.runId,
        random: ctx.random,
        humanPolicy: ctx.humanPolicy,
        snapshot: (options) => ctx.snapshot(options),
    };
}
/** 按钮文案是否属于「重发」类（旧实现 2722-2734 的判据）。 */
function isResendText(text) {
    return ['Resend', 'resend', '重新发送', '重发'].some((keyword) => text.includes(keyword));
}
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
export async function sendCodePhase(ctx, solve) {
    const act = toActions(ctx);
    for (let round = 1; round <= SEND_CODE_ROUNDS; round += 1) {
        let root = (await ctx.snapshot({ refresh: true })).root;
        if (getVerificationCodeInputPosition(root))
            return;
        const verify = getVerifyLoginButtonInfo(root);
        if (verify) {
            await tapRepeatedly(act, verify, 3);
            await waitSpinnerGone(act);
        }
        const agree = getAgreeContinueButtonPosition((await ctx.snapshot({ refresh: true })).root);
        if (agree)
            await ctx.device.tapLikeHuman(ctx.serial, agree.x, agree.y);
        const afterAgree = getVerifyLoginButtonInfo((await ctx.snapshot({ refresh: true })).root);
        if (afterAgree && afterAgree.enabled) {
            // 旧实现：按钮仍可点 → 再连点 5 轮 × 3 次，然后 continue（进入下一轮）
            for (let i = 0; i < 5; i += 1) {
                await sleep(ctx.random.int(300, 600));
                const again = getVerifyLoginButtonInfo((await ctx.snapshot({ refresh: true })).root);
                if (again && again.enabled) {
                    await tapRepeatedly(act, again, 3);
                }
            }
            continue;
        }
        let seenCodeInput = false;
        // k 循环：2 轮，0.5–2s
        for (let k = 1; k <= 2; k += 1) {
            root = (await ctx.snapshot({ refresh: true })).root;
            if (getVerificationCodeInputPosition(root)) {
                seenCodeInput = true;
                break;
            }
            if (getAgreeContinueButtonPosition(root))
                break;
            const login = getVerifyLoginButtonInfo(root);
            if (login && login.enabled)
                break;
            if (!getAgreeContinueButtonPosition(root) && !getVerificationCodeInputPosition(root) && solve) {
                if (!(await handleSafetyVerificationPage(act, solve))) {
                    ctx.runs.assertFailed(ctx.runId, 'send-code', '安全验证失败');
                    throw new Error('安全验证失败');
                }
                break;
            }
            await sleep(ctx.random.int(500, 2000));
        }
        if (seenCodeInput)
            return;
        // j 循环：2 轮，3–6s
        for (let j = 1; j <= 2; j += 1) {
            root = (await ctx.snapshot({ refresh: true })).root;
            if (getVerificationCodeInputPosition(root)) {
                seenCodeInput = true;
                break;
            }
            if (!getVerificationCodeInputPosition(root) && !getVerifyLoginButtonInfo(root) && solve) {
                if (await handleSafetyVerificationPage(act, solve))
                    break;
            }
            await sleep(ctx.random.int(3000, 6000));
        }
        if (seenCodeInput)
            return;
    }
    // 两轮仍未出现验证码框：旧实现在这里并不直接失败，交由后面的闸门判定
}
/**
 * 发码失败闸门（旧实现 2722-2734）。
 *
 * 有验证码框 → 不算失败；按钮文案是重发类 → 不算失败；
 * 否则按钮仍 enabled → 判定「验证码发送失败」。
 */
export async function assertCodeSent(ctx) {
    const root = (await ctx.snapshot({ refresh: true })).root;
    if (getVerificationCodeInputPosition(root))
        return;
    const login = getVerifyLoginButtonInfo(root);
    if (!login)
        return;
    if (isResendText(login.text))
        return;
    if (login.enabled) {
        ctx.runs.assertFailed(ctx.runId, 'assert-code-sent', CODE_SEND_FAILED);
        throw new FlowAbort(CODE_SEND_FAILED, CODE_SEND_FAILED);
    }
}
/**
 * 登录后引导页循环：直到进入「我的」（旧实现 2770-2900）。
 *
 * 分支顺序与旧实现一致：我的 → 生日 → Skip → 风险插件 → See original → Later
 * → 「验证并登录」仍在（验证码错误，抛出让上层重发）→ 同意并继续 → 卡住计数。
 */
export async function guideUntilHome(ctx, solve) {
    const act = toActions(ctx);
    let stuck = 0;
    for (;;) {
        const root = (await ctx.snapshot({ refresh: true })).root;
        const home = getBottomProfileButtonPosition(root);
        if (home) {
            await ctx.device.tapLikeHuman(ctx.serial, home.x, home.y);
            return;
        }
        if (getBirthYearPosition(root)) {
            for (let i = 1; i <= 2; i += 1) {
                if (!getBirthYearPosition((await ctx.snapshot({ refresh: true })).root))
                    break;
                if (i > 1) {
                    await ctx.device.forceStop(ctx.serial, XHS_PACKAGE);
                    await ctx.device.launchApp(ctx.serial, XHS_PACKAGE);
                }
                for (let wait = 0; wait < 30; wait += 1) {
                    if (getBirthYearPosition((await ctx.snapshot({ refresh: true })).root))
                        break;
                    await sleep(ctx.random.int(100, 400));
                }
                const target = generateRandomAdultBirthday(ctx.random);
                await scrollBirthdateTo(act, (await ctx.snapshot({ refresh: true })).root, target);
                await sleep(ctx.random.int(100, 400));
                const next = getBirthdayNextButtonPosition((await ctx.snapshot({ refresh: true })).root);
                if (next) {
                    await ctx.device.tapLikeHuman(ctx.serial, next.x, next.y);
                    await sleep(ctx.random.int(1000, 2000));
                    break;
                }
            }
            if (getBirthYearPosition((await ctx.snapshot({ refresh: true })).root)) {
                ctx.runs.assertFailed(ctx.runId, 'guide', '生日设置失败');
                throw new Error('生日设置失败');
            }
            continue;
        }
        const skip = getSkipButtonPosition(root);
        if (skip) {
            await ctx.device.tapLikeHuman(ctx.serial, skip.x, skip.y);
            stuck = 0;
            continue;
        }
        const risk = getRiskPluginGotItButtonPosition(root);
        if (risk) {
            await ctx.device.tapLikeHuman(ctx.serial, risk.x, risk.y);
            stuck = 0;
            continue;
        }
        const seeOriginal = getSeeOriginalButtonPosition(root);
        if (seeOriginal) {
            await ctx.device.tapLikeHuman(ctx.serial, seeOriginal.x, seeOriginal.y);
            stuck = 0;
            continue;
        }
        const later = getLaterButtonPosition(root);
        if (later) {
            await ctx.device.tapLikeHuman(ctx.serial, later.x, later.y);
            stuck = 0;
            continue;
        }
        const verify = getVerifyLoginButtonInfo(root);
        if (verify) {
            // 旧实现：这里 break 出引导循环，回到 6 轮重发，而不是判定失败。
            throw new CodeRejected('验证并登录按钮仍在，验证码可能不正确');
        }
        const agree = getAgreeContinueButtonPosition(root);
        if (agree) {
            await ctx.device.tapLikeHuman(ctx.serial, agree.x, agree.y);
            stuck = 0;
            continue;
        }
        // 旧实现该分支被注释（auto_login.py:2865-2866），仅当调用方注入 solve 时才启用。
        if (solve && (await findSafetyVerificationGridCells(root)).length === 6) {
            if (await handleSafetyVerificationPage(act, solve)) {
                stuck = 0;
                continue;
            }
        }
        stuck += 1;
        if (stuck >= STUCK_LIMIT) {
            ctx.runs.assertFailed(ctx.runId, 'guide', '连续 10 次未知页面，判定卡住');
            throw new FlowAbort('验证码输入后卡住（10 次）', CODE_SEND_FAILED);
        }
        await sleep(ctx.random.int(300, 800));
    }
}
/** 验证码被拒（需要重发），与「发送失败」区分。 */
export class CodeRejected extends Error {
    constructor(message) {
        super(message);
        this.name = 'CodeRejected';
    }
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
export function createCodeRetryStep(source, solve) {
    return {
        id: 'code-retry-loop',
        title: '输入验证码并处理重发（最多 6 轮）',
        async run(ctx) {
            if (!source) {
                ctx.runs.stepSkipped(ctx.runId, 'code-retry-loop', 'condition');
                return;
            }
            const act = toActions(ctx);
            for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt += 1) {
                let content = false;
                const resend = getResendButtonInfo((await ctx.snapshot({ refresh: true })).root);
                if (resend && resend.clickable) {
                    await tapRepeatedly(act, resend, 5);
                    await sleep(ctx.random.int(200, 500));
                    const after = getResendButtonInfo((await ctx.snapshot({ refresh: true })).root);
                    content = after && after.clickable ? false : ((await fetchVerificationCode(source)) ?? false);
                }
                else {
                    for (let i = 0; i < 5; i += 1) {
                        await sleep(ctx.random.int(300, 600));
                        const verify = getVerifyLoginButtonInfo((await ctx.snapshot({ refresh: true })).root);
                        if (verify && verify.enabled) {
                            await tapRepeatedly(act, verify, 3);
                        }
                    }
                    const agree = getAgreeContinueButtonPosition((await ctx.snapshot({ refresh: true })).root);
                    if (agree)
                        await ctx.device.tapLikeHuman(ctx.serial, agree.x, agree.y);
                    const verify = getVerifyLoginButtonInfo((await ctx.snapshot({ refresh: true })).root);
                    content = verify && verify.enabled ? false : ((await fetchVerificationCode(source)) ?? false);
                }
                if (content) {
                    const inputPos = getVerificationCodeInputPosition((await ctx.snapshot({ refresh: true })).root);
                    if (!inputPos) {
                        if (getBottomProfileButtonPosition((await ctx.snapshot({ refresh: true })).root))
                            return;
                    }
                    else {
                        // right_boundary = x + 100 → 实点 x + 80（旧实现 tap_with_human_like 内减 20）
                        await ctx.device.tapLikeHuman(ctx.serial, inputPos.x, inputPos.y, {
                            rightBoundary: inputPos.x + 100,
                        });
                        await clearInput(act, content);
                        const ok = await inputWithHumanLike(act, content, '验证码输入框');
                        if (!ok) {
                            ctx.runs.assertFailed(ctx.runId, 'code-retry-loop', '验证码输入校验失败');
                            throw new Error('验证码输入校验失败');
                        }
                        try {
                            await guideUntilHome(ctx, solve);
                            return;
                        }
                        catch (error) {
                            if (error instanceof CodeRejected) {
                                ctx.runs.stepRetried(ctx.runId, 'code-retry-loop', attempt, error.message);
                                // 继续走下面的 70s 重发等待
                            }
                            else {
                                throw error;
                            }
                        }
                    }
                }
                if (attempt >= MAX_CODE_ATTEMPTS) {
                    ctx.runs.assertFailed(ctx.runId, 'code-retry-loop', '验证码重试次数已用完');
                    throw new FlowAbort('验证码重试次数已用完', CODE_SEND_FAILED);
                }
                await waitForResendWindow(ctx, act);
            }
        },
    };
}
/** 70s 等待窗口：可点即点；否则点可用的「验证并登录」；再否则按倒计时等待。 */
export async function waitForResendWindow(ctx, act) {
    const deadline = Date.now() + RESEND_DEADLINE_MS;
    while (Date.now() < deadline) {
        const root = (await ctx.snapshot({ refresh: true })).root;
        if (getBottomProfileButtonPosition(root) && !getVerificationCodeInputPosition(root))
            return;
        const resend = getResendButtonInfo(root);
        if (resend && resend.clickable) {
            await ctx.device.tapLikeHuman(ctx.serial, resend.x, resend.y);
            await sleep(ctx.random.int(1000, 3000));
            return;
        }
        const verify = getVerifyLoginButtonInfo(root);
        if (verify && verify.enabled) {
            await tapRepeatedly(act, verify, 3);
            await sleep(ctx.random.int(1000, 3000));
            return;
        }
        const countdown = resend ? parseCountdownFromText(resend.text) : null;
        if (countdown !== null && countdown > 0) {
            await sleep(Math.min(countdown + 2, 30) * 1000);
        }
        else {
            await sleep(2000);
        }
    }
    ctx.runs.assertFailed(ctx.runId, 'resend-window', '等待重发按钮超时');
    throw new FlowAbort('等待重新发送按钮可点超时', CODE_SEND_FAILED);
}
/**
 * 外层重试（旧实现 `main_login` 3065-3095）。
 *
 * 语义必须一致：
 * - 最多 2 次；
 * - 只有 `FlowAbort.reason === CODE_SEND_FAILED` 时立即停止；
 * - 其余失败：`force-stop` 后重启再试。
 */
export async function loginWithRetry(ctx, runOnce, options = {}) {
    const maxAttempts = options.maxAttempts ?? MAX_LOGIN_ATTEMPTS;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await runOnce();
            await sleep(1000);
            return;
        }
        catch (error) {
            if (error instanceof FlowAbort && error.reason === CODE_SEND_FAILED)
                throw error;
            if (attempt >= maxAttempts)
                throw error;
            ctx.runs.stepRetried(ctx.runId, 'login-retry', attempt, error instanceof Error ? error.message : String(error));
            await ctx.device.forceStop(ctx.serial, XHS_PACKAGE);
            await sleep(1000);
        }
    }
}
//# sourceMappingURL=login-steps.js.map