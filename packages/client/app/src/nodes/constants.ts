/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

export enum WorkflowNodeType {
  Start = 'start',
  End = 'end',
  LLM = 'llm',
  HTTP = 'http',
  Code = 'code',
  Variable = 'variable',
  Condition = 'condition',
  MultiCondition = 'multi-condition',
  Loop = 'loop',
  BlockStart = 'block-start',
  BlockEnd = 'block-end',
  Comment = 'comment',
  Continue = 'continue',
  Break = 'break',
  /** 本项目新增：动作节点（设备操作）。 */
  MTAction = 'mt-action',
  /** 本项目新增：条件节点（两出口 true/false）。 */
  MTCondition = 'mt-condition',
  /** 本项目新增：循环节点（容器式）。 */
  MTLoop = 'mt-loop',
}
