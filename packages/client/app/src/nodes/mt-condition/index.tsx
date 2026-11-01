/**
 * 条件节点：先判断，再决定走哪条路。
 *
 * 端口固定两个：`true`（成立）/ `false`（不成立），与引擎一致。
 */
import { nanoid } from 'nanoid'

import { WorkflowNodeType } from '../constants'
import { FlowNodeRegistry } from '../../typings'
import iconCondition from '../../assets/icon-condition.svg'
import { formMeta } from './form-meta'

let index = 0

export const MTConditionNodeRegistry: FlowNodeRegistry = {
  type: WorkflowNodeType.MTCondition,
  info: {
    title: '条件判断',
    icon: iconCondition,
    description: '先判断一下，再决定走哪条路',
  },
  meta: {
    size: { width: 360, height: 160 },
    defaultPorts: [
      { type: 'input', portID: 'in', location: 'left' },
      { type: 'output', portID: 'true', location: 'right', offset: { x: 0, y: -16 } },
      { type: 'output', portID: 'false', location: 'right', offset: { x: 0, y: 16 } },
    ],
    expandable: false,
  },
  onAdd() {
    return {
      id: `cond_${nanoid(5)}`,
      type: WorkflowNodeType.MTCondition,
      // 与画布其它节点同构：值存在 `inputsValues`。
      data: {
        title: `条件_${++index}`,
        inputsValues: {
          judgeKind: { type: 'constant', content: 'page' },
          judgeExpect: { type: 'constant', content: '' },
        },
      },
    }
  },
  formMeta,
}
