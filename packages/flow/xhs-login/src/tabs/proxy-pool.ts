/**
 * S5 代理池（移植自 `device_tab.py:2672-2720` 的 `ProxyPool`）。
 *
 * 旧版语义：
 * - 每条代理最多分给 `machinesPerIp` 台设备
 * - `acquire` 用**轮转游标**从当前位置找第一条未满的，避免总是压同一条
 * - `release` 按设备回收（一个设备可能占多条时只回收第一条）
 */

/** 一条代理。 */
export interface ProxyEntry {
  /** 原始文本（如 `ip:port:user:pass`）。 */
  raw: string
  ip: string
  port: string
  username: string
  password: string
  /** 已分配给多少设备。 */
  useCount: number
  /** 占用它的设备序列号。 */
  deviceSerials: string[]
}

/**
 * 解析代理文本（旧 `parse_proxy_text`）。
 *
 * 支持两种分隔：`ip:port:user:pass` 与 `ip:port`。
 * 返回 null 表示格式不合法。
 */
export function parseProxyText(raw: string): { ip: string; port: string; username: string; password: string } | null {
  const parts = raw.trim().split(':')
  if (parts.length < 2) return null
  const ip = parts[0]?.trim() ?? ''
  const port = parts[1]?.trim() ?? ''
  if (!ip || !/^\d+$/.test(port)) return null
  return {
    ip,
    port,
    username: parts[2]?.trim() ?? '',
    password: parts.slice(3).join(':').trim(),
  }
}

/** 代理池。 */
export class ProxyPool {
  private readonly entries: ProxyEntry[]
  private readonly machinesPerIp: number
  private cursor = 0

  constructor(rawList: string[], machinesPerIp: number) {
    this.machinesPerIp = Math.max(1, machinesPerIp)
    this.entries = []
    for (const raw of rawList) {
      const parsed = parseProxyText(raw)
      if (!parsed) continue
      this.entries.push({ raw: raw.trim(), ...parsed, useCount: 0, deviceSerials: [] })
    }
  }

  /** 有效代理条数。 */
  get size(): number {
    return this.entries.length
  }

  /**
   * 为设备分配一条代理（旧 `acquire`）。
   *
   * 从游标位置轮转查找第一条未满的；全满返回 null。
   */
  acquire(deviceSerial: string): ProxyEntry | null {
    const n = this.entries.length
    if (n === 0) return null
    for (let i = 0; i < n; i += 1) {
      const entry = this.entries[(this.cursor + i) % n]!
      if (entry.useCount < this.machinesPerIp) {
        entry.useCount += 1
        if (!entry.deviceSerials.includes(deviceSerial)) entry.deviceSerials.push(deviceSerial)
        this.cursor = (this.cursor + i + 1) % n
        return entry
      }
    }
    return null
  }

  /** 查设备当前占用的代理（旧 `get_for_device`）。 */
  getForDevice(deviceSerial: string): ProxyEntry | null {
    for (const entry of this.entries) {
      if (entry.deviceSerials.includes(deviceSerial)) return entry
    }
    return null
  }

  /** 回收设备占用的代理（旧 `release`），返回被回收的 ip。 */
  release(deviceSerial: string): string {
    for (const entry of this.entries) {
      const index = entry.deviceSerials.indexOf(deviceSerial)
      if (index >= 0) {
        entry.deviceSerials.splice(index, 1)
        entry.useCount = Math.max(0, entry.useCount - 1)
        return entry.ip
      }
    }
    return ''
  }
}

/**
 * 计算需要多少条代理（旧 `run_batch_action` 里的 `math.ceil`）。
 *
 * @param totalSlots 设备/容器总数
 * @param machinesPerIp 每条代理覆盖的机器数
 */
export function requiredProxyCount(totalSlots: number, machinesPerIp: number): number {
  return Math.ceil(totalSlots / Math.max(1, machinesPerIp))
}
