import type { FlowDefinition } from '@myt/flow'

/**
 * 设备级流程：清除数据、账号备份。
 *
 * **1:1 移植**：
 * - 清除：`xhs_sid_extractor.clear_xhs_data`（533-565）
 * - 备份：`xhs_real_state_extract.extract_bundle` + `xhs_real_state_common` 的分组清单
 */

const XHS_PACKAGE = 'com.xingin.xhs'
const DATA_DIR = `/data/data/${XHS_PACKAGE}`
const MMKV_DIR = `${DATA_DIR}/files/mmkv`

/** 备份分组（`FILE_GROUPS`，xhs_real_state_common.py:78-84）。 */
export const FILE_GROUPS: Record<string, readonly string[]> = {
  core: ['com.xingin.xhs', 'com.xingin.xhs.crc', 'login_user_info_kv', 'login_user_info_kv.crc'],
  device_context: ['did_value_manager', 'did_value_manager.crc', 'kv_location', 'kv_location.crc', 'device_params_saver', 'device_params_saver.crc'],
  login_aux: [
    'change_account',
    'change_account.crc',
    'com.xingin.xhs_preferences',
    'com.xingin.xhs_preferences.crc',
    'login_activate',
    'login_activate.crc',
    'login_secure_kv_name',
    'login_secure_kv_name.crc',
    'OverSeaAppConfig',
    'OverSeaAppConfig.crc',
  ],
  shared_prefs: [
    'com.xingin.xhs_preferences.xml',
    'device_info_file.xml',
    'ug_preload_device_info.xml',
    'pre_device.xml.xml',
    'cn.jiguang.sdk.device.xml',
    'ssoconfigs.xml',
    'cu_auth.xml',
    's.xml',
    'f.xml',
  ],
}

/** 模式 → 分组（`MODE_GROUPS`，xhs_real_state_common.py:97-100）。 */
export const MODE_GROUPS: Record<'core' | 'full', readonly (keyof typeof FILE_GROUPS)[]> = {
  core: ['core'],
  full: ['core', 'device_context', 'login_aux', 'shared_prefs'],
}

/**
 * 清除数据（`clear_xhs_data`）。
 *
 * 顺序必须一致：force-stop → pm clear → 删两份外部数据目录 → 删 tmp 残留。
 * 注意旧实现的注释：**不启动 app**，避免产生中间状态。
 */
export const clearDataFlow: FlowDefinition = {
  id: 'xhs.device.clear',
  title: '清除小红书数据',
  steps: [
    {
      id: 'connect',
      title: '确保 ADB 已连接',
      retries: 2,
      async run(ctx) {
        // 旧实现的 worker 隐式依赖上层已连接；这里显式重连，避免设备掉线后误判。
        await ctx.device.connect(ctx.serial)
      },
    },
    {
      id: 'force-stop',
      title: '强制停止小红书',
      async run(ctx) {
        await ctx.device.forceStop(ctx.serial, XHS_PACKAGE)
      },
    },
    {
      id: 'pm-clear',
      title: 'pm clear 应用数据',
      retries: 1,
      async run(ctx) {
        await ctx.device.shell(ctx.serial, `pm clear ${XHS_PACKAGE}`, { root: true })
      },
    },
    {
      id: 'remove-external',
      title: '删除可能遗漏的外部数据目录',
      async run(ctx) {
        for (const path of [`/sdcard/Android/data/${XHS_PACKAGE}`, `/data/media/0/Android/data/${XHS_PACKAGE}`]) {
          // 旧实现用 check=False 容错，这里同样忽略失败。
          await ctx.device.shell(ctx.serial, `rm -rf ${path}`, { root: true, check: false, timeoutMs: 10_000 })
        }
      },
    },
    {
      id: 'remove-temp',
      title: '清理 /data/local/tmp 残留',
      async run(ctx) {
        for (const name of [XHS_PACKAGE, `${XHS_PACKAGE}.crc`, 'login_user_info_kv', 'login_user_info_kv.crc']) {
          await ctx.device.shell(ctx.serial, `rm -f /data/local/tmp/${name}`, {
            root: true,
            check: false,
            timeoutMs: 5000,
          })
        }
      },
    },
  ],
}

/**
 * 账号备份（`extract_bundle`）。
 *
 * 首期只做「拉取 + 打包清单」，压缩写到调用方指定目录；
 * ZIP 打包复用内核侧实现（`writeBundle`），不在流程里做文件系统细节。
 */
export const backupFlow: FlowDefinition = {
  id: 'xhs.device.backup',
  title: '账号备份（拉取登录态文件）',
  steps: [
    {
      id: 'connect',
      title: '确保 ADB 已连接',
      retries: 2,
      async run(ctx) {
        await ctx.device.connect(ctx.serial)
      },
    },
    {
      id: 'ensure-root',
      title: '确认 root 可用',
      async run(ctx) {
        const out = await ctx.device.shell(ctx.serial, 'su -c id', { check: false })
        if (!out.includes('uid=0')) throw new Error('需要 root 权限（su 不可用）')
      },
    },
    {
      id: 'check-installed',
      title: '确认已安装小红书',
      async run(ctx) {
        const out = await ctx.device.shell(ctx.serial, `pm path ${XHS_PACKAGE}`, { check: false })
        if (!out.includes('package:')) throw new Error('未检测到小红书')
      },
    },
    {
      id: 'stop-app',
      title: '停止应用（避免文件写入中途变更）',
      async run(ctx) {
        await ctx.device.forceStop(ctx.serial, XHS_PACKAGE)
      },
    },
    {
      id: 'pull-groups',
      title: '按 full 模式拉取各分组文件',
      retries: 1,
      async run(ctx) {
        const groups = MODE_GROUPS.full
        const pulled: Array<{ group: string; name: string; size: number }> = []
        for (const group of groups) {
          for (const name of FILE_GROUPS[group] ?? []) {
            const remote = group === 'shared_prefs'
              ? `${DATA_DIR}/shared_prefs/${name}`
              : `${MMKV_DIR}/${name}`
            const result = await ctx.device.pullPrivateFile(ctx.serial, remote)
            if (result) pulled.push({ group, name, size: result.size })
          }
        }
        if (pulled.length === 0) throw new Error('未拉到任何登录态文件（root 或路径可能不对）')
        // 把结果记进事件流，便于对账（旧实现写在 manifest.json）。
        ctx.runs.stepSucceeded(
          ctx.runId,
          'pull-groups',
          0,
          `已拉取 ${pulled.length} 个文件，core=${pulled.filter((p) => p.group === 'core').length}`,
        )
      },
    },
  ],
}
