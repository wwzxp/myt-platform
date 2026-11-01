/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */
import { nanoid } from 'nanoid';

import { FlowNodeRegistry } from '../../typings';
import { WorkflowNodeType } from '../constants';
import iconCondition from '../../assets/icon-condition.svg';

import { formMeta } from './form-meta';

let index = 0;
export const MultiConditionNodeRegistry: FlowNodeRegistry = {
  type: WorkflowNodeType.MultiCondition,
  info: {
    title: '多路分支',
    icon: iconCondition,
    description: '接出多条下游分支，满足哪条就走哪条',
  },
  meta: {
    /** 本项目引擎没有该节点的执行器；隐藏避免拖进来就校验失败。 */
    nodePanelVisible: false,
    defaultPorts: [{ type: 'input' }],
    // Condition Outputs use dynamic port
    useDynamicPort: true,
    expandable: false, // disable expanded
    size: {
      width: 360,
      height: 210,
    },
  },
  formMeta,
  onAdd() {
    return {
      id: `multi_condition_${nanoid(5)}`,
      type: 'condition',
      data: {
        title: `multi_condition_${++index}`,
        branch: [
          {
            logic: 'and',
            conditions: [
              {
                key: `condition_${nanoid(5)}`,
                value: {},
              },
            ],
          },
        ],
      },
    };
  },
};
