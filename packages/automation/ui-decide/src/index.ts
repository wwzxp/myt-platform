/**
 * UI 决策：用模型把「自然语言意图」变成「可点击坐标」。
 *
 * 依赖 `@myt/ui-perception` 产出的候选目标，以及 `@myt/model` 的模型调用能力。
 * 这一层不接触设备——它接收候选列表，返回坐标。
 *
 * 实测约定（见 `docs/spec/local-model-ui-locate.md`）：
 * - **只要求序号**，不要让模型算坐标（要求 `{x,y,index}` 时命中率从 100% 掉到 95%）
 * - 位置推理交给代码（问「最右」会错，问「从左到右列出」再取末尾才对）
 * - 意图词表命中就预筛，不命中退回全量（纯增益，不命中不会更差）
 */

export {
  locate,
  buildLocatePrompt,
  parseLocateIndex,
  centerOf,
  type LocateModel,
  type LocateRequest,
  type LocateResult,
} from './ui-locate.ts'

export { createModelLocate } from './model-adapter.ts'
