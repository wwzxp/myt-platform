import type { FlowDefinition } from '@myt/flow';
/**
 * QQ OP 登录（`main_op_login`）。
 *
 * 路径：其他登录方式 → QQ → 同意并继续 → 东鹏输入框粘贴 OP 数据 → 授权 → 等「我」。
 */
export declare const opLoginFlow: FlowDefinition;
/**
 * V 跳登录（`main_v_login`）。
 *
 * 路径：拉起授权 App → 输入 V 数据 → 一键授权 → 等「我」→ force-stop 授权 App。
 */
export declare const vJumpLoginFlow: FlowDefinition;
/** 未使用的占位导出，避免 tree-shaking 误删常量。 */
export declare const _xhsPackages: {
    XHS_PACKAGE: string;
    V_JUMP_PACKAGE: string;
};
//# sourceMappingURL=alt-login-flows.d.ts.map