/**
 * 同 IP 分批调度（移植自 `device_tab.py:3554-3580` 的 `submit_login_jobs_in_ip_batches`）。
 *
 * 旧版语义：
 * - 按设备 IP 分组
 * - 每组按 `sameIpBatchSize` 切块
 * - **每组第一块立即提交**，后续块按 `batchIndex * intervalMs` 延迟
 *
 * 为什么按 IP 分组：同一宿主机上的容器共享 CPU/网络，同时起太多会互相拖死。
 */

/** 一条待提交的任务。 */
export interface PendingJob<T> {
  /** 设备所属宿主 IP（决定分组）。 */
  hostIp: string
  payload: T
}

/** 一个提交批次。 */
export interface SubmitBatch<T> {
  /** 批次内的任务。 */
  jobs: Array<PendingJob<T>>
  /** 延迟毫秒数；0 表示立即。 */
  delayMs: number
}

/**
 * 计算提交计划（纯函数，便于单测）。
 *
 * @param jobs 所有待提交任务
 * @param batchSize 同 IP 同时启动数（最小 1）
 * @param intervalSeconds 批次间隔秒数（最小 1）
 */
export function planIpBatches<T>(
  jobs: Array<PendingJob<T>>,
  batchSize: number,
  intervalSeconds: number,
): Array<SubmitBatch<T>> {
  const size = Math.max(1, Math.floor(batchSize))
  const intervalMs = Math.max(1, Math.floor(intervalSeconds)) * 1000

  // 保持 IP 首次出现顺序（旧版用 ip_order 数组）。
  const byIp = new Map<string, Array<PendingJob<T>>>()
  for (const job of jobs) {
    const list = byIp.get(job.hostIp)
    if (list) list.push(job)
    else byIp.set(job.hostIp, [job])
  }

  const immediate: Array<SubmitBatch<T>> = []
  const delayed: Array<SubmitBatch<T>> = []

  for (const list of byIp.values()) {
    // 切块
    const chunks: Array<Array<PendingJob<T>>> = []
    for (let i = 0; i < list.length; i += size) {
      chunks.push(list.slice(i, i + size))
    }
    if (chunks.length === 0) continue
    // 每组第一块立即，其余排队
    immediate.push({ jobs: chunks[0]!, delayMs: 0 })
    for (let i = 1; i < chunks.length; i += 1) {
      delayed.push({ jobs: chunks[i]!, delayMs: i * intervalMs })
    }
  }

  return [...immediate, ...delayed]
}

/** 从 ADB 序列号（`ip:port`）取宿主 IP。 */
export function hostIpOf(serial: string): string {
  const idx = serial.lastIndexOf(':')
  return idx > 0 ? serial.slice(0, idx) : serial
}

/**
 * 容器切换等待（移植自 `gui_device_worker.py:171-198`）。
 *
 * 旧版逻辑：切完后轮询 ADB，要求**持续稳定** `stableSeconds` 才算成功；
 * 掉线时每 10 秒重连一次。
 */
export interface SwitchWaitOptions {
  /** 单次探测：是否 `device` 状态。 */
  isOnline: () => Promise<boolean>
  /** 重连。 */
  reconnect: () => Promise<void>
  /** 总超时（秒）。 */
  timeoutSeconds: number
  /** 需要持续稳定的秒数。 */
  stableSeconds: number
  /** 进度回调。 */
  onProgress?: (message: string) => void
  /** 是否已取消。 */
  isCancelled?: () => boolean
  /** 轮询间隔（毫秒），默认 5000（旧版 `time.sleep(5)`）。 */
  pollMs?: number
  /** 重连间隔（毫秒），默认 10000。 */
  reconnectMs?: number
}

/** 等待结果。 */
export type SwitchWaitResult = 'ok' | 'timeout' | 'cancelled'

/**
 * 等待 ADB 持续稳定。
 *
 * @returns `ok` 表示稳定达标；`timeout` 表示超时；`cancelled` 表示被取消。
 */
export async function waitForStableAdb(options: SwitchWaitOptions): Promise<SwitchWaitResult> {
  const pollMs = options.pollMs ?? 5000
  const reconnectMs = options.reconnectMs ?? 10_000
  const deadline = Date.now() + options.timeoutSeconds * 1000

  let stableSince = 0
  let lastReconnect = 0

  while (Date.now() < deadline) {
    if (options.isCancelled?.()) return 'cancelled'

    let online = false
    try {
      online = await options.isOnline()
    } catch {
      // 探测失败按掉线处理（旧版同样吞掉异常）。
      online = false
    }

    if (online) {
      if (stableSince === 0) {
        stableSince = Date.now()
        options.onProgress?.(`设备在线，等待持续 ${options.stableSeconds} 秒稳定...`)
      } else if (Date.now() - stableSince >= options.stableSeconds * 1000) {
        return 'ok'
      }
    } else {
      if (stableSince > 0) options.onProgress?.('设备掉线，重新等待稳定...')
      stableSince = 0
      if (Date.now() - lastReconnect > reconnectMs) {
        try {
          await options.reconnect()
        } catch {
          // 重连失败不终止（下一轮继续）。
        }
        lastReconnect = Date.now()
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  return 'timeout'
}
