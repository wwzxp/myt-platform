/**
 * 登录态备份包恢复（移植自 `xhs_real_state_restore.py` + `xhs_real_state_common.py`）。
 *
 * 备份包结构（zip）：
 * ```
 * manifest.json
 * files/mmkv/com.xingin.xhs
 * files/mmkv/com.xingin.xhs.crc
 * ...
 * ```
 * manifest 每个条目：`{ name, group, present, path?, remote_path?, mode? }`。
 *
 * 恢复时的关键约束：
 * - 目标路径可能跨 3 个目录（mmkv / shared_prefs / app_webview），不能一律丢进 mmkv
 * - 必须按 group 过滤（`core` 只恢复 4 个登录文件，`full` 恢复全部）
 * - 每个文件都要 `chown` 到 App uid + `chmod`，最后 `restorecon` 重打 SELinux 标签
 *   （漏掉 restorecon 的典型症状：文件在位但 App 读不到，表现为「恢复成功却未登录」）
 */
import type { FlowDefinition } from '@myt/flow';
/** 旧 `FILE_GROUPS`：分组 → 文件名。 */
export declare const FILE_GROUPS: {
    readonly core: readonly ["com.xingin.xhs", "com.xingin.xhs.crc", "login_user_info_kv", "login_user_info_kv.crc"];
    readonly device_context: readonly ["did_value_manager", "did_value_manager.crc", "kv_location", "kv_location.crc", "device_params_saver", "device_params_saver.crc"];
    readonly login_aux: readonly ["change_account", "change_account.crc", "com.xingin.xhs_preferences", "com.xingin.xhs_preferences.crc"];
    readonly shared_prefs: readonly ["device_info_file.xml", "ug_preload_device_info.xml", "pre_device.xml.xml", "cn.jiguang.sdk.device.xml", "ssoconfigs.xml", "cu_auth.xml", "s.xml", "f.xml"];
};
export type BundleGroup = keyof typeof FILE_GROUPS;
export type RestoreMode = 'core' | 'full';
/** 旧 `MODE_GROUPS`：恢复模式 → 需要恢复的分组。 */
export declare const MODE_GROUPS: Record<RestoreMode, readonly BundleGroup[]>;
/** 备份包 manifest 的单条文件记录。 */
export interface BundleEntry {
    name: string;
    group: string;
    present: boolean;
    path?: string;
    remote_path?: string;
    mode?: string;
}
/** 备份包 manifest。 */
export interface BundleManifest {
    package?: string;
    context?: Record<string, unknown>;
    files?: BundleEntry[];
}
/** 旧 `infer_mode_for_remote_path`：老格式包没有 mode 字段时按目录推断。 */
export declare function inferModeForRemotePath(remotePath: string): string;
/** 解析 manifest（旧 `load_bundle` 的校验部分）。 */
export declare function parseManifest(raw: string): BundleManifest;
/**
 * 恢复流程（`xhs.state.restore`）。
 *
 * 参数（`flowParams`）：`bundleDir` 必填，`mode` 为 `core|full`，`launch` 为 `true|false`。
 */
/**
 * 恢复流程（`xhs.state.restore`）。
 *
 * 照搬旧 `gui_device_worker.py:458-480` 的处理链：
 * ```
 * source 以 .zip 结尾 → 直接恢复
 * 其它（.bak / .tar.bak / 目录）→ convert_package() 转成 bundle 再恢复
 * ```
 *
 * 参数（`flowParams`）：
 * - `bundleDir` **或** `source`：已解压目录 / zip / .bak / .tar.bak / 目录
 * - `mode`：`core|full`
 * - `launch`：`true|false`
 */
export declare const restoreStateFlow: FlowDefinition;
//# sourceMappingURL=state-restore.d.ts.map