import type { FlowDefinition } from '@myt/flow';
export { opLoginFlow, vJumpLoginFlow } from './flows/alt-login-flows.ts';
export { createBindPhoneFlow, createFollowUserFlow, createModifyProfileFlow, setFollowingCommentsFlow } from './flows/device-flows.ts';
export { createSidLoginFlow, sidClearFlow, sidExtractFlow, SID_PATHS } from './flows/sid-flows.ts';
export { createOneClickNewDeviceFlow, oneClickNewDevice, ONE_CLICK_INTERNALS, } from './flows/one-click-new.ts';
export { restoreStateFlow } from './flows/state-restore.ts';
export { BUNDLE_VERSION, SUPPORTED_BUNDLE_VERSIONS, XHS_PACKAGE as BUNDLE_PACKAGE, MMKV_DIR, SHARED_PREFS_DIR, WEBVIEW_DIR, FILE_GROUPS, MODE_GROUPS, WEBVIEW_DYNAMIC_SPECS, utcNowIso, sha256File, bundleDefaultName, bundleManifestName, iterBundleGroups, buildBundleEntry, inferModeForRemotePath, staticBundleEntriesForGroups, dynamicBundleEntriesForGroups, bundleEntriesForGroups, buildManifest, writeBundle, } from './data/bundle.ts';
export { resolveWeshareTarPath, resolveLocalAppRoot, tarMemberNameForRemotePath, dynamicBundleEntriesFromTar, sourceLabelForTar, convertWeshareBackup, normalizeMemberName, resolveMiuiBakPath, findMiuiTarOffset, miuiMemberNameForRemotePath, dynamicBundleEntriesFromMiui, sourceLabelForBak, convertMiuiBackup, convertPackage, } from './data/bundle-convert.ts';
export { buildContext, buildContextFromMmkvDir, safeBuildContext, safeBuildContextFromMmkvDir, extractLoginInfoFromText, extractLoginAccountInfoFromText, extractProfileTokensFromText, extractDidValuesFromText, extractLocDeviceIdFromText, loadMmkvText, emptyDeviceContext, } from './data/device-context.ts';
export { HeroSmsClient, HeroSmsError, HeroSmsApiError, HeroSmsTransportError, waitForSmsCode } from './data/herosms.ts';
export { loginWithHeroSms, normalizeHeroSmsPhone } from './data/herosms-login.ts';
export { generateMmkvFiles, generateLoginUserInfoFiles, generateLoginActivateFiles, parseSidFromMmkv, parseMmkvRaw, describeMmkvValue, decodeVarint, } from './data/mmkv.ts';
import type { VerificationCodeSource } from './steps/verification.ts';
/** 小红书包名（login.md §6）。 */
export declare const XHS_PACKAGE = "com.xingin.xhs";
/** 应用内深链（shared-steps §2）。 */
export declare const XHS_DEEPLINK: {
    readonly profile: "xhsdiscover://profile";
    readonly settings: "xhsdiscover://settings";
    readonly postNewNote: "xhsdiscover://post_new_note?page={\"page_type\":\"now_portal_home_page\"}";
};
/**
 * 设备就绪探测（切片 A 的最小闭环）。
 *
 * 目标：验证「dump → 定位 → 点击 → 断言」这条原语链在真机上成立。
 */
export declare const deviceProbeFlow: FlowDefinition;
export interface PhoneLoginInput {
    /** 手机号（不含区号）。 */
    phone: string;
    /** 区号，默认 +86。 */
    countryCode?: string | undefined;
    /** 取码来源；缺省时流程停在「等待验证码」，不进入验证码循环。 */
    codeSource?: VerificationCodeSource | undefined;
    /** 安全验证识图（2 张图的两位数答案）；缺省时跳过安全验证处理。 */
    solveSafety?: ((image: Buffer) => Promise<number>) | undefined;
    /** 是否在发码后继续走验证码输入 + 引导页（默认 true）。 */
    continueAfterSendCode?: boolean | undefined;
}
/**
 * 手机号登录准备流程：**严格按 auto_login.main()（2403-2760）的顺序与分支移植**。
 *
 * 逐步对应：
 * 1. adb_connect + 冷启 + sleep(3-7)
 * 2. 首屏弹窗（欢迎 Agree / 通知 ALLOW）各最多 5 轮
 * 3. 等入口（5 轮 × 0.6-1.5s）
 * 4. 点「我」，再等入口（5 轮）
 * 5. 其他登录方式 → 手机号；或直接手机号；或已在输入页
 * 6. 等区号按钮（29 轮 × 0.6-1.5s）
 * 7. 区号不同才切换（列表解析 + 边界点击）
 * 8. 点清除按钮
 * 9. 点输入框右侧 → 拟人输入（5 次重试 + 回读）
 * 10. 等验证码框 / 点「验证并登录」3 次 + 等转圈
 *
 * 停在发码之后：接码需要外部服务，属下一段流程。
 */
export declare function createPhoneLoginPrepFlow(input: PhoneLoginInput): FlowDefinition;
/** `_first_package_name`：从 UI XML 取第一个 node 的 package（即前台应用）。 */
export declare function firstPackageName(xml: string): string;
/**
 * 抓取界面 XML 并落盘（移植自 `device_tab.UiDumpWorker` + `ui_dump.save_ui_dump`）。
 *
 * 旧版行为（`device_tab.py:140-190`）：
 * 1. 逐个设备抓 UI XML，失败记 `取界面失败: {exc}`
 * 2. 内容为空 → `dump 返回空内容`
 * 3. `save_ui_dump(serial, xml, "manual")` 落盘，失败 → `写文件失败`
 * 4. 成功后额外报告前台包名
 *
 * 只读操作：不建 job、不占设备锁（旧版注释明确说明）。
 */
export declare const uiDumpFlow: FlowDefinition;
//# sourceMappingURL=index.d.ts.map