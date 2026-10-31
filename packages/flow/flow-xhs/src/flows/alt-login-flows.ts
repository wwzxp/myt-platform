import type { FlowDefinition } from '@myt/flow'
import { sleep } from '@myt/human'
import type { ActionContext } from '../steps/actions.ts'
import { inputWithHumanLike } from '../steps/actions.ts'
import type { StepContext } from '@myt/flow'
import {
  getBottomProfileButtonPosition,
  getOtherLoginMethodButtonPosition,
  getPhoneLoginButtonPosition,
  getRednoteNotificationAllowButtonPosition,
  getRednoteWelcomeAgreeButtonPosition,
} from '../locators/locators.ts'
import {
  getAgreeContinueButtonPosition,
  getClearPhoneButtonPosition,
  getVerificationCodeInputPosition,
  getVerifyLoginButtonInfo,
} from '../locators/locators.ts'
import {
  getCardPasswordInputPosition,
  getDongpengButtonPosition,
  getDongpengInputPosition,
  getOneClickAuthorizationButtonPosition,
  getQqLoginButtonPosition,
} from '../locators/guide-locators.ts'
import { getLaterButtonPosition } from '../steps/dialogs.ts'

const XHS_PACKAGE = 'com.xingin.xhs'
const V_JUMP_PACKAGE = 'com.willh.wz'

function toActions(ctx: StepContext): ActionContext {
  return {
    serial: ctx.serial,
    device: ctx.device,
    runs: ctx.runs,
    runId: ctx.runId,
    random: ctx.random,
    humanPolicy: ctx.humanPolicy,
    snapshot: (options) => ctx.snapshot(options),
  }
}

/** 旧实现在 OP/V 跳开头共用的「冷启 + 弹窗清理」序列。 */
async function coldStartAndClearPopups(ctx: StepContext): Promise<void> {
  await ctx.device.connect(ctx.serial)
  try {
    await ctx.device.ensureIme(ctx.serial)
  } catch {
    // 输入法失败不阻断（旧实现如此）
  }
  if (ctx.yadbPath) await ctx.device.ensureYadb(ctx.serial, ctx.yadbPath)
  await ctx.device.openUri(ctx.serial, 'xhsdiscover://profile', XHS_PACKAGE)
  await sleep(ctx.random.int(3000, 7000))

  const probe = await ctx.snapshot({ refresh: true })
  if (!getPhoneLoginButtonPosition(probe.root) && !getBottomProfileButtonPosition(probe.root)) {
    // 第一段：欢迎弹窗
    for (let i = 0; i < 5; i += 1) {
      await sleep(ctx.random.int(300, 800))
      const root = (await ctx.snapshot({ refresh: true })).root
      if (getBottomProfileButtonPosition(root)) break
      const welcome = getRednoteWelcomeAgreeButtonPosition(root)
      if (welcome) {
        await ctx.device.tapLikeHuman(ctx.serial, welcome.x, welcome.y)
        break
      }
    }
    // 第二段：通知权限
    for (let i = 0; i < 5; i += 1) {
      await sleep(ctx.random.int(300, 800))
      const root = (await ctx.snapshot({ refresh: true })).root
      if (
        getBottomProfileButtonPosition(root) ||
        getOtherLoginMethodButtonPosition(root) ||
        getPhoneLoginButtonPosition(root)
      ) {
        break
      }
      const allow = getRednoteNotificationAllowButtonPosition(root)
      if (allow) {
        await ctx.device.tapLikeHuman(ctx.serial, allow.x, allow.y)
        break
      }
    }
  }

  // 自动翻译弹窗 Later（OP 版先做这一轮，V 跳版放在等入口之后）
  for (let i = 0; i < 5; i += 1) {
    await sleep(ctx.random.int(300, 500))
    const later = getLaterButtonPosition((await ctx.snapshot({ refresh: true })).root)
    if (later) await ctx.device.tapLikeHuman(ctx.serial, later.x, later.y)
  }

  for (let i = 0; i < 5; i += 1) {
    await sleep(ctx.random.int(600, 1500))
    const root = (await ctx.snapshot({ refresh: true })).root
    if (
      getOtherLoginMethodButtonPosition(root) ||
      getPhoneLoginButtonPosition(root) ||
      getBottomProfileButtonPosition(root)
    ) {
      return
    }
  }
}

/**
 * QQ OP 登录（`main_op_login`）。
 *
 * 路径：其他登录方式 → QQ → 同意并继续 → 东鹏输入框粘贴 OP 数据 → 授权 → 等「我」。
 */
export const opLoginFlow: FlowDefinition = {
  id: 'xhs.login.op',
  uiChannel: 'yadb' as const,
  title: 'QQ OP 登录',
  steps: [
    {
      id: 'cold-start',
      title: '冷启并清理弹窗',
      retries: 1,
      async run(ctx) {
        await coldStartAndClearPopups(ctx)
      },
    },
    {
      id: 'open-qq',
      title: '进入 QQ 登录',
      retries: 1,
      async run(ctx) {
        const root = (await ctx.snapshot({ refresh: true })).root
        const other = getOtherLoginMethodButtonPosition(root)
        if (other) {
          await ctx.device.tapLikeHuman(ctx.serial, other.x, other.y)
        } else {
          // 旧实现：没有「其他登录方式」时先点「我」再找
          for (let i = 0; i < 5; i += 1) {
            const profile = getBottomProfileButtonPosition((await ctx.snapshot({ refresh: true })).root)
            if (profile) {
              await ctx.device.tapLikeHuman(ctx.serial, profile.x, profile.y)
              break
            }
            await sleep(ctx.random.int(300, 800))
          }
          await sleep(ctx.random.int(600, 1500))
          const again = getOtherLoginMethodButtonPosition((await ctx.snapshot({ refresh: true })).root)
          if (again) await ctx.device.tapLikeHuman(ctx.serial, again.x, again.y)
        }

        const qq = getQqLoginButtonPosition((await ctx.snapshot({ refresh: true })).root)
        if (!qq) throw new Error('未找到 QQ 登录按钮')
        await ctx.device.tapLikeHuman(ctx.serial, qq.x, qq.y)
        await sleep(ctx.random.int(300, 500))
        const agree = getAgreeContinueButtonPosition((await ctx.snapshot({ refresh: true })).root)
        if (agree) await ctx.device.tapLikeHuman(ctx.serial, agree.x, agree.y)
      },
    },
    {
      id: 'input-op',
      title: '在东鹏上号器粘贴 OP 数据并授权',
      retries: 1,
      async run(ctx) {
        const act = toActions(ctx)
        const input = getDongpengInputPosition((await ctx.snapshot({ refresh: true })).root)
        if (!input) throw new Error('未找到东鹏上号器输入框')
        await ctx.device.tapLikeHuman(ctx.serial, input.x + 130, input.y)
        const ok = await inputWithHumanLike(act, ctx.flowParams.opText ?? '', '东鹏上号器输入框')
        if (!ok) throw new Error('OP 数据输入校验失败')

        const button = getDongpengButtonPosition((await ctx.snapshot({ refresh: true })).root)
        if (!button) throw new Error('未找到东鹏授权按钮')
        await ctx.device.tapLikeHuman(ctx.serial, button.x, button.y)
      },
    },
    {
      id: 'wait-home',
      title: '等待进入「我的」',
      retries: 1,
      async run(ctx) {
        for (let i = 0; i < 5; i += 1) {
          await sleep(ctx.random.int(500, 1000))
          if (getBottomProfileButtonPosition((await ctx.snapshot({ refresh: true })).root)) return
        }
        throw new Error('OP 登录后未进入主页')
      },
    },
  ],
}

/**
 * V 跳登录（`main_v_login`）。
 *
 * 路径：拉起授权 App → 输入 V 数据 → 一键授权 → 等「我」→ force-stop 授权 App。
 */
export const vJumpLoginFlow: FlowDefinition = {
  id: 'xhs.login.vjump',
  uiChannel: 'yadb' as const,
  title: 'V 跳登录',
  steps: [
    {
      id: 'cold-start',
      title: '冷启并清理弹窗',
      retries: 1,
      async run(ctx) {
        await coldStartAndClearPopups(ctx)
        // V 跳版在等入口的第二轮里才点 Later
        for (let i = 0; i < 5; i += 1) {
          await sleep(ctx.random.int(300, 500))
          const root = (await ctx.snapshot({ refresh: true })).root
          if (
            getOtherLoginMethodButtonPosition(root) ||
            getPhoneLoginButtonPosition(root) ||
            getBottomProfileButtonPosition(root)
          ) {
            break
          }
          const later = getLaterButtonPosition(root)
          if (later) await ctx.device.tapLikeHuman(ctx.serial, later.x, later.y)
        }
      },
    },
    {
      id: 'authorize',
      title: '在授权 App 中粘贴 V 数据并授权',
      retries: 1,
      async run(ctx) {
        const act = toActions(ctx)
        // 拉起蓝旗授权 App（旧实现的 launch_one_click_authorization_app）
        await ctx.device.launchApp(ctx.serial, V_JUMP_PACKAGE)
        await sleep(ctx.random.int(600, 1500))

        for (let i = 0; i < 5; i += 1) {
          await sleep(ctx.random.int(600, 1500))
          if (getCardPasswordInputPosition((await ctx.snapshot({ refresh: true })).root)) break
        }

        const input = getCardPasswordInputPosition((await ctx.snapshot({ refresh: true })).root)
        if (!input) throw new Error('未找到蓝旗一键授权输入框')
        await ctx.device.tapLikeHuman(ctx.serial, input.x + 80, input.y)
        const ok = await inputWithHumanLike(act, ctx.flowParams.vText ?? '', 'v跳上号器输入框')
        if (!ok) throw new Error('V 数据输入校验失败')

        const button = getOneClickAuthorizationButtonPosition((await ctx.snapshot({ refresh: true })).root)
        if (!button) throw new Error('未找到一键授权按钮')
        await ctx.device.tapLikeHuman(ctx.serial, button.x, button.y)
      },
    },
    {
      id: 'wait-home',
      title: '等待进入「我的」并关闭授权 App',
      retries: 1,
      async run(ctx) {
        for (let i = 0; i < 5; i += 1) {
          await sleep(ctx.random.int(500, 1000))
          if (getBottomProfileButtonPosition((await ctx.snapshot({ refresh: true })).root)) {
            await ctx.device.forceStop(ctx.serial, V_JUMP_PACKAGE)
            return
          }
        }
        await ctx.device.forceStop(ctx.serial, V_JUMP_PACKAGE)
        throw new Error('V 跳登录后未进入主页')
      },
    },
  ],
}

/** 未使用的占位导出，避免 tree-shaking 误删常量。 */
export const _xhsPackages = { XHS_PACKAGE, V_JUMP_PACKAGE }
