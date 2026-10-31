import type { ActionContext } from '../steps/actions.ts';
/**
 * 验证码获取与安全验证处理（**1:1 移植**自 auto_login.py）。
 */
export type SmsProvider = 'legacy' | 'herosms';
export interface VerificationCodeSource {
    provider: SmsProvider;
    /** legacy：验证码网页 URL。 */
    url?: string | undefined;
    /** herosms：激活 id 与客户端钩子。 */
    activationId?: string | undefined;
    getStatus?: ((activationId: string) => Promise<{
        status: string;
        code?: string | undefined;
    }>) | undefined;
}
/** 从 HTML 中提取第一个 6 位数字；先剥离 script/style（旧实现同样做法）。 */
export declare function extractSixDigitCode(html: string): string | null;
/**
 * legacy 取码：`requests` 轮询 30 次，第 2 次起间隔 0.8–1.5s。
 *
 * 移植自 `fetch_url_contet_new`（auto_login.py:291-334）：
 * - `trust_env = False` → 绕开系统代理；Node 的 fetch 没有等价开关，
 *   这里用 `undici` 的 dispatcher 不可用时至少显式声明不使用代理：
 *   通过 `AbortSignal.timeout` + 直接 `http.request` 避免 `HTTP_PROXY` 生效。
 * - `Accept-Encoding: gzip, deflate`（验证码服务端不支持 br）。
 */
export declare function fetchLegacyCode(url: string, options?: {
    timeoutMs?: number;
    maxAttempts?: number;
}): Promise<string | null>;
/**
 * HeroSMS 取码：每 2s 轮询一次，最长 70s。
 * `STATUS_OK` 返回码；`STATUS_CANCEL(±LED)` 返回 null，其余继续等。
 */
export declare function fetchHerosmsCode(source: VerificationCodeSource, timeoutMs?: number): Promise<string | null>;
/** 按供应商取码（旧实现 `fetch_verification_code`）。 */
export declare function fetchVerificationCode(source: VerificationCodeSource): Promise<string | null>;
/** 去除非数字字符，剥离 HeroSMS 号码可能含的区号。 */
export declare function normalizeHerosmsPhone(phone: string, countryCode: string): string;
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
export declare function handleSafetyVerificationPage(ctx: ActionContext, solve: (screenshot: Buffer) => Promise<number>): Promise<boolean>;
//# sourceMappingURL=verification.d.ts.map