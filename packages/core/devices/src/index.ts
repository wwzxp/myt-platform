import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import type { ContainerInfo } from '@myt/myt-host'

/** 平台设备实体（ADR-0002）：`deviceId` 是身份，其余是可变属性。 */
export interface DeviceRecord {
  deviceId: string
  /** Docker 容器 id；rename 不变、重建变化。 */
  externalId: string
  name: string
  hostIp: string
  slotIndex: number
  adbPort: number | null
  state: string
  firstSeen: number
  lastSeen: number
  /** 墓碑：容器已从宿主消失，历史保留、不再调度。 */
  deleted: boolean
}

export interface DeviceRegistryConfig {
  /** 状态文件路径；缺省时不落盘（仅内存）。 */
  stateFile?: string
}

/**
 * 设备登记与对账。
 *
 * 每次 `reconcile()` 拿宿主快照与已有记录比对：
 * - 新出现的容器 → 生成 `deviceId`（UUID，永不回收）；
 * - 已存在的 → 只更新可变属性（name / slot / adb / state）；
 * - 本次未出现的 → 打墓碑 `deleted=true`，不删除记录。
 *
 * 容器匹配优先用 `externalId`（Docker id），它不受 rename 影响。
 */
export class DeviceRegistry extends Service {
  private readonly stateFile: string | undefined
  private readonly byExternalId = new Map<string, DeviceRecord>()
  private loaded = false

  constructor(ctx: ConstructorParameters<typeof Service>[0], config: DeviceRegistryConfig = {}) {
    super(ctx, 'devices')
    this.stateFile = config.stateFile
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    if (!this.stateFile) return
    try {
      const raw = await readFile(this.stateFile, 'utf8')
      const rows = JSON.parse(raw) as DeviceRecord[]
      for (const row of rows) this.byExternalId.set(row.externalId, row)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
    }
  }

  private async save(): Promise<void> {
    if (!this.stateFile) return
    await mkdir(dirname(this.stateFile), { recursive: true })
    const tmp = `${this.stateFile}.tmp`
    const rows = [...this.byExternalId.values()]
    await writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8')
    await rename(tmp, this.stateFile)
  }

  /** 用一次宿主快照对账，返回该宿主下的全部设备记录（含墓碑）。 */
  async reconcile(hostIp: string, containers: ContainerInfo[]): Promise<DeviceRecord[]> {
    await this.ensureLoaded()
    const now = Date.now()
    const seen = new Set<string>()

    for (const container of containers) {
      const key = container.externalId
      if (!key) continue
      seen.add(key)
      let record = this.byExternalId.get(key)
      if (!record) {
        record = {
          deviceId: randomUUID(),
          externalId: key,
          name: container.name,
          hostIp,
          slotIndex: container.slotIndex,
          adbPort: container.adbPort,
          state: container.state,
          firstSeen: now,
          lastSeen: now,
          deleted: false,
        }
        this.byExternalId.set(key, record)
        continue
      }
      record.name = container.name
      record.hostIp = hostIp
      record.slotIndex = container.slotIndex
      record.adbPort = container.adbPort
      record.state = container.state
      record.lastSeen = now
      record.deleted = false
    }

    for (const record of this.byExternalId.values()) {
      if (record.hostIp !== hostIp || seen.has(record.externalId)) continue
      record.deleted = true
    }

    await this.save()
    return this.list({ hostIp })
  }

  /** 列出设备；默认排除墓碑。 */
  list(filter: { hostIp?: string; includeDeleted?: boolean } = {}): DeviceRecord[] {
    const rows = [...this.byExternalId.values()].filter((record) => {
      if (!filter.includeDeleted && record.deleted) return false
      if (filter.hostIp && record.hostIp !== filter.hostIp) return false
      return true
    })
    rows.sort((a, b) => a.hostIp.localeCompare(b.hostIp) || a.slotIndex - b.slotIndex || a.name.localeCompare(b.name))
    return rows
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    devices: DeviceRegistry
  }
}

/** Cordis Loader 按包名导入时要求默认导出。 */
export default DeviceRegistry
