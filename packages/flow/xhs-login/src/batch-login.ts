/**
 * 批量登录编排。
 *
 * 本模块只做三件事：校验输入、把设备排成可执行链、按 IP 分批点火。
 * 它不碰 HTTP，也不碰 Cordis——依赖全部通过 `Deps` 注入，因此可以直接
 * 用假依赖做行为测试。
 */

import type { ChainRecipe, FlowDefinition } from '@myt/flow'
import { HeroSmsClient, loginWithHeroSms } from '@myt/flow-xhs'
import { advanceChain, beginChain } from './tabs/login-chain.ts'
import { loginParamsOf, runChain } from './chain-runner.ts'
import type { ChainDeps } from './chain-runner.ts'
import type { ChainState, ChainStep } from './tabs/login-chain.ts'
import { hostIpOf, planIpBatches } from './tabs/job-scheduler.ts'
import { ProxyPool, requiredProxyCount } from './tabs/proxy-pool.ts'

/** 编排依赖的服务；由 HTTP 插件从 `ctx` 取出来注入。 */
export interface Deps {
  /** 列出当前所有设备（含状态与宿主 IP）。 */
  listDevices(): ReadonlyArray<{ deviceId: string; state: string; hostIp: string }>
  /** 某设备是否已有运行中的任务。 */
  hasRunningRun(deviceId: string): boolean
  /** 读取持久化的批导入配置。 */
  loadImportConfig(): Promise<{ bindAccounts: Array<{ phone: string; url: string }> }>
  /** 执行登录前动作（容器切换 / 代理 / 一键新机）；成功返回 true。 */
  runPreStep(
    chain: ChainState,
    action: 'switch-container' | 'set-proxy' | 'reset-device',
    signal: AbortSignal,
    proxyPool: ProxyPool | null,
  ): Promise<boolean>
  /** 解析流程 id 为可执行流程；未注册返回 null。 */
  resolveFlow(flowId: string, params: Record<string, string>): FlowDefinition | null
  /** 在设备上跑一个流程；成功返回 true。 */
  runFlow(flow: FlowDefinition, chain: ChainState, params: Record<string, string>, signal: AbortSignal): Promise<boolean>
  /** 取链动作 → 流程 id 的映射（含 `login` 与 `clear`）。 */
  chainFlows(): Readonly<Record<string, string>>
  /** yadb 路径；随应用分发。 */
  yadbPath: string
  /**
   * 推送 yadb 与设置输入法（尽力而为，失败不阻断）。
   * 中文输入依赖 ADBKeyboard，yadb 通道依赖本地二进制。
   */
  prepareDevice(chain: ChainState): Promise<void>
  /** 读设备登录源；无来源时返回空字符串值。 */
  getSource(deviceId: string): Promise<{ kind: string; value: string }>
  /** 取一条未使用的绑定账号。 */
  pickBindAccount(config: { bindAccounts: Array<{ phone: string; url: string }> }): {
    account: { phone: string; url: string } | null
    index: number
  }
  /** 回写绑定账号状态。 */
  updateBindAccount(index: number, statusText: string, serial: string): Promise<void>
  /** 读 LLM 配置。 */
  loadLlm(): Promise<{ baseUrl: string; model: string; apiKey: string }>
  /** 记录/清除该设备的取消句柄。 */
  setCancel(deviceId: string, controller: AbortController | null): void
  /** 记录一条编排层异常（没有对应 run 记录时用）。 */
  recordOrchestrationError(message: string): void
  /** 延迟调用（测试可替换成立即执行）。 */
  schedule(delayMs: number, fn: () => void): void
}

/** HeroSMS 相关开关，来自请求体的 `options`。 */
export interface HeroSmsFlags {
  apiKey: string
  countryId?: number | undefined
}

/** 编排结果：要么是接受的任务清单，要么是校验失败原因。 */
export type BatchResult =
  | { ok: true; accepted: ReadonlyArray<Record<string, unknown>>; flags: Record<string, unknown> }
  | { ok: false; status: number; error: string }

/** 请求体里与登录相关的部分。 */
export interface BatchInput {
  rows: ReadonlyArray<{ deviceId: string; serial: string }>
  login: { phone: string; countryCode: string; codeUrl: string; stopAfterSendCode: boolean }
  options: Record<string, unknown>
}

/**
 * 校验并启动一批登录。
 *
 * 校验顺序沿用旧实现：先看有没有可跑的设备，再看 SMS 循环与清数据的
 * 搭配，最后看前置动作需要的资源够不够。任何一步不满足都整体拒绝，
 * 不做部分执行——半批启动比拒绝更难排查。
 *
 * @param input - 已从请求体解析出的登录参数。
 * @param deps - 编排依赖的服务。
 * @param recipe - 链式配方；null 表示只登录、不跑前置动作。
 * @returns 接受的任务清单，或带状态码的拒绝原因。
 */
export async function startBatchLogin(
  input: BatchInput,
  deps: Deps,
  recipe: ChainRecipe | null,
): Promise<BatchResult> {
  const { rows, login, options: opts } = input

  if (rows.length === 0) return { ok: false, status: 400, error: '请先选择设备' }
  if (!login?.phone) return { ok: false, status: 400, error: '缺少登录手机号' }

  const saved = await deps.loadImportConfig()
  const loopCount = Number(opts['loginLoopCount'] ?? 1) || 1

  // UI 传的 options 优先，缺的字段回落到持久化配置。
  const runFlags: Record<string, unknown> = {
    ...saved,
    ...opts,
    loginLoopCount: loopCount,
    smsPhone: login.phone,
    smsCountryCode: login.countryCode,
    smsCodeUrl: login.codeUrl,
    stopAfterSendCode: login.stopAfterSendCode,
  }

  const flagIsOn = (key: string): boolean => runFlags[key] === true

  if (loopCount > 1 && !flagIsOn('clearData')) {
    return { ok: false, status: 400, error: '多次循环必须勾选「清除数据」，否则第二次会复用已登录态' }
  }

  if (flagIsOn('setAvatarNickname')) {
    const totalSlots = rows.length * loopCount
    const avatars = Number(opts['avatarsAvailable'] ?? 0)
    const nicknames = Number(opts['nicknamesAvailable'] ?? 0)
    if (avatars < totalSlots) {
      return { ok: false, status: 400, error: `头像不足：需要 ${totalSlots} 个，只有 ${avatars} 个` }
    }
    if (nicknames < totalSlots) {
      return { ok: false, status: 400, error: `昵称不足：需要 ${totalSlots} 个，只有 ${nicknames} 个` }
    }
  }

  // 代理池：勾了「登录前设置代理」才建。没勾就是 null，前置动作会跳过。
  let proxyPool: ProxyPool | null = null
  if (flagIsOn('setProxyBeforeLogin')) {
    const proxies = Array.isArray(opts['proxies']) ? (opts['proxies'] as string[]) : []
    if (proxies.length === 0) {
      return { ok: false, status: 400, error: '勾选了「登录前设置代理」但没有代理列表' }
    }
    const perIp = Number(opts['proxyMachinesPerIp'] ?? 1) || 1
    const needed = requiredProxyCount(rows.length, perIp)
    if (proxies.length < needed) {
      return { ok: false, status: 400, error: `代理不足：需要 ${needed} 个，只有 ${proxies.length} 个` }
    }
    proxyPool = new ProxyPool(proxies, perIp)
  }

  const devices = deps.listDevices()
  const accepted: Array<Record<string, unknown>> = []
  const runnable: Array<{ row: { deviceId: string; serial: string }; chain: ChainState }> = []

  for (const row of rows) {
    if (!row.serial) continue
    // 已有任务的设备直接跳过，不排队。
    if (deps.hasRunningRun(row.deviceId)) continue

    const device = devices.find((d) => d.deviceId === row.deviceId)
    const switchNeeded = Boolean(device && device.state !== 'running')

    const chain: ChainState = {
      deviceId: row.deviceId,
      serial: row.serial,
      action: '',
      history: [],
      run: {
        flags: runFlags,
        data: {},
        loopRemaining: loopCount,
        retryRemaining: Number(runFlags['loginRetryCount'] ?? 0) || 0,
        done: new Set<string>(),
      },
      bindAccountIndex: -1,
    }
    // 代理按设备序列号分配；池为 null 时跳过（未勾选）。
    proxyPool?.acquire(row.serial)
    accepted.push({ deviceId: row.deviceId, serial: row.serial, switchNeeded })
    runnable.push({ row, chain })
  }

  if (runnable.length === 0) {
    return { ok: false, status: 409, error: '没有可执行的设备（已有任务运行中或序列号为空）' }
  }

  const controller = new AbortController()
  const flows = deps.chainFlows()

  // 重试前清数据：只有勾了 clearData 才跑。
  const clearBeforeRetry = async (chain: ChainState): Promise<void> => {
    const clearData = chain.run.flags['clearData'] === true || chain.run.flags['clearData'] === 'true'
    if (!clearData) return
    const flowId = flows['clear'] ?? ''
    if (!flowId) return
    const flow = deps.resolveFlow(flowId, {})
    if (!flow) return
    await deps.runFlow(flow, chain, {}, controller.signal)
  }

  /** 把编排层的 `Deps` 适配成链执行器要的形状。 */
  const chainDeps = (_chain: ChainState): ChainDeps => ({
    resolveFlow: deps.resolveFlow,
    runFlow: deps.runFlow,
    chainFlows: deps.chainFlows,
    getSource: deps.getSource,
    loadImportConfig: deps.loadImportConfig,
    pickBindAccount: deps.pickBindAccount,
    updateBindAccount: deps.updateBindAccount,
    loadLlm: deps.loadLlm,
    prepareDevice: deps.prepareDevice,
    yadbPath: deps.yadbPath,
    setCancel: deps.setCancel,
    recordError: (_c, msg) => deps.recordOrchestrationError(msg),
  })

  const executeChain = async (chain: ChainState): Promise<void> => {
    try {
      if (!recipe) return
      // 前置动作（容器切换 / 代理 / 一键新机）先走完，再进主链。
      let step: ChainStep | null = beginChain(recipe, chain)
      while (step && step.action !== 'login') {
        const ok = await deps.runPreStep(
          chain,
          step.action as 'switch-container' | 'set-proxy' | 'reset-device',
          controller.signal,
          proxyPool,
        )
        if (!ok) return
        step = advanceChain(recipe, chain, step.action)
      }
      if (!step) return

      const hero = heroFlagsOf(chain.run.flags)
      const login = loginParamsOf(chain, input.login)
      if (runFlags['smsProvider'] === 'herosms' && hero) {
        // HeroSMS 编排自带 2 次重试与 finally 取消，外层不再叠加 retryRemaining。
        const client = new HeroSmsClient(hero.apiKey)
        const outcome = await loginWithHeroSms({
          client,
          countryId: hero.countryId ?? 0,
          countryCode: String(chain.run.flags['smsCountryCode'] ?? ''),
          maxPrice: Number(chain.run.flags['smsMaxPrice'] ?? 0),
          attemptLogin: async (phone) =>
            runChain(chain, 'login', recipe, { ...login, phone }, chainDeps(chain)),
        })
        if (!outcome.ok) await clearBeforeRetry(chain)
      } else {
        // 主链：登录成功后按配方继续（改资料 → 绑定 → 关注 → 收尾）。
        await runChain(chain, 'login', recipe, login, chainDeps(chain))
      }
    } catch (error) {
      deps.recordOrchestrationError(error instanceof Error ? error.message : String(error))
    }
  }

  const batchSize = Number(runFlags['sameIpBatchSize'] ?? 3) || 3
  const intervalSeconds = Number(runFlags['batchIntervalSeconds'] ?? 10) || 10
  const plan = planIpBatches(
    runnable.map((item) => ({ hostIp: hostIpOf(item.row.serial), payload: item })),
    batchSize,
    intervalSeconds,
  )
  for (const batch of plan) {
    const fire = (): void => {
      for (const job of batch.jobs) void executeChain(job.payload.chain)
    }
    if (batch.delayMs === 0) fire()
    else deps.schedule(batch.delayMs, fire)
  }

  return { ok: true, accepted, flags: runFlags }
}

/** 从 runFlags 里取出短信平台开关。 */
function heroFlagsOf(flags: Record<string, unknown>): HeroSmsFlags | null {
  const hero = flags['heroSms'] as { apiKey?: string; countryId?: number } | undefined
  if (!hero?.apiKey) return null
  return { apiKey: hero.apiKey, countryId: hero.countryId }
}

