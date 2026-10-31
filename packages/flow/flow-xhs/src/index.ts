import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FlowDefinition, StepContext } from '@myt/flow'
import { sleep } from '@myt/human'
import { inputWithHumanLike, tapRepeatedly, waitSpinnerGone } from './steps/actions.ts'
import {
  getBottomProfileButtonPosition,
  getClearPhoneButtonPosition,
  getCountryCodePosition,
  getOtherLoginMethodButtonPosition,
  getPhoneInputPosition,
  getPhoneLoginButtonPosition,
  getRednoteNotificationAllowButtonPosition,
  getRednoteWelcomeAgreeButtonPosition,
  getVerificationCodeInputPosition,
  getVerifyLoginButtonInfo,
} from './locators/locators.ts'
import { getCountryCodeList } from './locators/state-locators.ts'
import { getNetworkErrorCancelButtonPosition } from './locators/guide-locators.ts'
import { assertCodeSent, createCodeRetryStep, sendCodePhase } from './steps/login-steps.ts'
export { opLoginFlow, vJumpLoginFlow } from './flows/alt-login-flows.ts'
export { createBindPhoneFlow, createFollowUserFlow, createModifyProfileFlow, setFollowingCommentsFlow } from './flows/device-flows.ts'
export { createSidLoginFlow, sidClearFlow, sidExtractFlow, SID_PATHS } from './flows/sid-flows.ts'
export {
  createOneClickNewDeviceFlow,
  oneClickNewDevice,
  ONE_CLICK_INTERNALS,
} from './flows/one-click-new.ts'
export { restoreStateFlow } from './flows/state-restore.ts'
export {
  BUNDLE_VERSION,
  SUPPORTED_BUNDLE_VERSIONS,
  XHS_PACKAGE as BUNDLE_PACKAGE,
  MMKV_DIR,
  SHARED_PREFS_DIR,
  WEBVIEW_DIR,
  FILE_GROUPS,
  MODE_GROUPS,
  WEBVIEW_DYNAMIC_SPECS,
  utcNowIso,
  sha256File,
  bundleDefaultName,
  bundleManifestName,
  iterBundleGroups,
  buildBundleEntry,
  inferModeForRemotePath,
  staticBundleEntriesForGroups,
  dynamicBundleEntriesForGroups,
  bundleEntriesForGroups,
  buildManifest,
  writeBundle,
} from './data/bundle.ts'
export {
  resolveWeshareTarPath,
  resolveLocalAppRoot,
  tarMemberNameForRemotePath,
  dynamicBundleEntriesFromTar,
  sourceLabelForTar,
  convertWeshareBackup,
  normalizeMemberName,
  resolveMiuiBakPath,
  findMiuiTarOffset,
  miuiMemberNameForRemotePath,
  dynamicBundleEntriesFromMiui,
  sourceLabelForBak,
  convertMiuiBackup,
  convertPackage,
} from './data/bundle-convert.ts'
export {
  buildContext,
  buildContextFromMmkvDir,
  safeBuildContext,
  safeBuildContextFromMmkvDir,
  extractLoginInfoFromText,
  extractLoginAccountInfoFromText,
  extractProfileTokensFromText,
  extractDidValuesFromText,
  extractLocDeviceIdFromText,
  loadMmkvText,
  emptyDeviceContext,
} from './data/device-context.ts'
export { HeroSmsClient, HeroSmsError, HeroSmsApiError, HeroSmsTransportError, waitForSmsCode } from './data/herosms.ts'
export { loginWithHeroSms, normalizeHeroSmsPhone } from './data/herosms-login.ts'
export {
  generateMmkvFiles,
  generateLoginUserInfoFiles,
  generateLoginActivateFiles,
  parseSidFromMmkv,
  parseMmkvRaw,
  describeMmkvValue,
  decodeVarint,
} from './data/mmkv.ts'
import type { VerificationCodeSource } from './steps/verification.ts'

/** 小红书包名（login.md §6）。 */
export const XHS_PACKAGE = 'com.xingin.xhs'

/** 应用内深链（shared-steps §2）。 */
export const XHS_DEEPLINK = {
  profile: 'xhsdiscover://profile',
  settings: 'xhsdiscover://settings',
  postNewNote: 'xhsdiscover://post_new_note?page={"page_type":"now_portal_home_page"}',
} as const

/**
 * 设备就绪探测（切片 A 的最小闭环）。
 *
 * 目标：验证「dump → 定位 → 点击 → 断言」这条原语链在真机上成立。
 */
export const deviceProbeFlow: FlowDefinition = {
  id: 'xhs.probe',
  title: '设备就绪探测（抓 UI + 回主页）',
  steps: [
    {
      id: 'dump-initial',
      title: '抓取当前界面',
      retries: 2,
      async run(ctx) {
        const snapshot = await ctx.snapshot({ refresh: true })
        if (snapshot.nodeCount === 0) throw new Error('UI dump 为空')
      },
    },
    {
      id: 'open-profile',
      title: '通过深链回到主页',
      retries: 1,
      async run(ctx) {
        await ctx.device.openUri(ctx.serial, XHS_DEEPLINK.profile, XHS_PACKAGE)
        await sleep(2000)
      },
    },
    {
      id: 'assert-home',
      title: '确认已在小红书主界面',
      retries: 2,
      async run(ctx) {
        const snapshot = await ctx.snapshot({ refresh: true })
        const profile = getBottomProfileButtonPosition(snapshot.root)
        const phoneLogin = getPhoneLoginButtonPosition(snapshot.root)
        const phoneInput = getPhoneInputPosition(snapshot.root)
        if (!profile && !phoneLogin && !phoneInput) {
          ctx.runs.assertFailed(ctx.runId, 'assert-home', '未识别到主界面/登录页特征')
          throw new Error('断言失败：不在小红书主界面')
        }
      },
    },
  ],
}

export interface PhoneLoginInput {
  /** 手机号（不含区号）。 */
  phone: string
  /** 区号，默认 +86。 */
  countryCode?: string
  /** 取码来源；缺省时流程停在「等待验证码」，不进入验证码循环。 */
  codeSource?: VerificationCodeSource
  /** 安全验证识图（2 张图的两位数答案）；缺省时跳过安全验证处理。 */
  solveSafety?: (image: Buffer) => Promise<number>
  /** 是否在发码后继续走验证码输入 + 引导页（默认 true）。 */
  continueAfterSendCode?: boolean
}

/**
 * 手机号登录准备流程：**严格按 auto_login.main()（2403-2760）的顺序与分支移植**。
 *
 * 逐步对应：
 * 1. adb_connect + 冷启 + sleep(3-7)
 * 2. 首屏弹窗（欢迎 Agree / 通知 ALLOW）各最多 5 轮
 * 3. 等入口（5 轮 × 0.6-1.5s）
 * 4. 点「我」，再等入口（5 轮）
 * 5. 其他登录方式 → 手机号；或直接手机号；或已在输入页
 * 6. 等区号按钮（29 轮 × 0.6-1.5s）
 * 7. 区号不同才切换（列表解析 + 边界点击）
 * 8. 点清除按钮
 * 9. 点输入框右侧 → 拟人输入（5 次重试 + 回读）
 * 10. 等验证码框 / 点「验证并登录」3 次 + 等转圈
 *
 * 停在发码之后：接码需要外部服务，属下一段流程。
 */
export function createPhoneLoginPrepFlow(input: PhoneLoginInput): FlowDefinition {
  const phone = input.phone.trim()
  const countryCode = input.countryCode ?? '+86'

  return {
    id: 'xhs.login.phone-prep',
    uiChannel: 'yadb' as const,
    title: `手机号登录准备（${phone.replace(/(\d{3})\d{4}(\d+)/, '$1****$2')}）`,
    steps: [
      {
        id: 'ensure-env',
        title: '推送 yadb 并启用输入法',
        async run(ctx) {
          if (!ctx.yadbPath) throw new Error('未配置 yadb 路径（MYT_YADB_PATH）')
          await ctx.device.ensureYadb(ctx.serial, ctx.yadbPath)
          // ensure_adb_keyboard 失败不阻断登录（旧实现如此）。
          try {
            await ctx.device.ensureIme(ctx.serial)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            ctx.runs.stepSucceeded(ctx.runId, 'ensure-env', 0, `输入法设置失败但不阻断：${message}`)
          }
        },
      },
      {
        id: 'connect-launch',
        title: '连接设备并冷启小红书（sleep 3-7s）',
        retries: 1,
        async run(ctx) {
          await ctx.device.connect(ctx.serial)
          await ctx.device.forceStop(ctx.serial, XHS_PACKAGE)
          await ctx.device.openUri(ctx.serial, XHS_DEEPLINK.profile, XHS_PACKAGE)
          await sleep(ctx.random.int(3000, 7000))
        },
      },
      {
        id: 'dismiss-first-popups',
        title: '处理首屏弹窗（欢迎 Agree / 通知 ALLOW）',
        retries: 1,
        async run(ctx) {
          // 旧实现：只有当三个入口都不存在时才处理弹窗。
          const probe = await ctx.snapshot({ refresh: true })
          if (
            getPhoneLoginButtonPosition(probe.root) ||
            getBottomProfileButtonPosition(probe.root) ||
            getPhoneInputPosition(probe.root)
          ) {
            ctx.runs.stepSkipped(ctx.runId, 'dismiss-first-popups', 'condition')
            return
          }

          for (let i = 0; i < 5; i += 1) {
            await sleep(ctx.random.int(300, 800))
            const snapshot = await ctx.snapshot({ refresh: true })
            if (getBottomProfileButtonPosition(snapshot.root)) return
            const welcome = getRednoteWelcomeAgreeButtonPosition(snapshot.root)
            if (welcome) {
              await ctx.device.tapLikeHuman(ctx.serial, welcome.x, welcome.y)
              break
            }
          }

          for (let i = 0; i < 5; i += 1) {
            await sleep(ctx.random.int(300, 800))
            const snapshot = await ctx.snapshot({ refresh: true })
            if (getBottomProfileButtonPosition(snapshot.root)) return
            if (getOtherLoginMethodButtonPosition(snapshot.root) || getPhoneLoginButtonPosition(snapshot.root)) {
              return
            }
            const allow = getRednoteNotificationAllowButtonPosition(snapshot.root)
            if (allow) {
              await ctx.device.tapLikeHuman(ctx.serial, allow.x, allow.y)
              return
            }
          }
        },
      },
      {
        id: 'wait-entry',
        title: '等待登录入口出现（5 轮）',
        retries: 1,
        async run(ctx) {
          for (let i = 0; i < 5; i += 1) {
            await sleep(ctx.random.int(600, 1500))
            const snapshot = await ctx.snapshot({ refresh: true })
            if (
              getOtherLoginMethodButtonPosition(snapshot.root) ||
              getPhoneLoginButtonPosition(snapshot.root) ||
              getBottomProfileButtonPosition(snapshot.root) ||
              getPhoneInputPosition(snapshot.root)
            ) {
              return
            }
          }
          throw new Error('登录入口未出现（5 轮）')
        },
      },
      {
        id: 'tap-profile',
        title: '点击底部「我」',
        async run(ctx) {
          const snapshot = await ctx.snapshot({ refresh: true })
          const profile = getBottomProfileButtonPosition(snapshot.root)
          if (!profile) {
            ctx.runs.stepSkipped(ctx.runId, 'tap-profile', 'condition')
            return
          }
          await ctx.device.tapLikeHuman(ctx.serial, profile.x, profile.y)
          for (let i = 0; i < 5; i += 1) {
            await sleep(ctx.random.int(600, 1500))
            const after = await ctx.snapshot({ refresh: true })
            if (
              getOtherLoginMethodButtonPosition(after.root) ||
              getPhoneLoginButtonPosition(after.root) ||
              getPhoneInputPosition(after.root)
            ) {
              return
            }
          }
        },
      },
      {
        id: 'enter-phone-login',
        title: '进入手机号登录页',
        retries: 1,
        async run(ctx) {
          const snapshot = await ctx.snapshot({ refresh: true })
          const other = getOtherLoginMethodButtonPosition(snapshot.root)
          const phoneLogin = getPhoneLoginButtonPosition(snapshot.root)

          if (other) {
            await ctx.device.tapLikeHuman(ctx.serial, other.x, other.y)
            await sleep(300)
            const next = await ctx.snapshot({ refresh: true })
            const nextPhone = getPhoneLoginButtonPosition(next.root)
            if (nextPhone) {
              await ctx.device.tapLikeHuman(ctx.serial, nextPhone.x, nextPhone.y)
            } else if (phoneLogin) {
              // 旧实现的异常处理：新界面没有手机号入口 → 返回后点旧坐标。
              await ctx.device.back(ctx.serial)
              await ctx.device.tapLikeHuman(ctx.serial, phoneLogin.x, phoneLogin.y)
            } else {
              throw new Error('其他登录方式页未找到手机号入口')
            }
            return
          }

          if (phoneLogin) {
            await ctx.device.tapLikeHuman(ctx.serial, phoneLogin.x, phoneLogin.y)
            return
          }

          if (getPhoneInputPosition(snapshot.root)) {
            ctx.runs.stepSkipped(ctx.runId, 'enter-phone-login', 'condition')
            return
          }
          throw new Error('找不到手机号登录按钮')
        },
      },
      {
        id: 'wait-country-code',
        title: '等待区号按钮（29 轮）',
        retries: 1,
        async run(ctx) {
          for (let i = 0; i < 29; i += 1) {
            await sleep(ctx.random.int(600, 1500))
            const snapshot = await ctx.snapshot({ refresh: true })
            const code = getCountryCodePosition(snapshot.root)
            if (code) {
              ctx.runs.stepSucceeded(ctx.runId, 'wait-country-code', 0, `当前区号=${code.text}`)
              return
            }
          }
          throw new Error('没有国家区号（29 轮）')
        },
      },
      {
        id: 'select-country-code',
        title: '选择区号（仅当与目标不同）',
        retries: 1,
        async run(ctx) {
          const snapshot = await ctx.snapshot({ refresh: true })
          const current = getCountryCodePosition(snapshot.root)
          if (!current) throw new Error('未找到区号按钮')
          if (current.text === countryCode) {
            ctx.runs.stepSkipped(ctx.runId, 'select-country-code', 'condition')
            return
          }

          await ctx.device.tapLikeHuman(ctx.serial, current.x, current.y)

          // 旧实现 2543-2551：5 轮等列表；期间出现网络异常弹窗则点「不了」并停止等待。
          let entries = getCountryCodeList((await ctx.snapshot({ refresh: true })).root)
          for (let i = 0; i < 5 && entries.length === 0; i += 1) {
            const root = (await ctx.snapshot({ refresh: true })).root
            entries = getCountryCodeList(root)
            if (entries.length > 0) break
            const cancel = getNetworkErrorCancelButtonPosition(root)
            if (cancel) {
              await ctx.device.tapLikeHuman(ctx.serial, cancel.x, cancel.y)
              break
            }
            await sleep(ctx.random.int(500, 1200))
          }

          // 旧实现 2553-2568：拿到列表就点目标项；找不到只记 dump，**不失败**，继续后续步骤。
          if (entries.length > 0) {
            const target = entries.find((item) => item.code === countryCode)
            if (target) {
              await ctx.device.tapLikeHuman(ctx.serial, target.x, target.y, { bounds: target.bounds })
              await sleep(ctx.random.int(600, 1500))
            } else {
              ctx.runs.assertFailed(
                ctx.runId,
                'select-country-code',
                `区号列表未找到 ${countryCode}（旧实现记为 country_list_missing，不中断）`,
              )
            }
          }
        },
      },
      {
        id: 'clear-phone',
        title: '点清除按钮',
        async run(ctx) {
          const snapshot = await ctx.snapshot({ refresh: true })
          const clear = getClearPhoneButtonPosition(snapshot.root)
          if (!clear) {
            ctx.runs.stepSkipped(ctx.runId, 'clear-phone', 'condition')
            return
          }
          await ctx.device.tapLikeHuman(ctx.serial, clear.x, clear.y)
        },
      },
      {
        id: 'input-phone',
        title: '输入手机号（点右侧 + 5 次重试 + 回读）',
        retries: 1,
        async run(ctx) {
          const snapshot = await ctx.snapshot({ refresh: true })
          const inputPos = getPhoneInputPosition(snapshot.root)
          if (!inputPos) throw new Error('未找到手机号输入框')
          // 旧实现点输入框右侧（right_boundary - 20）。
          await ctx.device.tapLikeHuman(ctx.serial, inputPos.x + 130, inputPos.y)
          const ok = await inputWithHumanLike(ctx, phone, '手机号输入框')
          if (!ok) throw new Error('手机号输入校验失败（5 次）')
        },
      },
      // 顺序与旧实现一致：先发码并判定，再进入取码/输入循环。
      // 引导页由 code-retry-loop 内部调用（旧实现同样嵌在轮次里）。
      ...(input.continueAfterSendCode ?? true
        ? [
            {
              id: 'send-code',
              title: '发码并判定是否发送成功',
              async run(ctx: StepContext) {
                await sendCodePhase(ctx, input.solveSafety)
                await assertCodeSent(ctx)
              },
            },
          ]
        : []),
      ...(input.codeSource && (input.continueAfterSendCode ?? true)
        ? [createCodeRetryStep(input.codeSource, input.solveSafety)]
        : []),
    ],
  }
}

/** `_first_package_name`：从 UI XML 取第一个 node 的 package（即前台应用）。 */
export function firstPackageName(xml: string): string {
  const match = /<node[^>]*package="([^"]+)"/.exec(xml ?? '')
  return match?.[1] ?? ''
}

/**
 * 抓取界面 XML 并落盘（移植自 `device_tab.UiDumpWorker` + `ui_dump.save_ui_dump`）。
 *
 * 旧版行为（`device_tab.py:140-190`）：
 * 1. 逐个设备抓 UI XML，失败记 `取界面失败: {exc}`
 * 2. 内容为空 → `dump 返回空内容`
 * 3. `save_ui_dump(serial, xml, "manual")` 落盘，失败 → `写文件失败`
 * 4. 成功后额外报告前台包名
 *
 * 只读操作：不建 job、不占设备锁（旧版注释明确说明）。
 */
export const uiDumpFlow: FlowDefinition = {
  id: 'xhs.ui.dump',
  title: '抓取界面 XML（落盘）',
  steps: [
    {
      id: 'dump',
      title: '抓取 UI XML 并保存',
      async run(ctx) {
        const snapshot = await ctx.snapshot({ refresh: true })
        if (snapshot.nodeCount === 0) throw new Error('dump 返回空内容')

        const xml = serializeUiForDump(snapshot.root)
        // 落盘路径由内核注入（`uiDumpDir`），flow 层不关心 Electron 的目录约定。
        const dumpDir = ctx.flowParams['uiDumpDir'] ?? ''
        if (!dumpDir) throw new Error('未配置 uiDumpDir（日志目录）')

        await mkdir(dumpDir, { recursive: true })
        const stamp = new Date()
        const p2 = (n: number): string => String(n).padStart(2, '0')
        const ts =
          `${stamp.getFullYear()}${p2(stamp.getMonth() + 1)}${p2(stamp.getDate())}_` +
          `${p2(stamp.getHours())}${p2(stamp.getMinutes())}${p2(stamp.getSeconds())}`
        const path = join(dumpDir, `${ctx.serial.replace(/:/g, '_')}_manual_${ts}.xml`)
        await writeFile(path, xml, 'utf8')

        const pkg = firstPackageName(xml)
        return pkg ? `已保存 ${path}；前台包名 ${pkg}` : `已保存 ${path}`
      },
    },
  ],
}

/** 把 UiNode 树还原成旧版 UI XML 形态（供 `save_ui_dump` 原样落盘）。 */
function serializeUiForDump(root: import('@myt/device').UiNode): string {
  const parts: string[] = []
  const walk = (node: import('@myt/device').UiNode): void => {
    const [x1, y1, x2, y2] = node.bounds
    parts.push(
      `<node class="${node.className}" package="${node.packageName}" text="${node.text}"` +
        ` resource-id="${node.resourceId}" content-desc="${node.contentDesc}"` +
        ` checked="${node.checked}" clickable="${node.clickable}" enabled="${node.enabled}"` +
        ` bounds="[${x1},${y1}][${x2},${y2}]">`,
    )
    for (const child of node.children) walk(child)
    parts.push('</node>')
  }
  walk(root)
  return `<?xml version="1.0" encoding="UTF-8"?><hierarchy rotation="0">${parts.join('')}</hierarchy>`
}
