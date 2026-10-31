/**
 * SID 上号 / 提取 / 清数据（移植自 `xhs_sid_extractor.py`，670 行）。
 *
 * 三条能力：
 * - **提取**：从已登录设备的 `login_user_info_kv` 读出 sid + userid
 * - **上号**：生成 MMKV 二进制写入私有目录，免登录直接进入账号
 * - **清理**：`pm clear` 等价的清数据
 *
 * 全部需要 root（写 `/data/data`）。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FlowDefinition, StepContext } from '@myt/flow'

/** 带参数的流程工厂（与 `FlowRegistry.registerFactory` 的签名一致）。 */
type SidFactory = (params: Record<string, unknown>) => FlowDefinition

/** 从工厂参数或运行参数里取字符串；两边都没有则为空串。 */
function pickString(params: Record<string, unknown>, flowParams: Record<string, string>, key: string): string {
  const fromRun = flowParams[key]
  if (fromRun) return fromRun
  const fromFactory = params[key]
  return typeof fromFactory === 'string' ? fromFactory : ''
}
import { sleep } from '@myt/human'
import {
  generateLoginActivateFiles,
  generateLoginUserInfoFiles,
  generateMmkvFiles,
  parseSidFromMmkv,
} from '../data/mmkv.ts'

/** 旧 `xhs_sid_extractor.py` 顶部常量。 */
export const SID_PATHS = {
  package: 'com.xingin.xhs',
  mmkvDir: '/data/data/com.xingin.xhs/files/mmkv',
  get main() {
    return `${this.mmkvDir}/${this.package}`
  },
  get crc() {
    return `${this.mmkvDir}/${this.package}.crc`
  },
  get loginInfo() {
    return `${this.mmkvDir}/login_user_info_kv`
  },
  get loginInfoCrc() {
    return `${this.mmkvDir}/login_user_info_kv.crc`
  },
  get loginActivate() {
    return `${this.mmkvDir}/login_activate`
  },
  get loginActivateCrc() {
    return `${this.mmkvDir}/login_activate.crc`
  },
  deviceTmp: '/data/local/tmp',
} as const

/**
 * 确认 root 可用。
 *
 * 先重连一次：ADB over TCP 会因容器重启/网络抖动掉线，
 * 掉线时 `su` 的输出为空，若不区分就会误报「设备未 root」。
 */
async function requireRoot(ctx: StepContext): Promise<void> {
  const probe = async (): Promise<string> =>
    ctx.device.shell(ctx.serial, 'id', { root: true, check: false })

  let out = await probe()
  if (!out.trim()) {
    await ctx.device.connect(ctx.serial)
    out = await probe()
  }
  if (!out.includes('uid=0')) {
    throw new Error(
      out.trim()
        ? `设备未 root：${out.trim().slice(0, 120)}`
        : '无法连接设备（su 无输出）：请确认容器运行且 ADB 可连',
    )
  }
}

/** 旧 `check_xhs_installed`：3 次尝试，每次间隔 2s。 */
async function requireXhsInstalled(ctx: StepContext): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const out = await ctx.device.shell(ctx.serial, `pm path ${SID_PATHS.package}`, {
      check: false,
    })
    if (out.includes('package:')) return
    if (attempt < 3) await sleep(2000)
  }
  throw new Error(`小红书未安装（${SID_PATHS.package}）`)
}

/** 旧 `force_stop_xhs` + `launch_xhs`。 */
async function restartXhs(ctx: StepContext): Promise<void> {
  await ctx.device.forceStop(ctx.serial, SID_PATHS.package)
  await sleep(ctx.random.int(500, 1200))
  await ctx.device.launchApp(ctx.serial, SID_PATHS.package)
}

/**
 * 提取 SID（旧 `extract_sid_userid`）。
 *
 * 主路径：`cp` 到 tmp → base64 读回；失败回落 `xxd -p` → `strings`。
 */
async function extractSid(
  ctx: StepContext,
  mmkvFile: string,
): Promise<{ sid: string | null; userid: string | null }> {
  const bytes = await ctx.device.readRemoteFile(ctx.serial, mmkvFile)
  if (bytes && bytes.length > 0) {
    const parsed = parseSidFromMmkv(bytes)
    if (parsed?.sid) return parsed
  }

  // 回落 1：xxd -p（十六进制，能穿过 adb 文本管道）
  const hex = await ctx.device.shell(
    ctx.serial,
    `xxd -p ${quote(mmkvFile)} 2>/dev/null | tr -d '\\n'`,
    { root: true, check: false },
  )
  const cleaned = hex.replace(/\s+/g, '')
  if (cleaned && /^[0-9a-fA-F]+$/.test(cleaned)) {
    const parsed = parseSidFromMmkv(Buffer.from(cleaned, 'hex'))
    if (parsed?.sid) return parsed
  }

  // 回落 2：strings
  const texts = await ctx.device.shell(ctx.serial, `strings ${quote(mmkvFile)} 2>/dev/null`, {
    root: true,
    check: false,
  })
  if (texts) {
    const parsed = parseSidFromMmkv(Buffer.from(texts, 'utf8'))
    if (parsed?.sid) return parsed
  }

  return { sid: null, userid: null }
}

/** POSIX 单引号转义。 */
function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** 旧 `login_to_device`：生成 3 组 MMKV → push → cp → chown → chmod → 重启。 */
async function writeLoginState(
  ctx: StepContext,
  sid: string,
  userid: string,
): Promise<void> {
  const userInfo = generateMmkvFiles(sid, userid)
  const loginInfo = generateLoginUserInfoFiles(sid, userid)
  const activate = generateLoginActivateFiles()

  const files: Array<{ name: string; remote: string; bytes: Buffer; mode: string }> = [
    { name: `${SID_PATHS.package}`, remote: SID_PATHS.main, bytes: userInfo.main, mode: '600' },
    { name: `${SID_PATHS.package}.crc`, remote: SID_PATHS.crc, bytes: userInfo.crc, mode: '600' },
    {
      name: 'login_user_info_kv',
      remote: SID_PATHS.loginInfo,
      bytes: loginInfo.main,
      mode: '600',
    },
    {
      name: 'login_user_info_kv.crc',
      remote: SID_PATHS.loginInfoCrc,
      bytes: loginInfo.crc,
      mode: '600',
    },
    {
      name: 'login_activate',
      remote: SID_PATHS.loginActivate,
      bytes: activate.main,
      mode: '600',
    },
    {
      name: 'login_activate.crc',
      remote: SID_PATHS.loginActivateCrc,
      bytes: activate.crc,
      mode: '600',
    },
  ]

  // 必须先停 App，否则它会覆盖写入的文件。
  await ctx.device.forceStop(ctx.serial, SID_PATHS.package)

  const uid = await ctx.device.appUid(ctx.serial, SID_PATHS.package)
  await ctx.device.shell(ctx.serial, `mkdir -p ${quote(SID_PATHS.mmkvDir)}`, {
    root: true,
    check: false,
  })

  const dir = await mkdtemp(join(tmpdir(), 'myt-sid-'))
  try {
    for (const file of files) {
      const local = join(dir, file.name)
      await writeFile(local, file.bytes)
      await ctx.device.pushPrivateFile(ctx.serial, local, file.remote, {
        ownerUid: uid ?? undefined,
        mode: file.mode,
      })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  // SELinux 重打标签：不做的话 App 读不到（表现为「写入成功但仍是未登录」）。
  await ctx.device.shell(ctx.serial, `restorecon -RF ${quote(SID_PATHS.mmkvDir)}`, {
    root: true,
    check: false,
  })

  await restartXhs(ctx)
}

/** 提取流程（`xhs.sid.extract`）。 */
export const sidExtractFlow: FlowDefinition = {
  id: 'xhs.sid.extract',
  title: '提取 SID（需要已登录 + root）',
  steps: [
    {
      id: 'require-root',
      title: '确认 root 与小红书已安装',
      async run(ctx) {
        await requireRoot(ctx)
        await requireXhsInstalled(ctx)
      },
    },
    {
      id: 'extract',
      title: '读取 MMKV 提取 sid / userid',
      async run(ctx) {
        const result = await extractSid(ctx, SID_PATHS.loginInfo)
        if (!result.sid) throw new Error('未找到 SID（设备上可能未登录）')
        // 返回值即 step note：UI 从 step/succeeded 事件里读回 sid。
        return `sid=${result.sid} userid=${result.userid ?? '?'}`
      },
    },
  ],
}

/**
 * 上号流程（`xhs.sid.login`）——参数 `sid` + `userid`。
 *
 * 对应旧 `login_to_device`。
 */
export const createSidLoginFlow: SidFactory = (params) => ({
  id: 'xhs.sid.login',
  title: 'SID 上号（写 MMKV，需 root）',
  steps: [
    {
      id: 'require-root',
      title: '确认 root 与小红书已安装',
      async run(ctx) {
        await requireRoot(ctx)
        await requireXhsInstalled(ctx)
      },
    },
    {
      id: 'write',
      title: '生成并写入 MMKV 登录态',
      async run(ctx) {
        const sid = pickString(params, ctx.flowParams, 'sid')
        const userid = pickString(params, ctx.flowParams, 'userid')
        if (!sid) throw new Error('缺少 sid')
        if (!userid) throw new Error('缺少 userid')
        await writeLoginState(ctx, sid, userid)
        return `sid=${sid}`
      },
    },
    {
      id: 'verify',
      title: '重启后回读校验登录态',
      async run(ctx) {
        await sleep(ctx.random.int(6000, 9000))
        const back = await extractSid(ctx, SID_PATHS.loginInfo)
        const expected = pickString(params, ctx.flowParams, 'sid')
        if (back.sid !== expected) {
          throw new Error(`回读不一致：期望 ${expected}，实际 ${back.sid ?? '未找到'}`)
        }
      },
    },
  ],
})

/** 清数据流程（`xhs.device.clear` 的 SID 版本，保留原流程不动）。 */
export const sidClearFlow: FlowDefinition = {
  id: 'xhs.sid.clear',
  title: '清除小红书数据（root）',
  steps: [
    {
      id: 'clear',
      title: 'pm clear + 删除 mmkv 目录',
      async run(ctx) {
        await ctx.device.forceStop(ctx.serial, SID_PATHS.package)
        await ctx.device.shell(ctx.serial, `pm clear ${SID_PATHS.package}`, { check: false })
        await ctx.device.shell(ctx.serial, `rm -rf ${quote(SID_PATHS.mmkvDir)}`, {
          root: true,
          check: false,
        })
      },
    },
  ],
}
