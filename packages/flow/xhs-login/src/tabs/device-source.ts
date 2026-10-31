/**
 * 设备登录源（**1:1 移植**自 `auto_fb/wz_models.py: DeviceSource`）。
 *
 * 旧实现只把登录源存在内存的 `DeviceRowState.source` 里，重启即丢；
 * 这里落盘到 `device-sources.json`，按 `deviceId` 索引。
 *
 * 三种类型与旧版一致：
 * - `bundle`：备份包路径（.zip / .tar.bak / .bak / 目录）
 * - `sid`：`sid----uid`
 * - `sms`：`手机号----验证码网页URL`（可选国家码）
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SourceKind } from './login-tab.ts'

/** 单个设备的登录源。 */
export interface DeviceSource {
  kind: SourceKind
  /** 原始值；`none` 时为空串。 */
  value: string
  /** 展示用摘要；`none` 时为空串（旧 `DeviceSource.summary()` 同样返回空）。 */
  summary: string
}

/** 空登录源。 */
export const EMPTY_SOURCE: DeviceSource = { kind: 'none', value: '', summary: '' }

/** 旧 `DeviceSource.summary()`：有值就显示原值。 */
export function summarizeSource(kind: SourceKind, value: string): string {
  if (kind === 'none' || !value.trim()) return ''
  return value.trim()
}

/**
 * 校验并规范化登录源（旧 `parse_sms_code_login` 的格式约束）。
 *
 * @throws 值不合法时抛错，由接口转成 400。
 */
export function normalizeSource(kind: SourceKind, rawValue: string): DeviceSource {
  const value = rawValue.trim()
  if (kind === 'none') return { ...EMPTY_SOURCE }
  if (!value) throw new Error('登录源不能为空')

  if (kind === 'sid') {
    // 旧版用 `----` 分隔 sid 与 uid（也接受 `|`）。
    const parts = value.includes('----') ? value.split('----') : value.split('|')
    if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
      throw new Error('sid 格式应为 `sid----uid`')
    }
  }

  if (kind === 'sms') {
    // 旧 `device_source()` 存成 `区号-值`（单横线），值内部再用 `----` 连手机号与 URL。
    // 例：`+1-13800138000----https://example.com/code`
    if (!/^\+\d+-/.test(value)) {
      throw new Error('验证码登录格式应为 `区号-手机号----验证码网页URL`（区号如 +1）')
    }
    if (!/\d{6,15}/.test(value)) throw new Error('验证码登录缺少有效手机号')
  }

  return { kind, value, summary: summarizeSource(kind, value) }
}

/** 登录源存储：`deviceId → DeviceSource`，落盘 JSON。 */
export class SourceStore {
  private readonly file: string
  private map: Record<string, DeviceSource> = {}
  private loaded = false

  constructor(file: string) {
    this.file = file
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, DeviceSource>
      this.map = parsed ?? {}
    } catch {
      // 文件不存在或损坏：从空开始（与旧版重启后登录源丢失的行为一致）。
      this.map = {}
    }
  }

  /** 读单个设备的登录源。 */
  async get(deviceId: string): Promise<DeviceSource> {
    await this.ensureLoaded()
    return this.map[deviceId] ?? { ...EMPTY_SOURCE }
  }

  /** 批量读（构造设备行时避免 N 次 IO）。 */
  async all(): Promise<Record<string, DeviceSource>> {
    await this.ensureLoaded()
    return { ...this.map }
  }

  /** 写单个设备的登录源并落盘。 */
  async set(deviceId: string, source: DeviceSource): Promise<void> {
    await this.ensureLoaded()
    if (source.kind === 'none') delete this.map[deviceId]
    else this.map[deviceId] = source
    await this.persist()
  }

  /** 原子写（旧实现没有落盘，这里是新增能力）。 */
  private async persist(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify(this.map, null, 2), 'utf8')
    await rename(tmp, this.file)
  }
}
