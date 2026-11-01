import type { FlowDefinition } from '@myt/flow'
import {
  getBodyInputPosition,
  getCancelButtonPosition,
  getDoneButtonPosition,
  getPreviewNextStepButtonPosition,
  getTextEditInputPosition,
  getTextNextStepButtonPosition,
  getTextNoteInputPosition,
  getTitleInputPosition,
} from '../locators/publish-locators.ts'
import {
  runAction,
  assertPage,
  currentPage,
  waitForPage,
  sleepRandom,
  PageRegistry,
} from '@myt/automation'
import type { ActionSpec } from '@myt/automation'
import {
  DEEPLINK_PROFILE,
  prepareEnvironment,
  submitNote,
  verifyPublished,
  pagesOf,
} from '../shared.ts'
import { XHS_PAGES, XHS_RECOVERY_RULES, XHS_PACKAGE, DEEPLINK_HOME } from '../pages.ts'

/**
 * 文字笔记发布流程（**1:1 移植**自 `auto_fb.fb_wz`，1761-1994 行）。
 *
 * **引擎化**：五步循环（取界面→判页面→找坐标→执行→校验）由 `runAction` 统一处理，
 * 这里只保留参数与流程特有的分叉。
 *
 * 与图文的差别：
 * - 入口是写想法页（`post_new_note` 深链），不是相册
 * - 先点输入区域，再点真正的 EditText，然后输入文字
 * - 「下一步」后有预览页（`CapaPictureReviewV3Activity`），超时 60s × 3 次
 * - 之后复用图文的「标题 / 正文 / 保存 / 校验」段
 */

/** 写想法页深链（`open_fb_wz_page`，273-275 行）。 */
const DEEPLINK_WZ = 'xhsdiscover://post_new_note?page={"page_type":"now_portal_home_page"}'

/** 文字笔记发布入参。 */
export interface PublishTextInput {
  /** 标题。 */
  title: string
  /** 正文。 */
  body: string
  /** 话题（不含 `#`）。 */
  topics: readonly string[]
  /** 文字笔记的文字内容（模板「文字笔记文字内容」列）。 */
  textContent: string
  /** 保存方式：`save` 存草稿，`publish` 正式发布。 */
  fbMode: 'save' | 'publish'
}

/**
 * 创建文字笔记发布流程。
 *
 * @param input 发布内容
 */
export function createPublishTextFlow(input: PublishTextInput): FlowDefinition {
  /** 话题拼接（与图文一致：先换行，再每个话题前加 `#` 后加空格）。 */
  const topicParts: string[] = []
  if (input.topics.length > 0) {
    topicParts.push('\n')
    for (const topic of input.topics) {
      topicParts.push('#')
      topicParts.push(`${topic} `)
    }
  }

  /** 写想法页的文字输入（旧代码 1802-1820 行）。 */
  const fillTextAction: ActionSpec = {
    id: 'fill-text',
    title: '输入文字内容',
    requires: ['text-note'],
    recoverable: false,
    locate: { intent: '输入框', fallback: getTextEditInputPosition },
    act: { kind: 'input', text: input.textContent, inputLocator: getTextEditInputPosition },
    // 旧实现用 contains 校验（框里可能有占位符残留）。
    verify: {
      kind: 'inputEquals',
      locator: getTextEditInputPosition,
      text: input.textContent,
      match: 'contains',
    },
    rounds: 6,
    gap: [0.4, 0.8],
  }

  /** 填标题（与图文一致）。 */
  const fillTitleAction: ActionSpec = {
    id: 'fill-title',
    title: '填写标题',
    requires: ['post-editor'],
    recoverable: false,
    locate: { intent: '添加标题', fallback: getTitleInputPosition },
    act: { kind: 'input', text: input.title, inputLocator: getTitleInputPosition },
    verify: { kind: 'inputEquals', locator: getTitleInputPosition, text: input.title },
    // 输入动作内部已有 3 次重试，外层不再重试。
    rounds: 1,
  }

  /** 填正文 + 话题（同框输入）。 */
  const fillBodyAction: ActionSpec = {
    id: 'fill-body',
    title: '填写正文与话题',
    requires: ['post-editor'],
    recoverable: false,
    locate: { intent: '添加正文', fallback: getBodyInputPosition },
    act: {
      kind: 'input',
      text: input.body,
      extras: topicParts,
      match: 'contains',
      inputLocator: getBodyInputPosition,
    },
    verify: {
      kind: 'inputEquals',
      locator: getBodyInputPosition,
      text: input.body,
      match: 'contains',
    },
    // 输入动作内部已有 3 次重试（typeWithVerify），外层不再重试，
    // 否则两个 3 轮嵌套 = 最多 9 次输入，实测耗时 36 秒。
    rounds: 1,
  }

  return {
    id: 'xhs.publish.text',
    uiChannel: 'yadb',
    app: {
      packageName: XHS_PACKAGE,
      homeUri: DEEPLINK_HOME,
      pages: new PageRegistry().register(XHS_PAGES),
      recoveryRules: XHS_RECOVERY_RULES,
    },
    title: `发布文字笔记（${input.title || '无标题'}）`,
    steps: [
      // ── 段 0：输入法 + yadb + 归位（旧代码 1762-1785 行）──
      {
        id: 'prepare',
        title: '准备输入法并回到首页',
        async run(ctx) {
          await prepareEnvironment(ctx)
        },
      },

      // ── 段 1：打开个人页（旧代码 1768-1774 行，5 轮）──
      {
        id: 'open-profile',
        title: '打开个人页（等「我」按钮，5 轮）',
        async run(ctx) {
          await ctx.device.openUri(ctx.serial, DEEPLINK_PROFILE, XHS_PACKAGE)
          for (let i = 0; i < 5; i += 1) {
            await sleepRandom(ctx, 0.5, 1.0)
            if ((await currentPage(ctx, pagesOf(ctx))) === 'profile') break
          }
          await sleepRandom(ctx, 2, 3)
        },
      },

      // ── 段 2：等写想法页（旧代码 1776-1785 行，5 轮）──
      {
        id: 'wait-text-page',
        title: '等待写想法页（5 轮）',
        async run(ctx) {
          for (let i = 0; i < 5; i += 1) {
            if ((await currentPage(ctx, pagesOf(ctx))) === 'text-note') return
            await ctx.device.openUri(ctx.serial, DEEPLINK_WZ, XHS_PACKAGE)
            if ((await waitForPage(ctx, pagesOf(ctx), ['text-note'], 6_000)) === 'text-note') return
          }
          throw new Error('文字输入页未加载')
        },
      },

      // ── 段 3：点输入区域（旧代码 1787-1800 行，6 轮）──
      {
        id: 'focus-text-area',
        title: '点击文字输入区域',
        async run(ctx) {
          await assertPage(ctx, pagesOf(ctx), ['text-note'], '点击输入区域')
          const result = await runAction(ctx, pagesOf(ctx), {
            id: 'focus-text-area',
            title: '点「说点什么」区域',
            requires: ['text-note'],
            locate: { intent: '说点什么', fallback: getTextNoteInputPosition },
            act: { kind: 'tap' },
            rounds: 6,
            gap: [0.3, 0.6],
          })
          if (!result.ok) throw new Error(result.reason ?? '未找到笔记文字输入框')
        },
      },

      // ── 段 4：输入文字内容（旧代码 1802-1820 行）──
      {
        id: 'fill-text',
        title: '输入文字内容（带回读校验）',
        async run(ctx) {
          await assertPage(ctx, pagesOf(ctx), ['text-note'], '输入文字', false)
          const result = await runAction(ctx, pagesOf(ctx), fillTextAction)
          if (!result.ok) throw new Error(result.reason ?? '文字输入失败')
        },
      },

      // ── 段 5：下一步（旧代码 1822-1834 行，6 轮）──
      {
        id: 'text-next-step',
        title: '点击文字笔记「下一步」',
        async run(ctx) {
          const result = await runAction(ctx, pagesOf(ctx), {
            id: 'text-next-step',
            title: '点「下一步」',
            requires: ['text-note'],
            locate: { intent: '下一步', fallback: getTextNextStepButtonPosition },
            act: { kind: 'tap' },
            rounds: 6,
            settle: [1.5, 2.5],
          })
          if (!result.ok) throw new Error(result.reason ?? '未找到文字笔记下一步')
        },
      },

      // ── 段 6：等预览页并进入发布编辑页（旧代码 1836-1862 行）──
      //
      // 实测：预览页是 `CapaPictureReviewV3Activity`，点「下一步」后才到发布编辑页。
      // 旧实现是「等 60 秒，超时就取消重试，最多 3 次」——保留这个语义。
      {
        id: 'wait-preview',
        title: '等待预览页并进入发布编辑页（60s × 3 次）',
        async run(ctx) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            ctx.throwIfCancelled()

            // 先等到预览页出现（超时 60 秒）。
            const arrived = await waitForPage(ctx, pagesOf(ctx), ['review', 'post-editor'], 60_000)
            if (arrived === 'post-editor') return
            if (arrived !== 'review') {
              // 超时：取消后回到写想法页重来（旧实现的取消重试）。
              await runAction(ctx, pagesOf(ctx), {
                id: 'cancel-preview',
                title: '点「取消」退出预览',
                requires: ['text-note', 'review'],
                locate: { intent: '取消', fallback: getCancelButtonPosition, strict: true },
                act: { kind: 'tap' },
                optional: true,
                rounds: 2,
              })
              await runAction(ctx, pagesOf(ctx), {
                id: 'retry-next',
                title: '重新点「下一步」',
                requires: ['text-note'],
                locate: { intent: '下一步', fallback: getTextNextStepButtonPosition },
                act: { kind: 'tap' },
                rounds: 3,
                settle: [1.5, 2.5],
              })
              continue
            }

            // 已在预览页：点「下一步」进入发布编辑页。
            const advanced = await runAction(ctx, pagesOf(ctx), {
              id: 'preview-next',
              title: '预览页点「下一步」',
              requires: ['review'],
              locate: { intent: '下一步', fallback: getPreviewNextStepButtonPosition },
              act: { kind: 'tap' },
              landsOn: ['post-editor'],
              rounds: 5,
              settle: [2, 3],
            })
            if (advanced.ok) return
          }
          throw new Error('预览页重试 3 次仍未进入发布编辑页')
        },
      },

      // ── 段 7：关闭相册定位弹窗（旧代码 1864-1878 行）──
      {
        id: 'dismiss-album-location',
        title: '关闭相册内容定位弹窗',
        async run(ctx) {
          // 与图文一致：用精确路径，不让模型泛化（会误点「返回」）。
          const result = await runAction(ctx, pagesOf(ctx), {
            id: 'dismiss-album-location',
            title: '点「取消」',
            requires: ['post-editor'],
            locate: {
              intent: '取消',
              fallback: getCancelButtonPosition,
              strict: true,
            },
            act: { kind: 'tap' },
            optional: true,
            rounds: 2,
            gap: [0.2, 0.5],
          })
          if (!result.ok) throw new Error(result.reason ?? '相册定位弹窗未关闭')
        },
      },

      // ── 段 8：填标题（旧代码 1880-1904 行）──
      {
        id: 'fill-title',
        title: '填写标题（带回读校验）',
        async run(ctx) {
          if (!input.title) return
          await assertPage(ctx, pagesOf(ctx), ['post-editor'], '填写标题', false)

          // 标题框必须在正文框上方；否则说明页面还没渲染好，
          // 宁可失败也不能把标题写进正文框（图文流程实测踩过）。
          const deadline = Date.now() + 8_000
          while (Date.now() < deadline) {
            const snapshot = await ctx.snapshot({ refresh: true })
            const title = getTitleInputPosition(snapshot.root)
            const body = getBodyInputPosition(snapshot.root)
            if (title && body && title.y < body.y) break
            await sleepRandom(ctx, 0.4, 0.8)
          }

          const result = await runAction(ctx, pagesOf(ctx), fillTitleAction)
          if (!result.ok) throw new Error(result.reason ?? '标题输入失败')
        },
      },

      // ── 段 9-10：填正文 + 话题（旧代码 1906-1938 行）──
      {
        id: 'fill-body',
        title: '填写正文与话题（同框校验）',
        async run(ctx) {
          await assertPage(ctx, pagesOf(ctx), ['post-editor'], '填写正文', false)
          const result = await runAction(ctx, pagesOf(ctx), fillBodyAction)
          if (!result.ok) throw new Error(result.reason ?? '正文输入失败')

          const done = await runAction(ctx, pagesOf(ctx), {
            id: 'done',
            title: '点「完成」收起键盘',
            requires: ['post-editor'],
            locate: { intent: '完成', fallback: getDoneButtonPosition, strict: true },
            act: { kind: 'tap' },
            optional: true,
            rounds: 2,
          })
          void done
        },
      },

      // ── 段 11：保存或发布（旧代码 1940-1962 行）──
      {
        id: 'submit',
        title: input.fbMode === 'save' ? '存草稿' : '发布笔记',
        async run(ctx) {
          await assertPage(ctx, pagesOf(ctx), ['post-editor'], '保存/发布', false)
          await submitNote(ctx, input.fbMode)
        },
      },

      // ── 段 12：校验结果（旧代码 1964-1994 行，9 轮）──
      {
        id: 'verify-published',
        title: '回主页校验笔记/草稿（9 轮）',
        async run(ctx) {
          if (!(await verifyPublished(ctx))) throw new Error('未找到草稿或笔记')
        },
      },
    ],
  }
}
