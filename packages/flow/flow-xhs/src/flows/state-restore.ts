/**
 * 登录态备份包恢复（移植自 `xhs_real_state_restore.py` + `xhs_real_state_common.py`）。
 *
 * 备份包结构（zip）：
 * ```
 * manifest.json
 * files/mmkv/com.xingin.xhs
 * files/mmkv/com.xingin.xhs.crc
 * ...
 * ```
 * manifest 每个条目：`{ name, group, present, path?, remote_path?, mode? }`。
 *
 * 恢复时的关键约束：
 * - 目标路径可能跨 3 个目录（mmkv / shared_prefs / app_webview），不能一律丢进 mmkv
 * - 必须按 group 过滤（`core` 只恢复 4 个登录文件，`full` 恢复全部）
 * - 每个文件都要 `chown` 到 App uid + `chmod`，最后 `restorecon` 重打 SELinux 标签
 *   （漏掉 restorecon 的典型症状：文件在位但 App 读不到，表现为「恢复成功却未登录」）
 */

import type { FlowDefinition, StepContext } from '@myt/flow'
import { sleep } from '@myt/human'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'
import { convertPackage } from '../data/bundle-convert.ts'

const XHS_PACKAGE = 'com.xingin.xhs'
const DATA_DIR = `/data/data/${XHS_PACKAGE}`
const MMKV_DIR = `${DATA_DIR}/files/mmkv`
const SHARED_PREFS_DIR = `${DATA_DIR}/shared_prefs`
const WEBVIEW_DIR = `${DATA_DIR}/app_webview_com.xingin.xhs`
const WEBVIEW_DEFAULT_DIR = `${WEBVIEW_DIR}/Default`

/** 旧 `FILE_GROUPS`：分组 → 文件名。 */
export const FILE_GROUPS = {
  core: ['com.xingin.xhs', 'com.xingin.xhs.crc', 'login_user_info_kv', 'login_user_info_kv.crc'],
  device_context: [
    'did_value_manager',
    'did_value_manager.crc',
    'kv_location',
    'kv_location.crc',
    'device_params_saver',
    'device_params_saver.crc',
  ],
  login_aux: [
    'change_account',
    'change_account.crc',
    'com.xingin.xhs_preferences',
    'com.xingin.xhs_preferences.crc',
  ],
  shared_prefs: [
    'device_info_file.xml',
    'ug_preload_device_info.xml',
    'pre_device.xml.xml',
    'cn.jiguang.sdk.device.xml',
    'ssoconfigs.xml',
    'cu_auth.xml',
    's.xml',
    'f.xml',
  ],
} as const

export type BundleGroup = keyof typeof FILE_GROUPS
export type RestoreMode = 'core' | 'full'

/** 旧 `MODE_GROUPS`：恢复模式 → 需要恢复的分组。 */
export const MODE_GROUPS: Record<RestoreMode, readonly BundleGroup[]> = {
  core: ['core'],
  full: ['core', 'device_context', 'login_aux', 'shared_prefs'],
}

/** 备份包 manifest 的单条文件记录。 */
export interface BundleEntry {
  name: string
  group: string
  present: boolean
  path?: string
  remote_path?: string
  mode?: string
}

/** 备份包 manifest。 */
export interface BundleManifest {
  package?: string
  context?: Record<string, unknown>
  files?: BundleEntry[]
}

/** 旧 `infer_mode_for_remote_path`：老格式包没有 mode 字段时按目录推断。 */
export function inferModeForRemotePath(remotePath: string): string {
  if (remotePath.startsWith(`${MMKV_DIR}/`)) return '700'
  if (remotePath.startsWith(`${SHARED_PREFS_DIR}/`)) return '660'
  return '600'
}

/** 解析 manifest（旧 `load_bundle` 的校验部分）。 */
export function parseManifest(raw: string): BundleManifest {
  const manifest = JSON.parse(raw) as BundleManifest
  if (manifest.package !== XHS_PACKAGE) {
    throw new Error(`备份包 package 不匹配：${manifest.package ?? '(缺失)'}`)
  }
  return manifest
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * 恢复备份包（旧 `restore_bundle`）。
 *
 * @param bundleDir 已解压的包目录（含 `manifest.json` 与 `files/`）
 * @param mode `core` 仅登录文件；`full` 含设备上下文、辅助、shared_prefs
 */
async function restoreBundle(
  ctx: StepContext,
  bundleDir: string,
  mode: RestoreMode,
): Promise<{ restored: number; skipped: number }> {
  const manifest = parseManifest(await readFile(join(bundleDir, 'manifest.json'), 'utf8'))

  await ctx.device.shell(ctx.serial, 'id', { root: true })
  const ownerUid = await ctx.device.appUid(ctx.serial, XHS_PACKAGE)
  if (!ownerUid) throw new Error('无法获取应用 uid（可能未安装）')

  await ctx.device.shell(ctx.serial, `mkdir -p ${quote(MMKV_DIR)}`, { root: true, check: false })
  await ctx.device.shell(ctx.serial, `chown ${ownerUid}:${ownerUid} ${quote(DATA_DIR)}`, {
    root: true,
    check: false,
  })

  const wanted = new Set<string>(MODE_GROUPS[mode])
  let restored = 0
  let skipped = 0

  for (const entry of manifest.files ?? []) {
    if (!entry.name || !entry.group) continue
    if (!wanted.has(entry.group)) continue
    if (!entry.present) {
      skipped += 1
      continue
    }

    const localPath = entry.path
      ? join(bundleDir, 'files', entry.path)
      : join(bundleDir, 'files', entry.name)
    let bytes: Buffer
    try {
      bytes = await readFile(localPath)
    } catch {
      // 文件缺失属于包不完整：计入 skipped（旧实现同样跳过而不失败）。
      skipped += 1
      continue
    }

    const remotePath = entry.remote_path || `${MMKV_DIR}/${entry.name}`
    const fileMode = entry.mode || inferModeForRemotePath(remotePath)

    const dir = await mkdtemp(join(tmpdir(), 'myt-bundle-'))
    try {
      const local = join(dir, entry.name)
      await writeFile(local, bytes)
      await ctx.device.pushPrivateFile(ctx.serial, local, remotePath, {
        ownerUid,
        mode: fileMode,
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
    restored += 1
    ctx.throwIfCancelled()
  }

  // SELinux：漏掉这步 = 「恢复成功但 App 读不到」。
  await ctx.device.shell(ctx.serial, `restorecon -RF ${quote(MMKV_DIR)}`, {
    root: true,
    check: false,
  })
  await ctx.device.shell(
    ctx.serial,
    `restorecon -RF ${quote(SHARED_PREFS_DIR)} ${quote(WEBVIEW_DIR)} ${quote(WEBVIEW_DEFAULT_DIR)}`,
    { root: true, check: false },
  )

  return { restored, skipped }
}

/**
 * 恢复流程（`xhs.state.restore`）。
 *
 * 参数（`flowParams`）：`bundleDir` 必填，`mode` 为 `core|full`，`launch` 为 `true|false`。
 */
/**
 * 恢复流程（`xhs.state.restore`）。
 *
 * 照搬旧 `gui_device_worker.py:458-480` 的处理链：
 * ```
 * source 以 .zip 结尾 → 直接恢复
 * 其它（.bak / .tar.bak / 目录）→ convert_package() 转成 bundle 再恢复
 * ```
 *
 * 参数（`flowParams`）：
 * - `bundleDir` **或** `source`：已解压目录 / zip / .bak / .tar.bak / 目录
 * - `mode`：`core|full`
 * - `launch`：`true|false`
 */
export const restoreStateFlow: FlowDefinition = {
  id: 'xhs.state.restore',
  title: '恢复登录态备份包（需 root）',
  steps: [
    {
      id: 'prepare',
      title: '准备备份包（必要时先转换）',
      async run(ctx) {
        // 旧版两种入参：已是 bundle 目录，或需要转换的第三方备份。
        let source = ctx.flowParams['bundleDir'] || ctx.flowParams['source'] || ''
        if (!source) throw new Error('缺少 bundleDir / source')
        const rawMode = ctx.flowParams['mode'] ?? 'core'
        if (rawMode !== 'core' && rawMode !== 'full') {
          throw new Error(`不支持的 mode：${rawMode}`)
        }

        // 旧 `convert_package`：`.zip` 直接用；其它格式先转换。
        if (!source.toLowerCase().endsWith('.zip')) {
          const info = await stat(source).catch(() => null)
          const isZipDir = false
          void isZipDir
          // 目录且含 manifest.json 视为已解压 bundle，跳过转换。
          if (info?.isDirectory()) {
            const hasManifest = await stat(join(source, 'manifest.json')).catch(() => null)
            if (hasManifest) {
              ctx.runs.stepStarted(ctx.runId, 'prepare', '直接使用已解压备份包')
              return `已解压包：${source}`
            }
          }
          const converted = await convertPackage(source, rawMode)
          source = converted.bundlePath
          return `已转换：${converted.extracted} 个文件，缺 ${converted.missing}`
        }
        return `使用现成 zip：${source}`
      },
    },
    {
      id: 'restore',
      title: '解压并按分组恢复文件',
      async run(ctx) {
        const rawMode = ctx.flowParams['mode'] ?? 'core'
        if (rawMode !== 'core' && rawMode !== 'full') {
          throw new Error(`不支持的 mode：${rawMode}`)
        }
        let bundle = ctx.flowParams['bundleDir'] || ctx.flowParams['source'] || ''

        // .zip 需先解到临时目录（旧 `load_bundle`）。
        let workDir = bundle
        let cleanup: (() => Promise<void>) | null = null
        if (bundle.toLowerCase().endsWith('.zip')) {
          workDir = await extractZip(bundle)
          cleanup = async () => {
            await rm(workDir, { recursive: true, force: true })
          }
        }

        try {
          const { restored, skipped } = await restoreBundle(ctx, workDir, rawMode)
          if (restored === 0) throw new Error('没有任何文件被恢复（检查分组与包内容）')

          if ((ctx.flowParams['launch'] ?? 'false') === 'true') {
            await ctx.device.launchApp(ctx.serial, XHS_PACKAGE)
            await sleep(ctx.random.int(2000, 4000))
          }
          return `restored=${restored} skipped=${skipped} mode=${rawMode}`
        } finally {
          if (cleanup) await cleanup()
        }
      },
    },
  ],
}

/** 解压 zip 到临时目录（旧 `load_bundle` 的 extractall）。 */
async function extractZip(zipPath: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'xhs_real_state_'))
  await tar.x({ file: zipPath, cwd: dir })
  return dir
}
