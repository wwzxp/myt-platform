/**
 * 登录前置动作。
 *
 * 三个动作：起容器、设代理、一键新机。它们不走流程引擎（除了
 * `reset-device` 的安卓 12 分支），因为都是「调 SDK + 等设备恢复」。
 *
 * 每个动作都开一条 run 记录——旧版只写到日志面板，UI 上看不到发生了什么。
 */

import type { ChainState } from './tabs/login-chain.ts'
import { waitForStableAdb } from './tabs/job-scheduler.ts'
import type { ProxyPool } from './tabs/proxy-pool.ts'
import type { FlowDefinition } from '@myt/flow'

/** 前置动作依赖的服务。 */
export interface PreStepDeps {
  /** 按 deviceId 找设备；找不到返回 undefined。 */
  findDevice(deviceId: string): { deviceId: string; name: string; hostIp: string } | undefined
  /** 起容器（force 表示已运行也重启）。 */
  startContainer(hostIp: string, name: string, options: { force: boolean }): Promise<void>
  /** 列出某宿主上的容器。 */
  listContainers(hostIp: string): Promise<ReadonlyArray<{ name: string; image: string }>>
  /** V3：随机切机型。 */
  randomSwitchModel(hostIp: string, name: string, androidVersion: string): Promise<{ ok: boolean }>
  /** 连接 adb。 */
  connect(serial: string): Promise<unknown>
  /** 执行 adb shell。 */
  shell(serial: string, command: string, options: { check: boolean }): Promise<string>
  /** 设置 s5 代理。 */
  setS5Proxy(options: {
    deviceIp: string
    apiPort: number
    proxyIp: string
    proxyPort: number
    username: string
    password: string
    timeoutMs: number
  }): Promise<boolean>
  /** 解析流程。 */
  resolveFlow(flowId: string, params: Record<string, string>): FlowDefinition | null
  /** 跑一个流程；成功返回 true。 */
  runFlow(flow: FlowDefinition, chain: ChainState, signal: AbortSignal): Promise<boolean>
  /** 链动作 → 流程 id。 */
  chainFlows(): Readonly<Record<string, string>>
  /** 开一条 run 记录。 */
  startRun(flowId: string, deviceId: string, serial: string): { runId: string }
  /** 标记步骤开始。 */
  stepStarted(runId: string, stepId: string, label: string): void
  /** 标记步骤成功。 */
  stepSucceeded(runId: string, stepId: string, durationMs: number, note: string): void
  /** 标记步骤失败。 */
  stepFailed(runId: string, stepId: string, durationMs: number, kind: string, note: string): void
  /** 结束 run。 */
  finishRun(runId: string, status: 'succeeded' | 'failed', steps: number, error?: string): void
  /** 代理池；没配则为 null。 */
  proxyPool: ProxyPool | null
  /** yadb 路径。 */
  yadbPath: string
}

/**
 * 执行一个登录前置动作。
 *
 * @param action - 动作 id。
 * @param chain - 链状态（含设备与运行开关）。
 * @param signal - 取消信号。
 * @param deps - 依赖的服务。
 * @returns 成功返回 true；失败返回 false（run 记录里已写明原因）。
 */
export async function runPreStep(
  action: 'switch-container' | 'set-proxy' | 'reset-device',
  chain: ChainState,
  signal: AbortSignal,
  deps: PreStepDeps,
): Promise<boolean> {
  const device = deps.findDevice(chain.deviceId)
  if (!device) return false

  const run = deps.startRun(`pre:${action}`, chain.deviceId, chain.serial)
  deps.stepStarted(run.runId, action, action)
  const startedAt = Date.now()
  const finish = (ok: boolean, note: string): boolean => {
    if (ok) {
      deps.stepSucceeded(run.runId, action, Date.now() - startedAt, note)
      deps.finishRun(run.runId, 'succeeded', 1)
    } else {
      deps.stepFailed(run.runId, action, Date.now() - startedAt, 'precondition', note)
      deps.finishRun(run.runId, 'failed', 0, action)
    }
    return ok
  }

  const waitAdb = async (stableSeconds: number): Promise<string> =>
    waitForStableAdb({
      isOnline: async () => {
        try {
          await deps.connect(chain.serial)
          const out = await deps.shell(chain.serial, 'getprop ro.serialno', { check: false })
          return out.trim().length > 0
        } catch {
          return false
        }
      },
      reconnect: async () => {
        await deps.connect(chain.serial)
      },
      timeoutSeconds: 120,
      stableSeconds,
      isCancelled: () => signal.aborted,
    })

  if (action === 'switch-container') {
    try {
      await deps.startContainer(device.hostIp, device.name, { force: true })
    } catch {
      return finish(false, '启动容器失败')
    }
    const result = await waitAdb(20)
    return finish(result === 'ok', result === 'ok' ? '容器已就绪' : `等待 ADB 超时（${result}）`)
  }

  if (action === 'set-proxy') {
    // 代理在批调度前已由 ProxyPool 分配，这里只做接口调用。
    const proxy = deps.proxyPool?.getForDevice(chain.deviceId)
    if (!proxy) return finish(true, '未分配代理，跳过')
    try {
      const ok = await deps.setS5Proxy({
        deviceIp: device.hostIp,
        apiPort: 10008,
        proxyIp: proxy.ip,
        proxyPort: Number(proxy.port) || 1080,
        username: proxy.username,
        password: proxy.password,
        timeoutMs: 30_000,
      })
      return finish(ok, ok ? `代理已设置 ${proxy.ip}` : '代理设置失败')
    } catch {
      return finish(false, '代理设置异常')
    }
  }

  if (action === 'reset-device') {
    const container = (await deps.listContainers(device.hostIp)).find((c) => c.name === device.name)
    const androidType = parseAndroidVersion(container?.image ?? '')

    if (androidType !== null && androidType !== 0 && androidType !== 12) {
      // V3：随机切机型。
      try {
        const result = await deps.randomSwitchModel(device.hostIp, device.name, String(androidType))
        if (!result.ok) return finish(false, `V3 机型切换失败（Android ${androidType}）`)
      } catch (error) {
        return finish(false, `V3 机型切换异常: ${error instanceof Error ? error.message : String(error)}`)
      }
    } else {
      // 安卓 12 / 非魔云腾：一键新机流程。
      const flowId = deps.chainFlows()['reset-device']
      const models = (chain.run.flags['resetDeviceModels'] as Array<{ brand: string; model: string }> | undefined) ?? []
      const flow = flowId
        ? deps.resolveFlow(flowId, {
            brand: models[0]?.brand ?? '',
            model: models[0]?.model ?? '',
            overseasRandom:
              chain.run.flags['resetOverseasRandom'] !== false && chain.run.flags['resetOverseasRandom'] !== 'false'
                ? 'true'
                : 'false',
          })
        : null
      if (!flow) return finish(false, '一键新机流程未注册')
      const ok = await deps.runFlow(flow, chain, signal)
      if (!ok) return finish(false, '一键新机失败: 超时或 UI 节点未找到')
    }

    // 换机型会改 MAC 导致网络中断，等 ADB 真正恢复。
    const recovered = await waitAdb(15)
    return finish(recovered === 'ok', recovered === 'ok' ? '换机型完成，ADB 已恢复' : `换机型后 ADB 未恢复（${recovered}）`)
  }

  return finish(true, '无需处理')
}

/**
 * 从镜像名解析安卓主版本号。
 *
 * 镜像名形如 `android12_x86_64`；解析不出来返回 null。
 * @param image - 容器镜像名。
 */
export function parseAndroidVersion(image: string): number | null {
  const match = /android\s*(\d+)/iu.exec(image)
  if (!match) return null
  const version = Number(match[1])
  return Number.isInteger(version) ? version : null
}
