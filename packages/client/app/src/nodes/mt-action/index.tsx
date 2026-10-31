/**
 * 动作节点：在手机上做一件事（点击 / 输入 / 滑动 / 深链 / 自定义）。
 *
 * 与 demo 其他节点一致的结构：`info` + `meta` + `formMeta` + `onAdd`。
 *
 * 端口：三个出口（成功 / 失败 / 页面不对），这是本项目图模型的核心——
 * demo 内置节点都只有单出口或条件分支，无法表达「动作失败走另一条路」。
 */
import { nanoid } from 'nanoid'

import { WorkflowNodeType } from '../constants'
import { FlowNodeRegistry } from '../../typings'
import iconAction from '../../assets/icon-script.png'
import { formMeta } from './form-meta'

let index = 0

export const MTActionNodeRegistry: FlowNodeRegistry = {
  type: WorkflowNodeType.MTAction,
  info: {
    icon: iconAction,
    description: '在手机上做一件事：点一下、输文字、滑一下',
  },
  meta: {
    size: {
      width: 360,
      height: 160,
    },
    /**
     * 三个显式出口。
     *
     * `useDynamicPort` 关闭：出口固定是这三种，不随数据变化。
     * 右侧从上到下依次排列，offset.y 控制垂直位置。
     */
    defaultPorts: [
      { type: 'input', portID: 'in', location: 'left' },
      { type: 'output', portID: 'success', location: 'right', offset: { x: 0, y: -24 } },
      { type: 'output', portID: 'failure', location: 'right', offset: { x: 0, y: 0 } },
      { type: 'output', portID: 'mismatch', location: 'right', offset: { x: 0, y: 24 } },
    ],
  },
  onAdd() {
    return {
      id: `action_${nanoid(5)}`,
      type: WorkflowNodeType.MTAction,
      data: {
        title: `动作_${++index}`,
        // 与 data/flows/*.json 的 config 结构保持一致
        requires: [],
        act: { kind: 'tap' },
        locate: { intent: '' },
      },
    }
  },
  formMeta,
}
