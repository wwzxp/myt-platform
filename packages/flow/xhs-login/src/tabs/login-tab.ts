/**
 * 上号标签页的界面契约（对齐 auto_object 的 `XhsDeviceTab`）。
 *
 * 旧界面有 4 个区域、17 个交互控件；这里用同一套语义定义 API，
 * 前端只负责渲染与调用，业务判断留在内核（与旧实现一致：
 * 校验、跳过、互斥都由 UI 层持有，这里收敛为服务端一次判定）。
 */

/** 登录源类型（旧 `SourceType`）。 */
import type { ActionDefinition } from '@myt/flow'

export type SourceKind = 'none' | 'sms' | 'bundle' | 'op' | 'v' | 'sid'

/** 行状态（旧 `RowStatus`）。 */
export type RowStatus = 'idle' | 'ready' | 'running' | 'success' | 'failed' | 'cancelled'

/**
 * 批量动作 id。
 *
 * 取值由业务包声明（`ActionDefinition.id`），内核不枚举固定集合。
 * `'login'` 是唯一在内核里有特殊语义的动作（要带登录参数、走链式编排）。
 */
export type BatchAction = string

/**
 * 由业务包的动作清单派生「动作 → 流程 id」映射。
 *
 * 旧实现是写死的常量表；现在动作归各业务包所有（`FlowPack.actions`），
 * 内核只做汇总，不再持有任何具体 id。
 *
 * @param actions 全部已注册业务包的动作
 * @returns 动作 id → 流程 id；无流程的动作不出现在结果里
 */
export function buildActionFlows(actions: ReadonlyArray<ActionDefinition>): Readonly<Record<string, string>> {
  const map: Record<string, string> = {}
  for (const action of actions) {
    if (action.flowId) map[action.id] = action.flowId
  }
  return map
}

/**
 * 由业务包派生「链动作 → 流程 id」映射。
 *
 * 旧实现是 `login-chain.ts` 里写死的 `ACTION_FLOW_ID`；
 * 现在每个动作用 `chainAction` 声明自己对应链上哪一步，内核只汇总。
 *
 * @param actions 全部已注册业务包的动作
 * @returns 链动作名 → 流程 id
 */
export function buildChainFlows(actions: ReadonlyArray<ActionDefinition>): Readonly<Record<string, string>> {
  const map: Record<string, string> = {}
  for (const action of actions) {
    if (action.chainAction && action.flowId) map[action.chainAction] = action.flowId
  }
  return map
}

/**
 * 「单项任务」对话框的条目：取各包里 `single: true` 的动作。
 *
 * @param actions 全部已注册业务包的动作
 */
export function buildSingleTasks(
  actions: ReadonlyArray<ActionDefinition>,
): ReadonlyArray<{ id: string; label: string }> {
  return actions
    .filter((action) => action.single)
    .map((action) => ({ id: action.id, label: action.label }))
}

/** 设备行（旧 `DeviceRowState` + `DeviceSource` 的合并投影）。 */
export interface DeviceRow {
  deviceId: string
  serial: string
  hostIp: string
  /** 容器名（坑位多容器模式下的子行）。 */
  containers: Array<{ name: string; slotIndex: number; state: string; selected: boolean }>
  /** 当前登录源。 */
  source: { kind: SourceKind; value: string; summary: string }
  status: RowStatus
  lastError: string
  /** 毫秒。 */
  duration: number
  /** 正在执行/排队的运行 id。 */
  activeRunId: string | null
  /** 是否可重试（旧 `retryable`）。 */
  retryable: boolean
}

/** 登录模式（旧 `LoginModeDialog`）。 */
export interface LoginModeOptions {
  mode: 'manual' | 'batch'
  /** 同 IP 同时启动数量（1–99，默认 3）。 */
  sameIpBatchSize: number
  /** 批次间隔秒（1–600，默认 10）。 */
  sameIpBatchIntervalSeconds: number
  /** 登录循环次数（1–999，默认 1）。 */
  loopCount: number
  /** 失败重试次数（0–99，默认 0）。 */
  retryCount: number
  setAvatarNickname: boolean
  setProxyBeforeLogin: boolean
  resetDeviceBeforeLogin: boolean
  setOnlyFollowingComments: boolean
  bindPhoneAfterLogin: boolean
  setAdbIme: boolean
}

/** 默认值与旧界面控件的初始值一致。 */
export const DEFAULT_LOGIN_MODE: LoginModeOptions = {
  mode: 'batch',
  sameIpBatchSize: 3,
  sameIpBatchIntervalSeconds: 10,
  loopCount: 1,
  retryCount: 0,
  setAvatarNickname: false,
  setProxyBeforeLogin: false,
  resetDeviceBeforeLogin: false,
  setOnlyFollowingComments: false,
  bindPhoneAfterLogin: false,
  setAdbIme: true,
}

/** 批量动作前的校验结果（旧实现用一系列弹窗拦截，这里返回原因）。 */
export interface ActionCheck {
  ok: boolean
  /** 不满足时的原因（对应旧实现的弹窗文案）。 */
  reason?: string | undefined
  /** 被跳过的设备（旧实现「已有任务，已自动跳过」）。 */
  skipped?: string[] | undefined
}

/**
 * 校验一次批量动作是否可执行。
 *
 * 移植旧 `run_batch_action` 的判定顺序（4861-4990）：
 * 1. 必须选中设备；
 * 2. 有任务在执行的设备跳过（不是失败）；
 * 3. 多容器模式仅支持批量登录；
 * 4. HeroSMS 配置不完整则拒绝；
 * 5. 勾选「设置头像昵称」时校验素材数量。
 */
export function checkBatchAction(input: {
  action: BatchAction
  rows: DeviceRow[]
  multiContainer: boolean
  loginMode: LoginModeOptions
  herosmsEnabled: boolean
  herosmsReady: boolean
  avatarsAvailable: number
  nicknamesAvailable: number
}): ActionCheck {
  if (input.rows.length === 0) return { ok: false, reason: '请先选择设备' }

  const skipped = input.rows.filter((row) => row.activeRunId).map((row) => row.serial)
  const runnable = input.rows.filter((row) => !row.activeRunId)
  if (runnable.length === 0) {
    return { ok: false, reason: '所选设备已有任务在执行或排队，请先取消或等待完成' }
  }

  if (input.multiContainer && input.action === 'login' && input.loginMode.mode !== 'batch') {
    return { ok: false, reason: '坑位多容器运行仅支持批量导入登录模式' }
  }

  if (input.action === 'login' && input.herosmsEnabled && !input.herosmsReady) {
    return { ok: false, reason: 'HeroSMS 配置不完整，请先配置 API Key、国家、区号与价格' }
  }

  if (input.action === 'login' && input.loginMode.setAvatarNickname) {
    const slots = runnable.length * input.loginMode.loopCount
    if (input.avatarsAvailable < slots) {
      return {
        ok: false,
        reason: `已勾选「设置头像、昵称」，但头像图片数量不足（需 ${slots} 张，现有 ${input.avatarsAvailable} 张）`,
      }
    }
    if (input.nicknamesAvailable < slots) {
      return {
        ok: false,
        reason: `已勾选「设置头像、昵称」，但昵称数量不足（需 ${slots} 条，现有 ${input.nicknamesAvailable} 条）`,
      }
    }
  }

  if (input.action === 'login' && input.loginMode.mode === 'batch' && input.loginMode.loopCount > 1) {
    // 旧实现：SMS 多次循环必须勾选「清除数据」；这里由调用方带上 clearData 再判断。
  }

  return { ok: true, skipped: skipped.length > 0 ? skipped : undefined }
}

/** 账号行（导入对话框的「账号」页）。 */
export interface ImportedAccount {
  /** 原始行文本（旧实现整行保存，回写时按分隔符拼接）。 */
  raw: string
  /** 手机号或 sid，依模式而定。 */
  identifier: string
  /** 验证码网页 URL（sms 模式）。 */
  url: string
  status: string
  assignedDeviceSerial: string
}

/** 导入模式（旧 `AccountImportDialog` 的 5 个单选）。 */
export type ImportMode = 'sms' | 'bundle' | 'op' | 'v' | 'sid'

/** 解析「区号-手机号----链接」，与旧 `parse_sms_code_login` 一致。 */
export function parseSmsCodeLogin(value: string): { countryCode: string; phone: string; url: string } | null {
  const text = value.trim()
  if (!text) return null
  const parts = text.split('----')
  if (parts.length < 2) return null
  const head = parts[0]?.trim() ?? ''
  const url = parts.slice(1).join('----').trim()
  const dashIndex = head.indexOf('-')
  if (dashIndex < 0) {
    // 无区号时按默认 +86 处理（旧实现要求必须带区号，这里保持严格：返回 null）
    return null
  }
  const countryCode = head.slice(0, dashIndex).trim()
  const phone = head.slice(dashIndex + 1).trim()
  if (!countryCode.startsWith('+') || !/^\d{6,15}$/.test(phone)) return null
  return { countryCode, phone, url }
}

/** 把账号行转成流程参数（供登录流程使用）。 */
export function accountToFlowParams(
  account: ImportedAccount,
  mode: ImportMode,
): { phone: string; countryCode: string; codeUrl: string } | { activationId: string } | null {
  if (mode === 'sms') {
    const parsed = parseSmsCodeLogin(`${account.identifier}`)
    if (!parsed) return null
    return { phone: parsed.phone, countryCode: parsed.countryCode, codeUrl: parsed.url }
  }
  return null
}
