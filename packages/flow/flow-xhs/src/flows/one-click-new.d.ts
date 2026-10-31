/**
 * 一键新机（`tools/One_click_new_device.py` 255 行的**逐函数复刻**）。
 *
 * 复刻原则：**不改逻辑、不改默认值、不改失败行为**。
 * 旧代码有问题的地方在注释里标注，但代码保持一致。
 *
 * 原文件结构：
 * ```
 * _ui_xml(adb_port)                     → uiXml()
 * _normalize_text_candidates(text)      → normalizeTextCandidates()
 * _find_ui_element(xml, res_id, text)   → findUiElement()
 * _check_ui(...)                        → checkUi()
 * _check_ui_scroll_list(...)            → checkUiScrollList()
 * _get_specified_tab_position(...)      → getSpecifiedTabPosition()
 * _get_spinner_position(adb, path)      → getSpinnerPosition()
 * One_click_new_device(...)             → oneClickNewDevice()
 * ```
 */
import type { StepContext } from '@myt/flow';
/** 旧 `_normalize_text_candidates`：把 text 参数规整成候选数组。 */
declare function normalizeTextCandidates(text: unknown): string[];
/** 旧 `_find_ui_element`：正则找节点，返回 `[found, x, y]`。 */
declare function findUiElement(xmlContent: string, resId: string, text?: unknown): [boolean, number | null, number | null];
/** 旧 `One_click_new_device` 的参数。 */
export interface OneClickNewDeviceOptions {
    deviceBrand?: string | null;
    deviceModel?: string | null;
    overseasRandom?: boolean | undefined;
}
/**
 * 一键新机（旧 `One_click_new_device`）。
 *
 * @returns `true` 表示流程走完；`false` 表示某一步节点未找到（与旧版一致）
 */
export declare function oneClickNewDevice(ctx: StepContext, options?: OneClickNewDeviceOptions): Promise<boolean>;
/** 供流程层复用的导出（与旧模块同名语义）。 */
export declare const ONE_CLICK_INTERNALS: {
    readonly BLUE_PACKAGE: "com.blue.backup";
    readonly BLUE_ACTIVITY: ".FunctionMenuActivity";
    readonly RID: {
        readonly textView1: "com.blue.backup:id/textView1";
        readonly setCardProperty: "com.blue.backup:id/set_card_property";
        readonly randomBtn: "com.blue.backup:id/random_btn";
        readonly specifiedBtn: "com.blue.backup:id/specified_btn";
        readonly brand: "com.blue.backup:id/brand";
        readonly model: "com.blue.backup:id/model";
        readonly appName: "com.blue.backup:id/app_name";
    };
    readonly P: {
        readonly specifiedTab: readonly [0, 0, 0, 0, 1, 0, 1];
        readonly brandSpinner: readonly [0, 0, 0, 0, 2, 0, 0, 1];
        readonly modelSpinner: readonly [0, 0, 0, 0, 2, 0, 1, 1];
        readonly nextButton: readonly [0, 0, 0, 0, 5, 1];
        readonly overseasCheckbox: readonly [0, 0, 0, 0, 2, 0, 0, 0];
        readonly randomConfirm: readonly [0, 0, 0, 0, 2, 0, 3];
    };
    readonly XHS_APP_NAME: string[];
    readonly findUiElement: typeof findUiElement;
    readonly normalizeTextCandidates: typeof normalizeTextCandidates;
};
/**
 * 流程包装（旧 `One_click_new_device` 在 `_run_device_reset` 里被调用的方式）。
 *
 * 与旧行为一致：**整个新机是一个原子操作**，任一步失败即整体失败。
 * 所以这里只有一个 step，内部照旧代码顺序执行。
 */
export declare function createOneClickNewDeviceFlow(input?: {
    brand?: string | undefined;
    model?: string | undefined;
    overseasRandom?: boolean;
}): import('@myt/flow').FlowDefinition;
export {};
//# sourceMappingURL=one-click-new.d.ts.map