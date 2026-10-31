import type { DeviceControl, UiSnapshot } from '@myt/device';
import type { HumanPolicy, Random } from '@myt/human';
import type { RunStore } from '@myt/runs';
/**
 * 输入/等待类动作原语（**1:1 移植**自 auto_login.py）。
 *
 * 这些是旧项目在真机上调出来的行为，参数不要随意改：
 * - `inputWithHumanLike`：输入前思考停顿、打字后回读、不一致则删除重输，最多 5 次；
 * - `clearInput`：删除次数 `min(len+5, 20)`，每次间隔 50–80ms；
 * - `waitSpinnerGone`：轮询「加载转圈」直到消失，超时返回 false（不抛错）。
 */
export interface ActionContext {
    serial: string;
    device: DeviceControl;
    runs: RunStore;
    runId: string;
    random: Random;
    humanPolicy: HumanPolicy;
    snapshot(options?: {
        refresh?: boolean;
    }): Promise<UiSnapshot>;
}
declare function sleep(ms: number): Promise<void>;
/** 输入前思考停顿：85% 0.8–3s，15% 4–7s（旧实现 thinking_delay）。 */
declare function thinkingDelay(random: Random): Promise<void>;
/**
 * 清空输入框：`min(len+5, 20)` 次删除键，每次 50–80ms。
 * 移植自 `clear_phone_input`。
 */
export declare function clearInput(ctx: ActionContext, content: string): Promise<void>;
/**
 * 拟人输入（带回读校验与重试）。
 *
 * 与旧实现的差异：旧实现「输入不一致就删掉重输」，但删除次数由**实际内容长度**
 * 决定；这里保持一致。返回 false 表示最终失败（旧实现同样返回 False 而非抛错）。
 */
export declare function inputWithHumanLike(ctx: ActionContext, text: string, _description: string, maxRetries?: number): Promise<boolean>;
/**
 * 等待加载转圈消失；超时返回 false（旧实现语义，不抛错）。
 * 移植自 `wait_spinner_gone`。
 */
export declare function waitSpinnerGone(ctx: ActionContext, timeoutMs?: number): Promise<boolean>;
/** 连点 N 次（旧实现在「验证并登录」上连点 3 次触发发码）。 */
export declare function tapRepeatedly(ctx: ActionContext, point: {
    x: number;
    y: number;
}, times?: number): Promise<void>;
export { sleep, thinkingDelay };
//# sourceMappingURL=actions.d.ts.map