import { inputWithHumanLike, waitSpinnerGone } from "../steps/actions.js";
import { sleep } from '@myt/human';
import { getOnlyAllowCommentsSwitchState } from "../locators/bind-phone-locators.js";
import { getBottomProfileButtonPosition, getClearPhoneButtonPosition, getCountryCodePosition, getPhoneInputPosition, getVerificationCodeInputPosition, getVerifyLoginButtonInfo, } from "../locators/locators.js";
import { getCountryCodeList, getResendButtonInfo } from "../locators/state-locators.js";
import { getNetworkErrorCancelButtonPosition } from "../locators/guide-locators.js";
import { getAllImagePositions, getAvatarPosition, getEditNameInputPosition, getEditNamePosition, getImageSaveButtonPosition, getLoadingSpinnerPosition, getSaveButtonPosition, getUploadAvatarButtonPosition, pickImagePosition, } from "../locators/profile-locators.js";
import { getFollowButtonPosition, getFollowingButtonPosition, getUsersTabPosition, } from "../locators/follow-locators.js";
import { handleSafetyVerificationPage, fetchVerificationCode } from "../steps/verification.js";
import { isAccountSecurityPage, isPhoneBound } from "../locators/bind-phone-locators.js";
const XHS_PACKAGE = 'com.xingin.xhs';
const DEEPLINK = {
    editProfile: 'xhsdiscover://edit_profile/',
    accountSecurity: 'xhsdiscover://security_account_page',
    bindPhone: 'xhsdiscover://security_account_operation?operateType=bind_phone',
    search: (keyword) => `xhsdiscover://search/result?keyword=${encodeURIComponent(keyword)}`,
    profile: 'xhsdiscover://profile',
};
function toActions(ctx) {
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
/** 打开深链（旧 `open_deep_link`：am start + RouterPageActivity）。 */
async function openDeepLink(ctx, uri) {
    await ctx.device.openUri(ctx.serial, uri, XHS_PACKAGE);
    await sleep(ctx.random.int(800, 1500));
}
/**
 * 进入编辑资料页。
 *
 * 旧实现只有深链；实测当前版本会先弹「个人信息保护提示」（同意 / 不同意），
 * 弹窗不关则编辑页永远出不来。这里补上该弹窗的关闭动作（**新增行为，非旧代码**）。
 */
async function navigateToEditProfile(ctx) {
    await openDeepLink(ctx, DEEPLINK.editProfile);
    let agreed = false;
    for (let i = 0; i < 8; i += 1) {
        await sleep(ctx.random.int(300, 800));
        const root = (await ctx.snapshot({ refresh: true })).root;
        if (getEditNamePosition(root) || getAvatarPosition(root))
            return;
        if (!agreed) {
            const agree = findClickableText(root, ['同意', 'Agree']);
            if (agree) {
                await ctx.device.tapLikeHuman(ctx.serial, agree.x, agree.y);
                agreed = true;
                continue;
            }
        }
    }
    throw new Error('未能进入编辑资料页（可能被弹窗阻塞）');
}
/**
 * 是否已登录。
 *
 * 判据：首页存在「去登录」入口即为未登录（旧实现在已登录时不会出现该文案）。
 * 这是**前置检查**，不是旧代码搬运——旧实现由登录链保证顺序，
 * 这里显式拦截，避免把「未登录导致页面退回」误报成流程失败。
 */
function looksLoggedOut(root) {
    let found = false;
    const visit = (node) => {
        if (found)
            return;
        if (node.text.trim() === '去登录') {
            found = true;
            return;
        }
        node.children.forEach(visit);
    };
    visit(root);
    return found;
}
/** 按文案找可点击节点（用于关闭一次性弹窗）。 */
function findClickableText(root, texts) {
    for (const text of texts) {
        let hit = null;
        const visit = (node) => {
            if (hit)
                return;
            if (node.text.trim() === text) {
                const [x1, y1, x2, y2] = node.bounds;
                hit = { x: Math.floor((x1 + x2) / 2), y: Math.floor((y1 + y2) / 2) };
                return;
            }
            node.children.forEach(visit);
        };
        visit(root);
        if (hit)
            return hit;
    }
    return null;
}
/**
 * 改资料（`modify_info`）。
 *
 * 严格按旧顺序：推送头像 → 进编辑页 → 改名（最多 2 次，失败重启 App）→
 * 改头像（最多 2 次）→ 等转圈消失（最多 30s，超时也按成功）。
 */
export function createModifyProfileFlow(input) {
    const imageMode = input.imageMode ?? 'last';
    return {
        id: 'xhs.device.modify-profile',
        title: `修改资料（昵称=${input.nickname}${input.avatarPath ? ' + 头像' : ''}）`,
        steps: [
            {
                id: 'connect',
                title: '确保 ADB 已连接',
                retries: 2,
                async run(ctx) {
                    await ctx.device.connect(ctx.serial);
                },
            },
            {
                id: 'require-login',
                title: '确认设备已登录（未登录时编辑页会退回首页）',
                async run(ctx) {
                    const root = (await ctx.snapshot({ refresh: true })).root;
                    if (looksLoggedOut(root)) {
                        ctx.runs.assertFailed(ctx.runId, 'require-login', '设备未登录，无法修改资料');
                        throw new Error('设备未登录：请先执行登录流程');
                    }
                },
            },
            {
                id: 'push-avatar',
                title: '推送头像到设备相册',
                async run(ctx) {
                    if (!input.avatarPath) {
                        ctx.runs.stepSkipped(ctx.runId, 'push-avatar', 'condition');
                        return;
                    }
                    await ctx.device.pushToGallery(ctx.serial, input.avatarPath);
                    await sleep(ctx.random.int(500, 1500));
                },
            },
            {
                id: 'rename',
                title: '修改昵称（最多 2 次）',
                async run(ctx) {
                    const act = toActions(ctx);
                    for (let attempt = 1; attempt <= 2; attempt += 1) {
                        try {
                            await navigateToEditProfile(ctx);
                            const namePos = getEditNamePosition((await ctx.snapshot({ refresh: true })).root);
                            if (!namePos)
                                throw new Error('未找到昵称入口');
                            await ctx.device.tapLikeHuman(ctx.serial, namePos.x, namePos.y);
                            await sleep(ctx.random.int(300, 800));
                            const inputPos = getEditNameInputPosition((await ctx.snapshot({ refresh: true })).root);
                            if (!inputPos)
                                throw new Error('未找到昵称输入框');
                            await ctx.device.tapLikeHuman(ctx.serial, inputPos.x, inputPos.y, {
                                rightBoundary: inputPos.x + 150,
                            });
                            if (!(await inputWithHumanLike(act, input.nickname, '昵称输入框'))) {
                                throw new Error('昵称输入校验失败');
                            }
                            const save = getSaveButtonPosition((await ctx.snapshot({ refresh: true })).root);
                            if (!save)
                                throw new Error('未找到保存按钮');
                            await ctx.device.tapLikeHuman(ctx.serial, save.x, save.y);
                            await sleep(1000);
                            return;
                        }
                        catch (error) {
                            if (attempt >= 2)
                                throw error;
                            ctx.runs.stepRetried(ctx.runId, 'rename', attempt, error instanceof Error ? error.message : '');
                            await ctx.device.forceStop(ctx.serial, XHS_PACKAGE);
                            await sleep(ctx.random.int(500, 1500));
                        }
                    }
                },
            },
            {
                id: 'change-avatar',
                title: '修改头像（最多 2 次）',
                async run(ctx) {
                    if (!input.avatarPath) {
                        ctx.runs.stepSkipped(ctx.runId, 'change-avatar', 'condition');
                        return;
                    }
                    for (let attempt = 1; attempt <= 2; attempt += 1) {
                        try {
                            await navigateToEditProfile(ctx);
                            const avatarPos = getAvatarPosition((await ctx.snapshot({ refresh: true })).root);
                            if (!avatarPos)
                                throw new Error('未找到头像入口');
                            await ctx.device.tapLikeHuman(ctx.serial, avatarPos.x, avatarPos.y);
                            await sleep(ctx.random.int(500, 1200));
                            const upload = getUploadAvatarButtonPosition((await ctx.snapshot({ refresh: true })).root);
                            if (!upload)
                                throw new Error('未找到「上传新头像」');
                            await ctx.device.tapLikeHuman(ctx.serial, upload.x, upload.y);
                            await sleep(ctx.random.int(800, 1500));
                            const images = getAllImagePositions((await ctx.snapshot({ refresh: true })).root);
                            const pick = pickImagePosition(images, imageMode, () => ctx.random.next());
                            if (!pick)
                                throw new Error('图库没有可选图片');
                            await ctx.device.tapLikeHuman(ctx.serial, pick.x, pick.y, { bounds: pick.bounds });
                            await sleep(ctx.random.int(300, 800));
                            const save = getImageSaveButtonPosition((await ctx.snapshot({ refresh: true })).root);
                            if (!save)
                                throw new Error('未找到图片保存按钮');
                            await ctx.device.tapLikeHuman(ctx.serial, save.x, save.y);
                            await sleep(1000);
                            return;
                        }
                        catch (error) {
                            if (attempt >= 2)
                                throw error;
                            ctx.runs.stepRetried(ctx.runId, 'change-avatar', attempt, error instanceof Error ? error.message : '');
                            await ctx.device.forceStop(ctx.serial, XHS_PACKAGE);
                            await sleep(ctx.random.int(500, 1500));
                        }
                    }
                },
            },
            {
                id: 'wait-loading-gone',
                title: '等待上传转圈消失（最多 30s）',
                async run(ctx) {
                    let waited = 0;
                    while (waited < 30) {
                        const root = (await ctx.snapshot({ refresh: true })).root;
                        if (!getLoadingSpinnerPosition(root))
                            return;
                        await sleep(1000);
                        waited += 1;
                    }
                    // 旧实现超时也只打印警告并返回 True。
                    ctx.runs.stepSucceeded(ctx.runId, 'wait-loading-gone', 0, '等待转圈超时 30s，按旧实现继续');
                },
            },
        ],
    };
}
/**
 * 关注账号（`follow_by_search_list`）。
 *
 * 每个关键词：搜索 → 切「用户」标签 → 找关注按钮 → 点击 → 复查未关注则再点一次。
 */
export function createFollowUserFlow(input) {
    return {
        id: 'xhs.device.follow',
        title: `关注账号（${input.keywords.length} 个关键词，上限 ${input.followCount}）`,
        steps: [
            {
                id: 'connect',
                title: '确保 ADB 已连接',
                retries: 2,
                async run(ctx) {
                    await ctx.device.connect(ctx.serial);
                },
            },
            {
                id: 'require-login',
                title: '确认设备已登录',
                async run(ctx) {
                    const root = (await ctx.snapshot({ refresh: true })).root;
                    if (looksLoggedOut(root)) {
                        ctx.runs.assertFailed(ctx.runId, 'require-login', '设备未登录，无法关注');
                        throw new Error('设备未登录：请先执行登录流程');
                    }
                },
            },
            {
                id: 'follow-each',
                title: '逐个关键词关注',
                async run(ctx) {
                    let total = 0;
                    for (const keyword of input.keywords) {
                        if (total >= input.followCount)
                            break;
                        await openDeepLink(ctx, DEEPLINK.search(keyword));
                        let followed = false;
                        for (let i = 0; i < 9; i += 1) {
                            await sleep(ctx.random.int(100, 500));
                            const root = (await ctx.snapshot({ refresh: true })).root;
                            const usersTab = getUsersTabPosition(root);
                            if (usersTab) {
                                await ctx.device.tapLikeHuman(ctx.serial, usersTab.x, usersTab.y);
                                await sleep(ctx.random.int(300, 800));
                            }
                            const after = (await ctx.snapshot({ refresh: true })).root;
                            if (getFollowingButtonPosition(after)) {
                                followed = true;
                                break;
                            }
                            const follow = getFollowButtonPosition(after);
                            if (follow) {
                                await ctx.device.tapLikeHuman(ctx.serial, follow.x, follow.y);
                                await sleep(ctx.random.int(500, 1000));
                                // 旧实现：点完复查，仍未关注则再点一次。
                                if (!getFollowingButtonPosition((await ctx.snapshot({ refresh: true })).root)) {
                                    await ctx.device.tapLikeHuman(ctx.serial, follow.x, follow.y);
                                }
                                followed = true;
                                break;
                            }
                        }
                        if (followed)
                            total += 1;
                        await sleep(ctx.random.int(1000, 2000));
                    }
                    if (total === 0) {
                        ctx.runs.assertFailed(ctx.runId, 'follow-each', '所有关键词都未关注成功');
                        throw new Error('关注失败：0 个成功');
                    }
                },
            },
        ],
    };
}
/**
 * 绑定手机号（`main_bind_phone`）。
 *
 * 顺序：3 轮找账号与安全页（已绑定则直接成功）→ 开绑定页 →
 * 区号 29 轮（不同才切换，含网络异常「不了」）→ 清除 → 输入手机号（5 次重试）→
 * 3 轮取码 + 输入。
 */
export function createBindPhoneFlow(input) {
    return {
        id: 'xhs.device.bind-phone',
        title: `绑定手机号（${input.countryCode} ${input.phone}）`,
        steps: [
            {
                id: 'connect',
                title: '确保 ADB 已连接',
                retries: 2,
                async run(ctx) {
                    await ctx.device.connect(ctx.serial);
                },
            },
            {
                id: 'open-security',
                title: '进入账号与安全页，检测是否已绑定',
                retries: 1,
                async run(ctx) {
                    let found = false;
                    let bound = false;
                    for (let attempt = 1; attempt <= 3; attempt += 1) {
                        if (attempt > 1) {
                            await ctx.device.forceStop(ctx.serial, XHS_PACKAGE);
                            await sleep(ctx.random.int(1000, 2000));
                        }
                        await openDeepLink(ctx, DEEPLINK.profile);
                        for (let i = 0; i < 5; i += 1) {
                            await sleep(ctx.random.int(1000, 3000));
                            if (getBottomProfileButtonPosition((await ctx.snapshot({ refresh: true })).root))
                                break;
                        }
                        await openDeepLink(ctx, DEEPLINK.accountSecurity);
                        for (let i = 0; i < 10; i += 1) {
                            await sleep(ctx.random.int(300, 500));
                            const root = (await ctx.snapshot({ refresh: true })).root;
                            if (isAccountSecurityPage(root)) {
                                bound = isPhoneBound(root);
                                found = true;
                                break;
                            }
                        }
                        if (found)
                            break;
                    }
                    if (!found)
                        throw new Error('未进入账号与安全页（3 轮）');
                    if (bound) {
                        ctx.runs.stepSucceeded(ctx.runId, 'open-security', 0, '该账号已绑定手机号，跳过后续步骤');
                    }
                },
            },
            {
                id: 'open-bind-page',
                title: '打开绑定手机号页',
                async run(ctx) {
                    const root = (await ctx.snapshot({ refresh: true })).root;
                    if (isPhoneBound(root)) {
                        ctx.runs.stepSkipped(ctx.runId, 'open-bind-page', 'condition');
                        return;
                    }
                    await openDeepLink(ctx, DEEPLINK.bindPhone);
                },
            },
            {
                id: 'wait-country-code',
                title: '等待区号按钮（29 轮）',
                retries: 1,
                async run(ctx) {
                    const root = (await ctx.snapshot({ refresh: true })).root;
                    if (isPhoneBound(root)) {
                        ctx.runs.stepSkipped(ctx.runId, 'wait-country-code', 'condition');
                        return;
                    }
                    for (let i = 0; i < 29; i += 1) {
                        await sleep(ctx.random.int(600, 1500));
                        const code = getCountryCodePosition((await ctx.snapshot({ refresh: true })).root);
                        if (code) {
                            ctx.runs.stepSucceeded(ctx.runId, 'wait-country-code', 0, `区号=${code.text}`);
                            return;
                        }
                    }
                    throw new Error('没有国家区号（29 轮）');
                },
            },
            {
                id: 'select-country-code',
                title: '选择区号（仅当不同）',
                async run(ctx) {
                    const root = (await ctx.snapshot({ refresh: true })).root;
                    if (isPhoneBound(root)) {
                        ctx.runs.stepSkipped(ctx.runId, 'select-country-code', 'condition');
                        return;
                    }
                    const current = getCountryCodePosition(root);
                    if (!current)
                        throw new Error('未找到区号按钮');
                    if (current.text === input.countryCode) {
                        ctx.runs.stepSkipped(ctx.runId, 'select-country-code', 'condition');
                        return;
                    }
                    await ctx.device.tapLikeHuman(ctx.serial, current.x, current.y);
                    let entries = getCountryCodeList((await ctx.snapshot({ refresh: true })).root);
                    for (let i = 0; i < 5 && entries.length === 0; i += 1) {
                        const snapshotRoot = (await ctx.snapshot({ refresh: true })).root;
                        entries = getCountryCodeList(snapshotRoot);
                        if (entries.length > 0)
                            break;
                        const cancel = getNetworkErrorCancelButtonPosition(snapshotRoot);
                        if (cancel) {
                            await ctx.device.tapLikeHuman(ctx.serial, cancel.x, cancel.y);
                            break;
                        }
                        await sleep(ctx.random.int(500, 1200));
                    }
                    if (entries.length > 0) {
                        const target = entries.find((item) => item.code === input.countryCode);
                        if (target) {
                            await ctx.device.tapLikeHuman(ctx.serial, target.x, target.y, { bounds: target.bounds });
                            await sleep(ctx.random.int(600, 1500));
                        }
                    }
                },
            },
            {
                id: 'clear-and-input-phone',
                title: '清空并输入手机号（5 次重试）',
                retries: 1,
                async run(ctx) {
                    const act = toActions(ctx);
                    const root = (await ctx.snapshot({ refresh: true })).root;
                    if (isPhoneBound(root)) {
                        ctx.runs.stepSkipped(ctx.runId, 'clear-and-input-phone', 'condition');
                        return;
                    }
                    const clear = getClearPhoneButtonPosition(root);
                    if (clear)
                        await ctx.device.tapLikeHuman(ctx.serial, clear.x, clear.y);
                    const inputPos = getPhoneInputPosition((await ctx.snapshot({ refresh: true })).root);
                    if (!inputPos)
                        throw new Error('未找到手机号输入框');
                    await ctx.device.tapLikeHuman(ctx.serial, inputPos.x + 130, inputPos.y);
                    if (!(await inputWithHumanLike(act, input.phone, '手机号输入框'))) {
                        throw new Error('手机号输入校验失败');
                    }
                },
            },
            {
                id: 'code-loop',
                title: '取码并输入（最多 3 轮）',
                async run(ctx) {
                    if (!input.codeSource) {
                        ctx.runs.stepSkipped(ctx.runId, 'code-loop', 'condition');
                        return;
                    }
                    const act = toActions(ctx);
                    for (let attempt = 1; attempt <= 3; attempt += 1) {
                        const resend = getResendButtonInfo((await ctx.snapshot({ refresh: true })).root);
                        if (resend) {
                            await ctx.device.tapLikeHuman(ctx.serial, resend.x, resend.y);
                        }
                        await sleep(ctx.random.int(200, 500));
                        // k 循环：2 轮，确认验证码框出现
                        let ready = false;
                        for (let k = 0; k < 2; k += 1) {
                            const root = (await ctx.snapshot({ refresh: true })).root;
                            if (getVerificationCodeInputPosition(root)) {
                                ready = true;
                                break;
                            }
                            const verify = getVerifyLoginButtonInfo(root);
                            if (verify && verify.enabled)
                                break;
                            if (!getVerificationCodeInputPosition(root) && input.solveSafety) {
                                if (!(await handleSafetyVerificationPage(act, input.solveSafety)))
                                    break;
                            }
                            await sleep(ctx.random.int(500, 2000));
                        }
                        if (!ready)
                            continue;
                        const code = await fetchVerificationCode(input.codeSource);
                        if (!code)
                            continue;
                        const inputPos = getVerificationCodeInputPosition((await ctx.snapshot({ refresh: true })).root);
                        if (!inputPos)
                            continue;
                        await ctx.device.tapLikeHuman(ctx.serial, inputPos.x, inputPos.y, {
                            rightBoundary: inputPos.x + 100,
                        });
                        if (!(await inputWithHumanLike(act, code, '验证码输入框')))
                            continue;
                        await waitSpinnerGone(act);
                        // 成功判据：离开绑定页（旧实现在循环末尾 return True）
                        const after = (await ctx.snapshot({ refresh: true })).root;
                        if (isPhoneBound(after))
                            return;
                    }
                    ctx.runs.assertFailed(ctx.runId, 'code-loop', '3 轮内未能完成绑定');
                    throw new Error('绑定失败：3 轮取码未成功');
                },
            },
        ],
    };
}
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
export const setFollowingCommentsFlow = {
    id: 'xhs.device.following-comments',
    title: '设置仅关注可评论',
    steps: [
        {
            id: 'connect',
            title: '确保 ADB 已连接',
            retries: 2,
            async run(ctx) {
                await ctx.device.connect(ctx.serial);
            },
        },
        {
            id: 'open-privacy',
            title: '打开设置-隐私页',
            async run(ctx) {
                await openDeepLink(ctx, 'xhsdiscover://settings/privacy');
                await sleep(ctx.random.int(1200, 2200));
            },
        },
        {
            id: 'toggle-off',
            title: '关闭「仅关注可评论」（最多 3 轮）',
            async run(ctx) {
                for (let i = 0; i < 3; i += 1) {
                    const root = (await ctx.snapshot({ refresh: true })).root;
                    const sw = getOnlyAllowCommentsSwitchState(root);
                    if (sw && !sw.checked) {
                        await ctx.device.tapLikeHuman(ctx.serial, sw.x, sw.y);
                    }
                    await sleep(500);
                    ctx.throwIfCancelled();
                }
                return '已处理 3 轮';
            },
        },
    ],
};
//# sourceMappingURL=device-flows.js.map