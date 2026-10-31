import type { StepContext } from '@myt/flow'
import type { UiNode } from '@myt/device'
import type { ActionTarget } from '@myt/ui-perception'


/**
 * 动作引擎：把「获取界面 → 判断页面 → 找位置 → 执行 → 校验」这五步只写一次。
 *
 * 之前这三步分散在 41 处循环里（图文 13、文字 10、长文 12，加上恢复层 6 处），
 * 每个动作都要自己写一遍等待、自己写一遍重试、自己写一遍成败判断。
 *
 * 现在的分工：
 * ```
 * 动作定义（纯参数，不含逻辑）
 *     ↓
 * 引擎（本文件）      循环 · 等页面 · 定位 · 执行 · 校验 · 失败恢复
 *     ↓
 * 底层（steps/）      定位、粘贴、页面识别、异常恢复
 * ```
 */

/** 坐标点。 */
export interface Point {
  x: number
  y: number
}

/** 定位方式。 */
export interface LocateSpec {
  /**
   * 意图描述。会被直接送给模型，写成界面上能看到的**精确文字**
   * （「输入标题」而不是「标题」——后者会选到「一键排版」，实测）。
   */
  intent: string
  /** 确定性兜底：模型不可用或失败时用旧路径。允许显式传 `undefined`（调用方常从可选配置直接透传）。 */
  fallback?: ((root: UiNode) => { x: number; y: number } | null) | undefined
  /** 是否启用视觉兜底，默认开启。 */
  vision?: boolean | undefined
  /**
   * 严格模式：只接受与意图**字面相关**的候选，不接受模型的自由选择。
   *
   * 用于「这个元素可能不存在」的场景（弹窗类）。默认模式下模型在找不到目标时
   * 会从剩余候选里挑一个最像的——实测在发布编辑页上找「取消」时选中了「返回」，
   * 一点就退回上一页，整单失败。
   */
  strict?: boolean | undefined
}

/** 执行方式。 */
export type ActSpec =
  /** 点击（拟人化）。 */
  | { kind: 'tap' }
  /** 输入文本：先点输入框，再粘贴，再回读校验。 */
  | {
      kind: 'input'
      text: string
      /** 附加片段（话题等），逐条粘贴。 */
      extras?: readonly string[]
      /** 回读比较方式，默认 exact。 */
      match?: 'exact' | 'contains'
      /** 定位输入框用的说明（回读校验复用同一个定位器）。 */
      inputLocator: (root: UiNode) => { x: number; y: number; text?: string } | null
    }
  /** 滑动。 */
  | { kind: 'swipe'; from: { x: number; y: number }; to: { x: number; y: number }; durationMs: number }
  /** 按返回键。 */
  | { kind: 'back' }
  /** 打开深链。 */
  | { kind: 'openUri'; uri: string }
  /** 执行任意自定义逻辑（用于选图这类批量操作）。 */
  | { kind: 'custom'; run: (ctx: StepContext) => Promise<void> }

/** 校验方式：五种内置 + 自定义。 */
export type VerifySpec =
  /** 页面变成目标页面之一。 */
  | { kind: 'page'; expect: readonly string[] }
  /** 元素存在。 */
  | { kind: 'exists'; locate: LocateSpec }
  /** 元素消失。 */
  | { kind: 'gone'; locate: LocateSpec }
  /** 输入框内容等于（或包含）期望文字。 */
  | { kind: 'inputEquals'; locator: (root: UiNode) => { text?: string } | null; text: string; match?: 'exact' | 'contains' }
  /** 数值达标（例：已选图片数 ≥ 目标数）。 */
  | { kind: 'countAtLeast'; measure: (ctx: StepContext) => Promise<number>; target: number }
  /** 自定义校验（上面五种覆盖不到的 10%）。 */
  | { kind: 'custom'; run: (ctx: StepContext) => Promise<boolean> }

/** 一个动作的完整定义（纯数据）。 */
export interface ActionSpec {
  /** 动作 id（日志与断点用）。 */
  id: string
  /** 展示名。 */
  title: string
  /** 执行前必须处于这些页面之一；不满足会先等待、再走恢复。 */
  requires: readonly string[]
  /**
   * 不在 `requires` 页面时是否允许恢复。
   *
   * 填写类动作设为 false：已有输入内容，退回会丢数据，宁可失败重跑。
   */
  recoverable?: boolean
  /** 定位方式；`act.kind === 'custom'` 时可省略。 */
  locate?: LocateSpec
  /** 执行方式。 */
  act: ActSpec
  /** 成功后如何判定；省略表示「执行完就算成功」。 */
  verify?: VerifySpec
  /** 最大尝试轮数，默认 5。 */
  rounds?: number
  /** 每轮之间的等待区间（秒），默认 [0.3, 0.8]。 */
  gap?: readonly [number, number]
  /** 执行后额外等待（秒），用于吸收页面跳转延迟。 */
  settle?: readonly [number, number]
  /**
   * 动作成功后的实际页面，用于校验失败时判断「是不是已经到位了」。
   *
   * 例：点「下一步」后页面会变，但按钮可能已经消失，无法再用 exists 校验。
   */
  landsOn?: readonly string[]
  /**
   * 可选动作：找不到目标也算成功。
   *
   * 用于「可能有也可能没有」的弹窗（try it 引导、静音提示、相册定位提示）——
   * 这类元素不出现是正常情况，不该让整单失败。
   */
  optional?: boolean
}

/** 一次动作执行的结果。 */
export interface ActionResult {
  /** 是否成功。 */
  ok: boolean
  /** 实际尝试轮数。 */
  rounds: number
  /** 命中坐标（点击类动作）。 */
  point?: { x: number; y: number } | undefined
  /** 命中的候选（调试用）。 */
  target?: ActionTarget | undefined
  /** 定位来源。 */
  source?: 'model' | 'vision' | 'fallback' | 'fixed' | 'none' | undefined
  /** 失败原因。 */
  reason?: string
  /** 耗时毫秒。 */
  ms: number
}
