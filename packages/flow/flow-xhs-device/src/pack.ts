/**
 * 小红书设备层业务包（`FlowPack` 实现）。
 *
 * 承载「清数据 / 备份」两个与设备交互的流程，
 * 与 `flow-xhs` 分开是因为它们只依赖 ADB 能力、不依赖小红书 UI。
 */

import type { ActionDefinition, FlowPack, FlowPackCapabilities, FlowRegistry } from '@myt/flow'
import { backupFlow, clearDataFlow } from './index.ts'

function registerDeviceFlows(flows: FlowRegistry, _capabilities: FlowPackCapabilities): void {
  flows.register(clearDataFlow)
  flows.register(backupFlow)
}

/** 本包对外的动作清单。 */
export const xhsDeviceActions: ActionDefinition[] = [
  { id: 'clear', label: '清除数据', flowId: 'xhs.device.clear', chainAction: 'clear', params: [] },
  { id: 'backup', label: '账号备份', flowId: 'xhs.device.backup', chainAction: 'backup', params: [] },
]

/** 设备层业务包。 */
export const xhsDevicePack: FlowPack = {
  id: 'xhs-device',
  title: '小红书设备操作',
  actions: xhsDeviceActions,
  register: registerDeviceFlows,
}
