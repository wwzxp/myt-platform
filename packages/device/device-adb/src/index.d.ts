import type { Context } from '@deepseek-ai/cordis';
import { DeviceControl, type TapOptions, type UiNode, type UiSnapshot } from '@myt/device';
import { type HumanPolicy } from '@myt/human';
export interface AdbProviderConfig {
    /** adb 可执行文件路径；默认取 PATH 里的 adb。 */
    adbPath?: string | undefined;
    /** ADBKeyboard.apk 本地路径；设备未安装时用于安装。 */
    adbKeyboardApk?: string | undefined;
    /** 拟人化随机种子；给定后点击坐标与节奏可复现。 */
    seed?: number | undefined;
    /** 拟人化策略；缺省用旧实现参数。 */
    humanPolicy?: HumanPolicy | undefined;
    /** 单次命令超时。 */
    timeoutMs?: number | undefined;
}
/** 解析 uiautomator / yadb 的层级 XML；结构不合法时返回 null（由调用方重试）。 */
export declare function parseUiXml(xml: string): UiNode | null;
/**
 * ADB 直连 Provider。
 *
 * 只做协议适配；不做重试、不做业务判断。命令失败一律抛错，
 * 由上层步骤决定是否重试（见 shared-steps §9 错误分类）。
 */
export declare class AdbDeviceControl extends DeviceControl {
    private readonly adbPath;
    private readonly timeoutMs;
    private readonly adbKeyboardApk;
    /** 拟人化：随机源、策略、上次点击时间（对应 `HumanLikeOperator._last_tap_time`）。 */
    private readonly random;
    private readonly policy;
    private lastTapAt;
    constructor(ctx: Context, config?: AdbProviderConfig);
    private runShell;
    disconnect(serial: string): Promise<void>;
    /**
     * 连接 ADB 设备。
     *
     * 与旧 `adb_connect` 一致：**先 disconnect 再 connect**，再随机延迟 1–2s。
     * 断连这步很关键——设备重启/换机型后会残留陈旧 socket，
     * 只 connect 可能连上但状态是 offline。
     */
    connect(serial: string): Promise<string>;
    ensureIme(serial: string): Promise<void>;
    /** 以 root 执行 shell 命令（等价 `shell(..., { root: true })`）。 */
    private shellAsRoot;
    ensureYadb(serial: string, localPath: string): Promise<void>;
    private dumpViaYadb;
    dumpUi(serial: string, options?: {
        channel?: 'uiautomator' | 'yadb';
    }): Promise<UiSnapshot>;
    tap(serial: string, x: number, y: number, options?: TapOptions): Promise<void>;
    tapLikeHuman(serial: string, x: number, y: number, options?: {
        bounds?: [number, number, number, number];
        rightBoundary?: number;
    }): Promise<void>;
    swipe(serial: string, from: {
        x: number;
        y: number;
    }, to: {
        x: number;
        y: number;
    }, durationMs?: number): Promise<void>;
    typeText(serial: string, text: string): Promise<void>;
    back(serial: string): Promise<void>;
    pressKey(serial: string, key: string): Promise<void>;
    shell(serial: string, command: string, options?: {
        root?: boolean;
        check?: boolean;
        timeoutMs?: number;
    }): Promise<string>;
    pullPrivateFile(serial: string, remotePath: string): Promise<{
        size: number;
        content: Buffer;
    } | null>;
    pushPrivateFile(serial: string, localPath: string, remotePath: string, options?: {
        ownerUid?: string;
        mode?: string;
    }): Promise<void>;
    readRemoteFile(serial: string, remotePath: string): Promise<Buffer | null>;
    appUid(serial: string, pkg: string): Promise<string | null>;
    pushToGallery(serial: string, localPath: string, targetDir?: string): Promise<string>;
    pushImagesToGallery(serial: string, localPaths: string[], targetDir?: string): Promise<string[]>;
    screenshot(serial: string): Promise<Buffer>;
    openUri(serial: string, uri: string, pkg?: string): Promise<void>;
    forceStop(serial: string, pkg: string): Promise<void>;
    launchApp(serial: string, pkg: string): Promise<void>;
}
/** Cordis Loader 按包名导入时要求默认导出。 */
export default AdbDeviceControl;
//# sourceMappingURL=index.d.ts.map