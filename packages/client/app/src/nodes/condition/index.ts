/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { nanoid } from 'nanoid';

import { FlowNodeRegistry } from '../../typings';
import iconCondition from '../../assets/icon-condition.svg';
import { formMeta } from './form-meta';
import { WorkflowNodeType } from '../constants';

export const ConditionNodeRegistry: FlowNodeRegistry = {
  type: WorkflowNodeType.Condition,
  info: {
    title: '条件分支（通用）',
    icon: iconCondition,
    description: '先判断一下，再决定走哪条路',
  },
  meta: {
    /**
     * 固定两个出口：`true` / `false`。
     *
     * demo 原本用 `useDynamicPort`（端口 id 由 data.conditions 动态生成），
     * 但我们的引擎按固定端口名路由，所以改成静态两出口。
     */
    defaultPorts: [
      { type: 'input', portID: 'in', location: 'left' },
      { type: 'output', portID: 'true', location: 'right', offset: { x: 0, y: -16 } },
      { type: 'output', portID: 'false', location: 'right', offset: { x: 0, y: 16 } },
    ],
    expandable: false,
    size: {
      width: 360,
      height: 180,
    },
  },
  formMeta,
  onAdd() {
    return {
      id: `condition_${nanoid(5)}`,
      type: 'condition',
      data: {
        title: '条件分支',
        conditions: [
          {
            key: `if_${nanoid(5)}`,
            value: {},
          },
          {
            key: `if_${nanoid(5)}`,
            value: {},
          },
        ],
      },
    };
  },
};
