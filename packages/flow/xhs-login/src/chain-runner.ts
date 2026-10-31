/**
 * 登录链执行器。
 *
 * 旧 kernel 里叫 `runChainStep`：跑一个链动作、成功就递归跑下一个，
 * 失败就终止该设备的链。与 `batch-login.ts` 的分工是——
 *
 * - `batch-login.ts` 决定「哪些设备、按什么顺序点火」；
 * - 本模块决定「一台设备上，链怎么一步步走完」。
 *
 * 拆开的原因：前者是调度（批、IP 分组、延迟），后者是执行（参数拼装、
 * 绑定账号分配、状态回写）。混在一起时，任何一处改动都要通读两段。
 */

import type { ChainRecipe, FlowDefinition } from '@myt/flow'
import type { ChainState } from './tabs/login-chain.ts'
import { advanceChain } from './tabs/login-chain.ts'
import type { ProxyPool } from './tabs/proxy-pool.ts'

/** 链执行依赖的服务。 */
export interface ChainDeps {
  /** 解析流程 id。 */
  resolveFlow(flowId: string, params: Record<string, string>): FlowDefinition | null
  /** 跑一个流程；成功返回 true。 */
  runFlow(
    flow: FlowDefinition,
    chain: ChainState,
    params: Record<string, string>,
    signal: AbortSignal,
  ): Promise<boolean>
  /** 链动作 → 流程 id。 */
  chainFlows(): Readonly<Record<string, string>>
  /** 读设备登录源。 */
  getSource(deviceId: string): Promise<{ kind: string; value: string }>
  /** 读批导入配置。 */
  loadImportConfig(): Promise<{ bindAccounts: Array<{ phone: string; url: string }> }>
  /** 取一条未使用的绑定账号。 */
  pickBindAccount(config: { bindAccounts: Array<{ phone: string; url: string }> }): {
    account: { phone: string; url: string } | null
    index: number
  }
  /** 回写绑定账号状态。 */
  updateBindAccount(index: number, statusText: string, serial: string): Promise<void>
  /** 读 LLM 配置。 */
  loadLlm(): Promise<{ baseUrl: string; model: string; apiKey: string }>
  /** 推送 yadb 与设置输入法（尽力而为）。 */
  prepareDevice(chain: ChainState): Promise<void>
  /** yadb 路径。 */
  yadbPath: string
  /** 该设备当前的取消句柄；null 表示没有。 */
  setCancel(deviceId: string, controller: AbortController | null): void
  /** 记录一条编排层异常。 */
  recordError(chain: ChainState, message: string): void
}

/** 登录参数（由登录源与 LLM 配置拼装）。 */
export interface LoginParams {
  phone: string
  countryCode: string
  codeUrl: string
  stopAfterSendCode: boolean
}

/**
 * 跑一条链。
 *
 * 从一个动作开始，成功后按配方推进；失败或没有下一步就终止。
 * 递归而非循环：配方可能在中途换分支（`afterAction`），递归让「下一步」
 * 的求值点集中在一处。
 *
 * @param chain - 链状态（会被就地修改：history 累加）。
 * @param action - 起始动作 id。
 * @param recipe - 链配方；null 表示只有一步。
 * @param login - 登录源参数（绑定手机号时会用到）。
 * @param deps - 依赖的服务。
 */
export async function runChain(
  chain: ChainState,
  action: string,
  recipe: ChainRecipe | null,
  login: LoginParams | null,
  deps: ChainDeps,
): Promise<boolean> {
  const flows = deps.chainFlows()
  const flowId = flows[action] ?? ''
  if (!flowId) return false

  const params = await buildParams(chain, action, login, deps)
  if (flowId === flows['login']) await deps.prepareDevice(chain)

  const flow = deps.resolveFlow(flowId, params)
  if (!flow) return false

  const controller = new AbortController()
  deps.setCancel(chain.deviceId, controller)
  try {
    const ok = await deps.runFlow(flow, chain, params, controller.signal)

    // 绑定账号任务结束后回写状态（旧 `_sync_bind_account_status_to_file`）。
    if (action === 'bind-phone' && chain.bindAccountIndex !== undefined && chain.bindAccountIndex >= 0) {
      try {
        // 旧版按 errorCode `already_bound` 区分：已绑定 → 清空状态（账号可复用）。
        await deps.updateBindAccount(chain.bindAccountIndex, ok ? '成功' : '', chain.serial)
      } catch {
        // 回写失败不阻断链（旧版同样只 log）。
      }
      chain.bindAccountIndex = -1
    }

    if (!ok) return false
    const next = recipe ? advanceChain(recipe, chain, action) : null
    // 没有下一步 = 链正常结束。
    if (!next) return true
    // 下一步继续跑（同一 chain 对象，history 会累加）。
    return runChain(chain, next.action, recipe, login, deps)
  } catch (error) {
    deps.recordError(chain, error instanceof Error ? error.message : String(error))
    return false
  } finally {
    deps.setCancel(chain.deviceId, null)
  }
}

/**
 * 拼装一次动作的参数。
 *
 * `bind-phone` 需要号码：优先用设备自己的登录源，没有就从「批导入 → 绑定账号」
 * 分配一条并记下索引，供任务结束后回写。
 *
 * @param chain - 链状态。
 * @param action - 当前动作 id。
 * @param login - 登录源参数。
 * @param deps - 依赖的服务。
 */
async function buildParams(
  chain: ChainState,
  action: string,
  login: LoginParams | null,
  deps: ChainDeps,
): Promise<Record<string, string>> {
  const llm = await deps.loadLlm()
  const params: Record<string, string> = {
    phone: '',
    countryCode: '+86',
    codeUrl: '',
    stopAfterSendCode: 'false',
    llmBaseUrl: llm.apiKey ? llm.baseUrl : '',
    llmModel: llm.model,
    llmApiKey: llm.apiKey,
    nickname: chain.run.data['nickname'] ?? '',
  }

  if (action === 'bind-phone') {
    const src = await deps.getSource(chain.deviceId)
    const matched = /^\+?\d*-(\d{6,15})----(.+)$/u.exec(src.value)
    if (matched) {
      params['phone'] = matched[1] ?? ''
      params['codeUrl'] = matched[2] ?? ''
    } else {
      const config = await deps.loadImportConfig()
      const { account, index } = deps.pickBindAccount(config)
      if (account) {
        params['phone'] = account.phone
        params['codeUrl'] = account.url
        // 记住本次用的是第几条，任务结束后回写状态。
        chain.bindAccountIndex = index
        chain.bindAccountSerial = chain.serial
      }
    }
  }

  if (login) {
    params['phone'] = login.phone
    params['countryCode'] = login.countryCode
    params['codeUrl'] = login.codeUrl
    params['stopAfterSendCode'] = login.stopAfterSendCode ? 'true' : 'false'
  }
  return params
}

/**
 * 从运行开关拼登录参数。
 *
 * HeroSMS 走取号流程，手机号/区号由取号结果决定，这里留空。
 * @param chain - 链状态。
 * @param fallback - UI 传的登录源；为空时用开关里的值。
 */
export function loginParamsOf(chain: ChainState, fallback: LoginParams | null): LoginParams {
  const hero = chain.run.flags['heroSms'] as
    | { apiKey?: string; countryId?: number; countryCode?: string; maxPrice?: number }
    | undefined
  const useHero = chain.run.flags['smsProvider'] === 'herosms' && Boolean(hero?.apiKey)
  return {
    phone: useHero ? '' : (fallback?.phone ?? ''),
    countryCode: useHero ? (hero?.countryCode ?? '+86') : (fallback?.countryCode ?? '+86'),
    codeUrl: useHero ? '' : (fallback?.codeUrl ?? ''),
    stopAfterSendCode: useHero ? false : fallback ? fallback.stopAfterSendCode : true,
  }
}

/** 未使用的参数占位，保持类型完整。 */
export type { ProxyPool }
