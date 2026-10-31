/**
 * SID 上号 / 提取 / 清数据（移植自 `xhs_sid_extractor.py`，670 行）。
 *
 * 三条能力：
 * - **提取**：从已登录设备的 `login_user_info_kv` 读出 sid + userid
 * - **上号**：生成 MMKV 二进制写入私有目录，免登录直接进入账号
 * - **清理**：`pm clear` 等价的清数据
 *
 * 全部需要 root（写 `/data/data`）。
 */
import type { FlowDefinition } from '@myt/flow';
/** 带参数的流程工厂（与 `FlowRegistry.registerFactory` 的签名一致）。 */
type SidFactory = (params: Record<string, unknown>) => FlowDefinition;
/** 旧 `xhs_sid_extractor.py` 顶部常量。 */
export declare const SID_PATHS: {
    readonly package: "com.xingin.xhs";
    readonly mmkvDir: "/data/data/com.xingin.xhs/files/mmkv";
    readonly main: string;
    readonly crc: string;
    readonly loginInfo: string;
    readonly loginInfoCrc: string;
    readonly loginActivate: string;
    readonly loginActivateCrc: string;
    readonly deviceTmp: "/data/local/tmp";
};
/** 提取流程（`xhs.sid.extract`）。 */
export declare const sidExtractFlow: FlowDefinition;
/**
 * 上号流程（`xhs.sid.login`）——参数 `sid` + `userid`。
 *
 * 对应旧 `login_to_device`。
 */
export declare const createSidLoginFlow: SidFactory;
/** 清数据流程（`xhs.device.clear` 的 SID 版本，保留原流程不动）。 */
export declare const sidClearFlow: FlowDefinition;
export {};
//# sourceMappingURL=sid-flows.d.ts.map