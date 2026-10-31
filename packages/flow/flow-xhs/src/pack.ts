/**
 * 小红书业务包（`FlowPack` 实现）。
 *
 * 把原来散落在 `kernel.ts` 里的 7 个 `registerFactory` 全部收进来，
 * 内核只做 `ctx.plugin(xhsPack)`，**不再写任何 `xhs.*` 流程 id**。
 *
 * 依赖边界：
 * - 只用 `@myt/flow` 的 `FlowPack` 契约
 * - 需要 LLM 识图 / 宿主 API 时从 `capabilities` 取，不 import kernel
 */

import type {
  ActionDefinition,
  ChainCondition,
  ChainRecipe,
  FlowPack,
  FlowPackCapabilities,
  FlowRegistry,
} from '@myt/flow'
import { createPhoneLoginPrepFlow, deviceProbeFlow, uiDumpFlow } from './index.ts'
import {
  createBindPhoneFlow,
  createFollowUserFlow,
  createModifyProfileFlow,
  setFollowingCommentsFlow,
} from './flows/device-flows.ts'
import { createOneClickNewDeviceFlow } from './flows/one-click-new.ts'
import { createSidLoginFlow, sidClearFlow, sidExtractFlow } from './flows/sid-flows.ts'
import { restoreStateFlow } from './flows/state-restore.ts'
import { opLoginFlow, vJumpLoginFlow } from './flows/alt-login-flows.ts'
import { HeroSmsClient } from './data/herosms.ts'

/** 从 params 取字符串。 */
function text(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** 从 params 取数字。 */
function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(params[key])
  return Number.isFinite(value) ? value : fallback
}

/**
 * 注册全部小红书流程。
 *
 * 与原 kernel 里的注册**逐项等价**，只是搬了位置。
 */
function registerXhsFlows(flows: FlowRegistry, capabilities: FlowPackCapabilities): void {
  // ── 无参流程 ──
  flows.register(deviceProbeFlow)
  flows.register(opLoginFlow)
  flows.register(vJumpLoginFlow)
  flows.register(sidExtractFlow)
  flows.register(sidClearFlow)
  flows.register(restoreStateFlow)
  flows.register(setFollowingCommentsFlow)
  flows.register(uiDumpFlow)

  // ── 手机号登录 ──
  flows.registerFactory(
    'xhs.login.phone-prep',
    { title: '手机号登录准备（进页 + 填号 + 取码）' },
    (params) => {
      const phone = text(params, 'phone')
      if (!/^\d{6,15}$/.test(phone)) throw new Error(`手机号不合法：${phone || '(空)'}`)
      const countryCode = text(params, 'countryCode') || '+86'

      // 取码来源：有 url 走 legacy 轮询；有 activationId 走 HeroSMS。
      const url = text(params, 'codeUrl')
      const activationId = text(params, 'activationId')
      const heroApiKey = text(params, 'heroSmsApiKey')
      const heroClient = heroApiKey ? new HeroSmsClient(heroApiKey) : null
      const codeSource = url
        ? ({ provider: 'legacy', url } as const)
        : activationId && heroClient
          ? ({
              provider: 'herosms',
              activationId,
              getStatus: async (id: string) => {
                const status = await heroClient.getStatus(id)
                return { status: status.status, code: status.code ?? undefined }
              },
            } as const)
          : undefined

      return createPhoneLoginPrepFlow({
        phone,
        countryCode,
        codeSource,
        // 识图由内核注入（它知道 LLM 配置从哪读）。
        solveSafety: capabilities.solveSafety
          ? (image: Buffer) => capabilities.solveSafety!(image, params as Record<string, string>)
          : undefined,
        continueAfterSendCode: params['stopAfterSendCode'] !== 'true',
      })
    },
  )

  // ── 改资料 ──
  flows.registerFactory(
    'xhs.device.modify-profile',
    { title: '修改资料（昵称 + 头像）' },
    (params) => {
      const nickname = text(params, 'nickname')
      if (!nickname) throw new Error('缺少 nickname')
      const avatarPath = text(params, 'avatarPath')
      const mode = (text(params, 'imageMode') || 'last') as 'random' | 'last' | 'first'
      return createModifyProfileFlow({ nickname, avatarPath: avatarPath || undefined, imageMode: mode })
    },
  )

  // ── 关注 ──
  flows.registerFactory(
    'xhs.device.follow',
    { title: '关注账号（关键词列表）' },
    (params) => {
      const keywords = text(params, 'keywords')
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
      if (!keywords.length) throw new Error('缺少 keywords（逗号或换行分隔）')
      return createFollowUserFlow({
        keywords,
        followCount: num(params, 'followCount', 1),
      })
    },
  )

  // ── 设置 S5 代理（唯一需要宿主 API 的流程）──
  flows.registerFactory(
    'xhs.device.set-proxy',
    { title: '设置 S5 代理' },
    (params) => {
      const proxyIp = text(params, 'proxyIp')
      const deviceIp = text(params, 'deviceIp')
      if (!proxyIp || !deviceIp) throw new Error('代理参数不完整')
      const apiPort = num(params, 'apiPort', 10008)
      const proxyPort = num(params, 'proxyPort', 1080)
      return {
        id: 'xhs.device.set-proxy',
        title: `设置代理（${proxyIp}:${proxyPort}）`,
        steps: [
          {
            id: 'set',
            title: '调用容器 /proxy 接口',
            async run() {
              // 宿主能力由内核注入；未注入说明部署环境不支持。
              if (!capabilities.host) throw new Error('宿主能力不可用（未注入 host）')
              const ok = await capabilities.host.setS5Proxy({
                deviceIp,
                apiPort,
                proxyIp,
                proxyPort,
                username: text(params, 'proxyUsername'),
                password: text(params, 'proxyPassword'),
                timeoutMs: 30_000,
              })
              if (!ok) throw new Error(`代理设置失败: ${proxyIp}:${proxyPort}`)
              return `代理设置成功: ${proxyIp}:${proxyPort}`
            },
          },
        ],
      }
    },
  )

  // ── SID 上号 ──
  flows.registerFactory(
    'xhs.sid.login',
    { title: 'SID 上号（写 MMKV，需 root）' },
    (params) => {
      const sid = text(params, 'sid')
      const userid = text(params, 'userid')
      if (!sid) throw new Error('缺少 sid')
      if (!userid) throw new Error('缺少 userid')
      return createSidLoginFlow({ sid, userid })
    },
  )

  // ── 一键新机 ──
  flows.registerFactory(
    'xhs.device.one-click-new',
    { title: '一键新机（改机型 + 清小红书）' },
    (params) => {
      const brand = text(params, 'brand')
      const model = text(params, 'model')
      const overseas = params['overseasRandom'] !== 'false' && params['overseasRandom'] !== false
      return createOneClickNewDeviceFlow({
        brand: brand || undefined,
        model: model || undefined,
        overseasRandom: overseas,
      })
    },
  )

  // ── 绑定手机号 ──
  flows.registerFactory(
    'xhs.device.bind-phone',
    { title: '绑定手机号' },
    (params) => {
      const phone = text(params, 'phone')
      if (!/^\d{6,15}$/.test(phone)) throw new Error(`手机号不合法：${phone || '(空)'}`)
      const countryCode = text(params, 'countryCode') || '+86'
      const url = text(params, 'codeUrl')
      return createBindPhoneFlow({
        phone,
        countryCode,
        codeSource: url ? { provider: 'legacy', url } : undefined,
        solveSafety: capabilities.solveSafety
          ? (image: Buffer) => capabilities.solveSafety!(image, params as Record<string, string>)
          : undefined,
      })
    },
  )
}

/**
 * 本包对外的动作清单。
 *
 * 参数定义**逐项**搬运自旧 `login.html` 的 prompt 链（`singleConfirm` 处理器），
 * 顺序即 UI 上的提问顺序。
 */
export const xhsActions: ActionDefinition[] = [
  {
    id: 'modify-profile',
    label: '设置头像昵称',
    flowId: 'xhs.device.modify-profile',
    chainAction: 'modify-profile',
    single: true,
    requiresSelection: true,
    params: [
      { name: 'nickname', label: '新昵称', type: 'text', required: true },
      { name: 'avatarPath', label: '头像本地路径', type: 'text', hint: '可留空只改名' },
    ],
  },
  {
    id: 'follow-user',
    label: '关注账号',
    flowId: 'xhs.device.follow',
    chainAction: 'follow-user',
    single: true,
    requiresSelection: true,
    params: [
      { name: 'keywords', label: '关注关键词', type: 'textarea', required: true, hint: '逗号或换行分隔' },
      { name: 'followCount', label: '关注数量上限', type: 'number', defaultValue: '1' },
    ],
  },
  {
    id: 'bind-phone',
    label: '绑定账号',
    flowId: 'xhs.device.bind-phone',
    chainAction: 'bind-phone',
    single: true,
    requiresSelection: true,
    params: [
      { name: 'phone', label: '要绑定的手机号', type: 'text', required: true },
      { name: 'countryCode', label: '区号', type: 'text', defaultValue: '+86' },
      { name: 'codeUrl', label: '验证码网页 URL', type: 'text', hint: '可留空' },
    ],
  },
  {
    id: 'sid-login',
    label: 'SID 上号（写登录态）',
    flowId: 'xhs.sid.login',
    single: true,
    requiresSelection: true,
    params: [
      { name: 'sid', label: 'sid', type: 'text', required: true },
      { name: 'userid', label: 'userid', type: 'text', required: true, hint: '24 位 hex' },
    ],
  },
  {
    id: 'sid-extract',
    label: '提取 SID（读登录态）',
    flowId: 'xhs.sid.extract',
    single: true,
    requiresSelection: true,
    params: [],
  },
  {
    id: 'restore-state',
    label: '恢复备份包',
    flowId: 'xhs.state.restore',
    single: true,
    requiresSelection: true,
    params: [
      { name: 'source', label: '备份源', type: 'text', required: true, hint: '.zip / .bak / .tar.bak / 已解压目录' },
      {
        name: 'mode',
        label: '恢复模式',
        type: 'select',
        defaultValue: 'core',
        options: [
          { value: 'core', label: 'core' },
          { value: 'full', label: 'full' },
        ],
      },
      { name: 'launch', label: '恢复后拉起 App', type: 'confirm', defaultValue: 'true' },
    ],
  },
  {
    id: 'set-proxy',
    label: '设置代理',
    flowId: 'xhs.device.set-proxy',
    single: true,
    requiresSelection: true,
    params: [
      { name: 'proxyIp', label: '代理 IP', type: 'text', required: true },
      { name: 'proxyPort', label: '代理端口', type: 'number', defaultValue: '1080' },
      { name: 'proxyUsername', label: '代理用户名', type: 'text', hint: '可留空' },
      { name: 'proxyPassword', label: '代理密码', type: 'password', hint: '可留空' },
      { name: 'deviceIp', label: '容器 IP', type: 'text', required: true, hint: '如 192.168.30.2' },
      { name: 'apiPort', label: '容器 API 端口', type: 'number', defaultValue: '10008' },
    ],
  },
  {
    id: 'reset-device',
    label: '一键新机',
    flowId: 'xhs.device.one-click-new',
    single: true,
    requiresSelection: true,
    params: [
      {
        name: 'resetDeviceMode',
        label: '机型模式',
        type: 'select',
        defaultValue: 'random',
        options: [
          { value: 'random', label: '随机' },
          { value: 'specified', label: '指定品牌+型号' },
        ],
      },
      { name: 'brand', label: '品牌', type: 'text', hint: '如 OPPO（指定模式必填）' },
      { name: 'model', label: '型号', type: 'text', hint: '如 CPH2009（指定模式必填）' },
      { name: 'overseasRandom', label: '海外随机', type: 'confirm', defaultValue: 'true' },
    ],
  },
  {
    id: 'ui-dump',
    label: '抓取界面XML',
    flowId: 'xhs.ui.dump',
    single: true,
    requiresSelection: true,
    params: [],
  },
  {
    id: 'probe',
    label: '设备就绪探测（回主页+断言）',
    flowId: 'xhs.probe',
    single: true,
    requiresSelection: true,
    params: [],
  },
  // 以下动作不进「单项任务」对话框，但批量栏需要用。
  { id: 'login', label: '登录', flowId: 'xhs.login.phone-prep', chainAction: 'login', requiresSelection: true, params: [] },
  {
    id: 'following-comments',
    label: '设置仅关注可评论',
    flowId: 'xhs.device.following-comments',
    chainAction: 'set-following-comments',
    params: [],
  },
  { id: 'one-click-new', label: '一键新机', flowId: 'xhs.device.one-click-new', params: [] },
]

/**
 * 登录链配方，**逐分支对齐** `device_tab.py:5852-6250` 的真实 if/elif 顺序。
 *
 * 旧版第一轮的顺序（先命中先执行）：
 *   1. only_following_comments → SET_FOLLOWING_COMMENTS
 *   2. avatar_path && nickname  → MODIFY_PROFILE
 *   3. enable_bind_phone        → BIND_PHONE
 *   4. follow_user_ids          → FOLLOW_USER
 *
 * **关键差异**：旧版在 `if avatar_path and nickname` 成立后会 `continue`，
 * 因此第 3 步（绑定）在「改资料」路径上**不会**在第一轮执行，
 * 而是等 `MODIFY_PROFILE` 成功后由 `afterAction` 续接（第 5 步）。
 *
 * 无头像昵称时才在第一轮直接绑定。配方里用
 * `not: { all: [flag setAvatarNickname, has nickname] }` 表达这个互斥。
 */
const modifyProfileGate: ChainCondition = {
  all: [{ flag: 'setAvatarNickname' }, { has: 'nickname' }],
}

export const xhsChain: ChainRecipe = {
  before: [
    { action: 'switch-container', when: { flag: 'switchContainer' } },
    { action: 'set-proxy', when: { flag: 'setProxyBeforeLogin' } },
    { action: 'reset-device', when: { flag: 'resetDeviceBeforeLogin' } },
  ],
  afterLogin: [
    { action: 'set-following-comments', when: { flag: 'onlyFollowingComments' } },
    {
      action: 'modify-profile',
      when: modifyProfileGate,
      params: { nickname: '${nickname}' },
    },
    {
      // 只在与「改资料」互斥时这里才绑定；改资料路径交给 afterAction。
      action: 'bind-phone',
      when: { all: [{ flag: 'enableBindPhone' }, { not: modifyProfileGate }] },
    },
    {
      // 改资料路径下关注也延后到 afterAction；这里只覆盖无改资料的路径。
      action: 'follow-user',
      when: { all: [{ has: 'followKeywords' }, { not: modifyProfileGate }] },
    },
  ],
  afterAction: {
    // 旧版 MODIFY_PROFILE 成功 → 绑定（有未用账号）→ 关注。
    'modify-profile': [
      { action: 'bind-phone', when: { flag: 'enableBindPhone' }, params: { afterProfile: 'true' } },
      { action: 'follow-user', when: { has: 'followKeywords' } },
    ],
  },
  finalize: [
    { action: 'backup', when: { flag: 'autoBackupAfterLogin' } },
    { action: 'clear', when: { flag: 'autoClearAfterBackup' } },
  ],
  loopBackTo: 'login',
}

/** 小红书业务包。 */
export const xhsPack: FlowPack = {
  id: 'xhs',
  title: '小红书',
  actions: xhsActions,
  chain: xhsChain,
  register: registerXhsFlows,
}
