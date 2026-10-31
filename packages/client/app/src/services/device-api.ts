/**
 * 设备列表 API 客户端。
 *
 * 画布试跑需要选一台设备；走 `/api/devices` 拿当前宿主上的容器与状态。
 * 与 `workflow-api` 同一套请求封装，指向同一个内核。
 */

/** 内核地址（可用 `VITE_KERNEL_BASE` 覆盖，便于开发时指向其它端口）。 */
const KERNEL_BASE: string =
  (import.meta as unknown as { env?: Record<string, string> }).env?.['VITE_KERNEL_BASE'] ??
  'http://127.0.0.1:7788'

/** 一台可选设备（`/api/devices` 投影出来的一行）。 */
export interface SelectableDevice {
  deviceId: string
  name: string
  hostIp: string
  state: string
  /** ADB 序列号（`host:port`）；容器未运行时为空串。 */
  serial: string
}

/** 统一请求封装：非 2xx 抛出带服务端消息的错误。 */
async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${KERNEL_BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
  })
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // 响应体不是 JSON：保留状态码
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

/**
 * 列出可执行流程的设备。
 *
 * 只返回**运行中**的容器：未运行的容器没有 ADB 端点，选了也跑不了。
 * @returns 设备列表；`host` 省略时由内核用默认宿主。
 */
export async function listSelectableDevices(host?: string): Promise<SelectableDevice[]> {
  const query = host ? `?host=${encodeURIComponent(host)}` : ''
  const body = await request<{
    host: string
    devices: Array<{
      deviceId: string
      name: string
      hostIp: string
      state: string
      adbPort: number | null
    }>
  }>(`/api/devices${query}`)

  return body.devices
    .filter((device) => device.state === 'running' && device.adbPort)
    .map((device) => ({
      deviceId: device.deviceId,
      name: device.name,
      hostIp: device.hostIp,
      state: device.state,
      serial: `${device.hostIp}:${device.adbPort}`,
    }))
}
