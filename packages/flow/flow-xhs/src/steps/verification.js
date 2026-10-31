import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { sleep } from '@myt/human';
import { getSafetyVerificationVerifyButtonInfo, getServerErrorRefreshButtonPosition, } from "../locators/guide-locators.js";
import { findSafetyVerificationGridCells, isSafetyVerificationPage, } from "../locators/state-locators.js";
import { getVerifyLoginButtonInfo } from "../locators/locators.js";
/** 从 HTML 中提取第一个 6 位数字；先剥离 script/style（旧实现同样做法）。 */
export function extractSixDigitCode(html) {
    const cleaned = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    const match = /(?<!\d)(\d{6})(?!\d)/.exec(cleaned);
    return match?.[1] ?? null;
}
/**
 * legacy 取码：`requests` 轮询 30 次，第 2 次起间隔 0.8–1.5s。
 *
 * 移植自 `fetch_url_contet_new`（auto_login.py:291-334）：
 * - `trust_env = False` → 绕开系统代理；Node 的 fetch 没有等价开关，
 *   这里用 `undici` 的 dispatcher 不可用时至少显式声明不使用代理：
 *   通过 `AbortSignal.timeout` + 直接 `http.request` 避免 `HTTP_PROXY` 生效。
 * - `Accept-Encoding: gzip, deflate`（验证码服务端不支持 br）。
 */
export async function fetchLegacyCode(url, options = {}) {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const maxAttempts = options.maxAttempts ?? 30;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (attempt > 1) {
            await sleep(800 + Math.random() * 700);
        }
        try {
            const code = extractSixDigitCode(await httpGetNoProxy(url, timeoutMs));
            if (code)
                return code;
        }
        catch {
            // 旧实现同样吞掉单次请求异常，继续下一轮。
        }
    }
    return null;
}
/**
 * 直连 HTTP GET（等价 Python 的 `session.trust_env = False`）。
 *
 * 用 `node:http`/`node:https` 而不是全局 `fetch`：后者会读取 `HTTP_PROXY`
 * 环境变量，而旧实现明确要绕过系统代理。
 */
function httpGetNoProxy(url, timeoutMs) {
    const { promise, resolve, reject } = Promise.withResolvers();
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const request = client.request({
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers: { 'accept-encoding': 'gzip, deflate', connection: 'close' },
        timeout: timeoutMs,
    }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
            resolve(decodeBody(Buffer.concat(chunks), response.headers['content-encoding']));
        });
        response.on('error', reject);
    });
    request.on('timeout', () => {
        request.destroy(new Error('取码请求超时'));
    });
    request.on('error', reject);
    request.end();
    return promise;
}
/** 按响应头解压（用同步 API，请求量很小）。 */
function decodeBody(body, encoding) {
    if (encoding === 'gzip')
        return zlib.gunzipSync(body).toString('utf8');
    if (encoding === 'deflate')
        return zlib.inflateSync(body).toString('utf8');
    return body.toString('utf8');
}
/**
 * HeroSMS 取码：每 2s 轮询一次，最长 70s。
 * `STATUS_OK` 返回码；`STATUS_CANCEL(±LED)` 返回 null，其余继续等。
 */
export async function fetchHerosmsCode(source, timeoutMs = 70_000) {
    if (!source.activationId || !source.getStatus) {
        throw new Error('HeroSMS activation_id 或 client 未设置');
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const status = await source.getStatus(source.activationId);
        if (status.status === 'STATUS_OK')
            return status.code ?? null;
        if (status.status === 'STATUS_CANCEL' || status.status === 'STATUS_CANCELLED')
            return null;
        await sleep(2000);
    }
    return null;
}
/** 按供应商取码（旧实现 `fetch_verification_code`）。 */
export async function fetchVerificationCode(source) {
    if (source.provider === 'legacy') {
        if (!source.url)
            throw new Error('legacy 取码需要 url');
        return fetchLegacyCode(source.url);
    }
    if (source.provider === 'herosms') {
        return fetchHerosmsCode(source);
    }
    throw new Error(`不支持的短信供应商：${String(source.provider)}`);
}
/** 去除非数字字符，剥离 HeroSMS 号码可能含的区号。 */
export function normalizeHerosmsPhone(phone, countryCode) {
    const digits = String(phone ?? '').replace(/\D+/g, '');
    const prefix = countryCode.replace(/\D+/g, '');
    return prefix && digits.startsWith(prefix) ? digits.slice(prefix.length) : digits;
}
/**
 * 处理安全验证页（点选 2 张图）。
 *
 * 移植自 `handle_safety_verification_page`：
 * - 最多 3 次尝试；
 * - 页面未出现时先等 60s，期间检测服务器出错页则返回；
 * - 识别出两张图后按索引点击（已选中的跳过），再点「验证」；
 * - 每次尝试后等 1.5s 复查是否仍在验证页。
 *
 * 识图结果由调用方提供（旧实现调外部模型），这里通过 `solve` 注入。
 */
export async function handleSafetyVerificationPage(ctx, solve) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        let snapshot = await ctx.snapshot({ refresh: true });
        if (!(await isSafetyVerificationPage(snapshot.root))) {
            // 服务器出错页 → 返回后重点「验证并登录」（旧实现 2991-2997：间隔 0.5–1.5s，不可用则 break）
            if (getServerErrorRefreshButtonPosition(snapshot.root)) {
                await ctx.device.back(ctx.serial);
                await retapVerifyLogin(ctx, 500, 1500, true);
                return false;
            }
            // 等待验证页出现（最多 60s）
            const deadline = Date.now() + 60_000;
            let appeared = false;
            while (Date.now() < deadline) {
                await sleep(1000);
                snapshot = await ctx.snapshot({ refresh: true });
                if (await isSafetyVerificationPage(snapshot.root)) {
                    appeared = true;
                    break;
                }
                if (getServerErrorRefreshButtonPosition(snapshot.root)) {
                    await ctx.device.back(ctx.serial);
                    await retapVerifyLogin(ctx, 500, 1500, true);
                    return false;
                }
            }
            if (!appeared) {
                // 旧实现 3019-3030：超时后间隔 0.3–0.6s，且按钮不可用也**不** break（连试满 5 次）
                await ctx.device.back(ctx.serial);
                await retapVerifyLogin(ctx, 300, 600, false);
                return false;
            }
        }
        const screenshot = await ctx.device.screenshot(ctx.serial);
        const answer = await solve(screenshot);
        const first = Math.floor(answer / 10);
        const second = answer % 10;
        const cells = await findSafetyVerificationGridCells(snapshot.root);
        const pick = async (index, label) => {
            const cell = cells[index - 1];
            if (!cell || cell.selected)
                return;
            await ctx.device.tapLikeHuman(ctx.serial, cell.x, cell.y, { bounds: cell.bounds });
            void label;
        };
        await pick(first, '第一张图');
        await pick(second, '第二张图');
        await sleep(1000);
        const verify = getSafetyVerificationVerifyButtonInfo((await ctx.snapshot({ refresh: true })).root);
        if (verify) {
            await ctx.device.tapLikeHuman(ctx.serial, verify.x, verify.y);
        }
        await sleep(1500);
        if (!isSafetyVerificationPage((await ctx.snapshot({ refresh: true })).root)) {
            return true;
        }
    }
    return false;
}
/**
 * 连点「验证并登录」。
 *
 * 旧实现有两处调用，参数不同：
 * - 服务器出错（2991-2997 / 3011-3017）：间隔 0.5–1.5s，按钮不可用就 **break**；
 * - 60s 超时（3019-3030）：间隔 0.3–0.6s，按钮不可用也 **不** break（连试满 5 次）。
 */
async function retapVerifyLogin(ctx, minMs, maxMs, breakWhenDisabled) {
    for (let i = 0; i < 5; i += 1) {
        await sleep(ctx.random.int(minMs, maxMs));
        const info = getVerifyLoginButtonInfo((await ctx.snapshot({ refresh: true })).root);
        if (info && info.enabled) {
            await ctx.device.tapLikeHuman(ctx.serial, info.x, info.y);
        }
        else if (breakWhenDisabled) {
            break;
        }
    }
}
//# sourceMappingURL=verification.js.map