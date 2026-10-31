import { nodeAtPath } from "../locators/paths.js";
function centerOf(node) {
    const [x1, y1, x2, y2] = node.bounds;
    return { x: Math.floor((x1 + x2) / 2), y: Math.floor((y1 + y2) / 2) };
}
/** 按多条路径找可点击节点。 */
function findByPaths(root, paths) {
    for (const path of paths) {
        const node = nodeAtPath(root, path);
        if (node && node.clickable)
            return node;
    }
    return null;
}
// ── 以下路径数组与 auto_login.py 完全一致，顺序不得调整 ──
/**
 * 手机号登录按钮（**10 条**，与 `auto_login.py:1739-1751` 一致）。
 *
 * 注意：Python 里第 3 条 `[0,0,0,0,0,0,0,2,0]` 被注释掉，**不生效**；
 * 最后两条 20260507 / 20260602 是新增布局。顺序不得调整。
 */
export const PHONE_LOGIN_PATHS = [
    [0, 0, 0, 0, 0, 0, 2, 0],
    [0, 0, 0, 0, 2, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 1],
    [0, 0, 0, 0, 0, 0, 1, 0, 0, 3, 0],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 2, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 1, 2, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0, 0],
];
/** 其他登录方式按钮（9 条路径）。 */
export const OTHER_LOGIN_PATHS = [
    [0, 0, 0, 0, 0, 0, 0, 1, 2, 0, 2],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 2],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 2],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 1],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 2, 0, 3],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 2, 0, 2],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 1],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 2, 0, 2],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 2, 0, 1],
];
/** 底部「我」（要求 ViewGroup 且可点击，3 条路径）。 */
export const BOTTOM_PROFILE_PATHS = [
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 4],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 4],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 4],
];
/** 区号按钮（5 条路径）。 */
export const COUNTRY_CODE_PATHS = [
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 2, 0],
    [0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 2, 0],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0],
    [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0],
];
/** 清空手机号按钮（4 条路径）。 */
export const CLEAR_PHONE_PATHS = [
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 2, 2],
    [0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 2, 2],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 2],
    [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 3],
];
/** 「验证并登录 / Next / Continue」按钮（7 条路径）。 */
export const VERIFY_LOGIN_PATHS = [
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 5],
    [0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 5],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 5],
    [0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 7],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 7],
    [0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
    [0, 0, 0, 0, 0, 0, 1, 0, 0, 2],
];
/** 验证码输入框（4 条路径）。 */
export const VERIFICATION_CODE_PATHS = [
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 4, 0],
    [0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 4, 0],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 4, 0],
    [0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],
];
/** 「同意并继续」弹窗按钮（4 条路径）。 */
export const AGREE_CONTINUE_PATHS = [
    [0, 0, 0, 0, 3],
    [0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 6, 0],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 8, 0],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 6, 0],
];
/** rednote 欢迎弹窗 Agree（2 条路径）。 */
export const WELCOME_AGREE_PATHS = [
    [0, 0, 0, 0, 0, 0, 0, 2, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 2],
];
/** 通知权限 ALLOW（1 条路径）。 */
export const NOTIFICATION_ALLOW_PATHS = [[0, 0, 0, 0, 0, 0, 1, 0]];
/** 手机号输入框（5 条路径，最后一条是 20260923 新版）。 */
export const PHONE_INPUT_PATHS = [
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 2, 1],
    [0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 2, 1],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 1],
    [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 2],
    [0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1],
];
/** 重发验证码按钮（4 条路径）。 */
export const RESEND_PATHS = [
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 4, 1],
    [0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 4, 1],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 4, 1],
    [0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
];
// ── 定位函数（返回与旧实现同构：Point | null / BoundedPoint | null） ──
/** 手机号登录按钮：命中后必须排除 QQ / 微博（路径碰撞，旧实现 1768-1771）。 */
export function getPhoneLoginButtonPosition(root) {
    for (const path of PHONE_LOGIN_PATHS) {
        const node = nodeAtPath(root, path);
        if (!node || !node.clickable)
            continue;
        const desc = node.contentDesc.toLowerCase();
        if (desc.includes('qq') || desc.includes('微博'))
            continue;
        return centerOf(node);
    }
    return null;
}
export function getOtherLoginMethodButtonPosition(root) {
    const node = findByPaths(root, OTHER_LOGIN_PATHS);
    return node ? centerOf(node) : null;
}
export function getBottomProfileButtonPosition(root) {
    for (const path of BOTTOM_PROFILE_PATHS) {
        const node = nodeAtPath(root, path);
        if (node && node.className === 'android.view.ViewGroup' && node.clickable) {
            return centerOf(node);
        }
    }
    return null;
}
/** 区号按钮：text 为空时取第一个非空子节点文本（旧实现 786-791）。 */
export function getCountryCodePosition(root) {
    for (const path of COUNTRY_CODE_PATHS) {
        const node = nodeAtPath(root, path);
        if (!node || !node.clickable)
            continue;
        let text = node.text;
        if (!text) {
            for (const child of node.children) {
                const childText = child.text.trim();
                if (childText) {
                    text = childText;
                    break;
                }
            }
        }
        return { ...centerOf(node), text };
    }
    return null;
}
export function getClearPhoneButtonPosition(root) {
    const node = findByPaths(root, CLEAR_PHONE_PATHS);
    return node ? centerOf(node) : null;
}
/** 「验证并登录」：旧实现返回带 enabled 与 text 的结构，用于判断发码是否失败。 */
export function getVerifyLoginButtonInfo(root) {
    const node = findByPaths(root, VERIFY_LOGIN_PATHS);
    if (!node)
        return null;
    return { ...centerOf(node), enabled: node.enabled, text: node.text };
}
export function getVerificationCodeInputPosition(root) {
    // 旧实现只要求 path 末节点 clickable（不校验 class）。
    const node = findByPaths(root, VERIFICATION_CODE_PATHS);
    return node ? centerOf(node) : null;
}
export function getAgreeContinueButtonPosition(root) {
    const node = findByPaths(root, AGREE_CONTINUE_PATHS);
    return node ? centerOf(node) : null;
}
export function getRednoteWelcomeAgreeButtonPosition(root) {
    for (const path of WELCOME_AGREE_PATHS) {
        const node = nodeAtPath(root, path);
        if (node &&
            node.clickable &&
            (node.className === 'android.widget.Button' || node.className === 'android.widget.TextView')) {
            return centerOf(node);
        }
    }
    return null;
}
export function getRednoteNotificationAllowButtonPosition(root) {
    const node = findByPaths(root, NOTIFICATION_ALLOW_PATHS);
    return node ? centerOf(node) : null;
}
export function getPhoneInputPosition(root) {
    const node = findByPaths(root, PHONE_INPUT_PATHS);
    return node ? centerOf(node) : null;
}
/** 重发按钮：旧实现返回 clickable 状态，用于判断是否仍需发码。 */
export function getResendButtonInfo(root) {
    for (const path of RESEND_PATHS) {
        const node = nodeAtPath(root, path);
        if (!node)
            continue;
        return { ...centerOf(node), clickable: node.clickable };
    }
    return null;
}
//# sourceMappingURL=locators.js.map