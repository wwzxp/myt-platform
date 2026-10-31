/**
 * 循环节点（**容器式**）：循环体画在框内。
 *
 * 与 demo 的 loop 一致（`isContainer: true` + `blocks` 子节点），
 * 但数据用我们自己的：`loopFor.max`。
 */
import { nanoid } from 'nanoid'
import type { FlowNodeTransformData, PositionSchema, WorkflowNodeEntity } from '@flowgram.ai/free-layout-editor'

import { WorkflowNodeType } from '../constants'
import { FlowNodeRegistry } from '../../typings'
import iconLoop from '../../assets/icon-loop.jpg'
import { formMeta } from './form-meta'

let index = 0

export const MTLoopNodeRegistry: FlowNodeRegistry = {
  type: WorkflowNodeType.MTLoop,
  info: {
    icon: iconLoop,
    description: '重复做几次：循环体画在框内',
  },
  meta: {
    /** 子画布：循环体画在框内部 */
    isContainer: true,
    size: { width: 424, height: 244 },
    padding: (transform: { isContainer?: boolean }) =>
      transform.isContainer
        ? { top: 120, bottom: 80, left: 80, right: 80 }
        : { top: 0, bottom: 0, left: 0, right: 0 },
    selectable(node: WorkflowNodeEntity, mousePos?: PositionSchema): boolean {
      if (!mousePos) return true
      const transform = node.getData<FlowNodeTransformData>('FlowNodeTransformData' as never)
      return !transform.bounds.contains(mousePos.x, mousePos.y)
    },
    wrapperStyle: { minWidth: 'unset', width: '100%' },
  },
  onAdd() {
    return {
      id: `loop_${nanoid(5)}`,
      type: WorkflowNodeType.MTLoop,
      data: { title: `循环_${index + 1}`, loopFor: { max: 3 } },
      /** 循环体容器：内置起止块 */
      blocks: [
        {
          id: `block_start_${nanoid(5)}`,
          type: WorkflowNodeType.BlockStart,
          meta: { position: { x: 32, y: 0 } },
          data: {},
        },
        {
          id: `block_end_${nanoid(5)}`,
          type: WorkflowNodeType.BlockEnd,
          meta: { position: { x: 192, y: 0 } },
          data: {},
        },
      ],
    }
  },
  formMeta,
}

void index
