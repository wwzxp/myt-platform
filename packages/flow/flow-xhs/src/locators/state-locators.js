import { nodeAtPath } from "../locators/paths.js";
/**
 * 需要读取节点内容/状态的定位函数（**1:1 移植**自 auto_login.py）。
 *
 * 与 locators.ts 的区别：这里不仅返回坐标，还要判断「是否可点击」「文本内容」
 * 「是否在加载」等状态，用于流程里的分支决策。
 */
function centerOf(node) {
    const [x1, y1, x2, y2] = node.bounds;
    return { x: Math.floor((x1 + x2) / 2), y: Math.floor((y1 + y2) / 2) };
}
function walk(node, visit) {
    visit(node);
    for (const child of node.children)
        walk(child, visit);
}
// ── 区号列表（get_country_code_list） ──
/** 区号列表页的 ListView 路径（1 条，与旧实现一致）。 */
export const COUNTRY_LIST_PATH = [0, 0, 0, 0, 0, 0, 0, 1, 0, 0];
/**
 * 解析区号列表。
 *
 * 旧实现结构假设：ListView → FrameLayout 项 → [0]=国家名 TextView，[1]=区号 TextView。
 * 解析不到返回空数组（旧实现同样返回 `results` 而不会抛错）。
 */
export function getCountryCodeList(root) {
    const listView = nodeAtPath(root, COUNTRY_LIST_PATH);
    if (!listView || listView.className !== 'android.widget.ListView')
        return [];
    const results = [];
    for (const child of listView.children) {
        if (child.className !== 'android.widget.FrameLayout')
            continue;
        if (child.children.length < 2)
            continue;
        const nameNode = child.children[0];
        const codeNode = child.children[1];
        if (!nameNode || !codeNode)
            continue;
        if (nameNode.className !== 'android.widget.TextView')
            continue;
        if (codeNode.className !== 'android.widget.TextView')
            continue;
        const country = nameNode.text.trim();
        const code = codeNode.text.trim();
        if (!country || !code)
            continue;
        results.push({ ...centerOf(child), country, code, bounds: child.bounds, text: country });
    }
    return results;
}
// ── 重发按钮（get_resend_button_info，需 clickable + text） ──
export const RESEND_BUTTON_PATHS = [
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 4, 1],
    [0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 4, 1],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 4, 1],
    [0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
];
/**
 * 重发按钮信息。
 *
 * 关键细节（旧实现注释）：可点击状态以**父 Button** 为准，
 * 子 TextView 在倒计时禁用态也可能 `enabled=true`，不能用子节点判断。
 */
export function getResendButtonInfo(root) {
    for (const path of RESEND_BUTTON_PATHS) {
        const node = nodeAtPath(root, path);
        if (!node)
            continue;
        let text = node.text;
        if (!text) {
            const first = node.children[0];
            if (first && first.className === 'android.widget.TextView')
                text = first.text;
        }
        return {
            ...centerOf(node),
            clickable: node.enabled && node.clickable,
            text,
        };
    }
    return null;
}
/** 从按钮文案提取倒计时秒数；无数字时返回 null（表示可点击）。 */
export function parseCountdownFromText(text) {
    const match = /\d+/.exec(text);
    return match ? Number(match[0]) : null;
}
// ── 聚焦输入框内容（get_focused_input_content） ──
export const FOCUSED_INPUT_PATHS = [
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 2, 1],
    [0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 2, 1],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 1],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 4, 0],
    [0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 4, 0],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 4, 0],
    [0, 0, 0, 0, 0, 0, 1, 3, 2, 0],
];
/** 读当前聚焦输入框的文本；未找到返回 null（旧实现语义）。 */
export function getFocusedInputContent(root) {
    for (const path of FOCUSED_INPUT_PATHS) {
        const node = nodeAtPath(root, path);
        if (!node)
            continue;
        if (node.className === 'android.widget.EditText' && node.focused)
            return node.text;
    }
    return null;
}
// ── 账号下线弹窗（is_account_offline_dialog） ──
/**
 * 账号下线弹窗判定：**只按层级结构，不校验文字**（旧实现如此）。
 * 路径 [0,0,0,0] 的节点需有 ≥4 个子节点，且第 4 个可点击。
 */
export function isAccountOfflineDialog(root) {
    const target = nodeAtPath(root, [0, 0, 0, 0]);
    if (!target)
        return false;
    const fourth = target.children[3];
    return target.children.length >= 4 && !!fourth && fourth.clickable;
}
// ── 加载转圈（is_loading_spinner_present） ──
/**
 * 判断页面是否在加载转圈。
 *
 * 旧实现的判据：
 * - 先找 ≥200×200 的 FrameLayout 作为「全屏参照」；
 * - 找 40–160 px 见方、宽高差 ≤20 的 ImageView；
 * - 有全屏参照时要求该图中心距屏幕中心 ≤22%；
 * - 无全屏参照时要求整页节点数 ≤15（纯加载页）。
 */
export function isLoadingSpinnerPresent(root) {
    let screen = null;
    // 旧实现用 `root.iter()`，包含 `<hierarchy>` 元素本身；这里 +1 对齐。
    let nodeCount = 1;
    walk(root, (node) => {
        nodeCount += 1;
        if (screen)
            return;
        if (node.className !== 'android.widget.FrameLayout')
            return;
        const [x1, y1, x2, y2] = node.bounds;
        const w = x2 - x1;
        const h = y2 - y1;
        if (w >= 200 && h >= 200)
            screen = { w, h };
    });
    let found = false;
    walk(root, (node) => {
        if (found)
            return;
        if (node.className !== 'android.widget.ImageView')
            return;
        const [x1, y1, x2, y2] = node.bounds;
        const w = x2 - x1;
        const h = y2 - y1;
        if (!(w >= 40 && w <= 160 && h >= 40 && h <= 160 && Math.abs(w - h) <= 20))
            return;
        const cx = Math.floor((x1 + x2) / 2);
        const cy = Math.floor((y1 + y2) / 2);
        if (screen) {
            const reference = screen;
            if (Math.abs(cx - Math.floor(reference.w / 2)) <= reference.w * 0.22 &&
                Math.abs(cy - Math.floor(reference.h / 2)) <= reference.h * 0.22) {
                found = true;
            }
        }
        else if (nodeCount <= 15) {
            found = true;
        }
    });
    return found;
}
// ── 安全验证页（is_safety_verification_page / 6 宫格） ──
/** 安全验证网格容器的路径（3 条，与旧实现一致）。 */
export const SAFETY_GRID_PATHS = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 2],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 2],
];
function delay(ms) {
    const { promise, resolve } = Promise.withResolvers();
    setTimeout(resolve, ms);
    return promise;
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
export async function findSafetyVerificationGridCells(root) {
    for (const path of SAFETY_GRID_PATHS) {
        const container = nodeAtPath(root, path);
        if (!container)
            continue;
        const children = container.children;
        if (children.length !== 6)
            continue;
        const cells = [];
        let valid = true;
        for (let i = 0; i < children.length; i += 1) {
            const child = children[i];
            if (!child) {
                valid = false;
                break;
            }
            const cls = child.className;
            const inner = child.children;
            let selected = false;
            if (cls === 'android.view.ViewGroup') {
                // 旧结构：ViewGroup 容器 + Button 子节点
                const button = inner[0];
                if (!button || button.className !== 'android.widget.Button') {
                    valid = false;
                    break;
                }
                selected = isSelectedOrChecked(child) || isSelectedOrChecked(button) || hasSelectionBadge(button);
            }
            else if (cls === 'android.view.View' && child.clickable) {
                // 新结构（WebView）：View(clickable) 直接包裹 Image
                selected = isSelectedOrChecked(child) || inner.length > 2;
            }
            else if (cls === 'android.view.View' &&
                !child.clickable &&
                inner[0]?.className === 'android.widget.Image') {
                // 新结构（WebView-v2）：View(非 clickable) 包裹 Image
                selected = isSelectedOrChecked(child) || inner.length > 2;
            }
            else {
                valid = false;
                break;
            }
            const [x1, y1, x2, y2] = child.bounds;
            cells.push({
                index: i + 1,
                x: Math.floor((x1 + x2) / 2),
                y: Math.floor((y1 + y2) / 2),
                bounds: child.bounds,
                selected,
            });
        }
        if (valid && cells.length === 6) {
            // 旧实现（auto_login.py:574-576）：识别到网格后固定等 10 秒再返回。
            // 这是为了让图片加载完成后再截图识图，不能省略。
            await delay(10_000);
            return cells;
        }
    }
    return [];
}
function isSelectedOrChecked(node) {
    if (!node)
        return false;
    return node.selected || node.checked;
}
/**
 * 是否带选中角标：除「铺满整块的 ImageView」外还有其它子节点即视为已选中。
 * 移植自 `_has_selection_badge`。
 */
function hasSelectionBadge(node) {
    for (const child of node.children) {
        if (child.className === 'android.widget.ImageView' &&
            child.bounds[0] === node.bounds[0] &&
            child.bounds[1] === node.bounds[1] &&
            child.bounds[2] === node.bounds[2] &&
            child.bounds[3] === node.bounds[3]) {
            continue;
        }
        return true;
    }
    return false;
}
export async function isSafetyVerificationPage(root) {
    return (await findSafetyVerificationGridCells(root)).length === 6;
}
//# sourceMappingURL=state-locators.js.map