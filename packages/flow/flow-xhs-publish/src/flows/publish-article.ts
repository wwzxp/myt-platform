import type { FlowDefinition } from '@myt/flow'
import {
  findButtonByText,
  getAlbumPermissionCancelButtonPosition,
  getArticleBodyInputPosition,
  getArticleTitleInputPosition,
  getBackButtonPosition,
  getFormatButtonPosition,
  getPublishButtonPosition,
  getTryItButtonPosition,
  getWriteArticleButtonPosition,
} from '../locators/publish-locators.ts'
import {
  runAction,
  runActions,
  assertPage,
  currentPage,
  waitForPage,
  askPageYesNo,
  sleepRandom,
  tapHuman,
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
 * 长文笔记发布流程（**1:1 移植**自 `auto_fb.fb_long_wz`，2227-2444 行）。
 *
 * **引擎化**：动作定义只剩参数，五步循环由 `runAction` 统一处理。
 * 通过 `xhsdiscover://post_new_note` 打开写想法页，再点「写长文」进入 `LongNoteEditActivity`。
 *
 * 与旧代码的差异（实测）：
 * - 长文页**没有「下一步」**，发布入口是点右上角返回后的弹窗（`不保存返回` / `存草稿`）
 * - 标题/正文的层级路径比旧代码少一层
 */

/** 写想法页深链（`open_fb_wz_page`，273-275 行）。 */
const DEEPLINK_WZ = 'xhsdiscover://post_new_note?page={"page_type":"now_portal_home_page"}'

/** 长文笔记发布入参。 */
export interface PublishArticleInput {
  /** 标题。 */
  title: string
  /** 正文。 */
  body: string
  /** 话题（不含 `#`）。 */
  topics: readonly string[]
  /** 保存方式。 */
  fbMode: 'save' | 'publish'
}

/** 长文页的三种入口页面（写想法页 → 长文编辑页）。 */
const ARTICLE_PAGES = ['article-editor'] as const

/**
 * 长文编辑页的「填写内容」动作。
 *
 * 标题和正文都在同一页，用定义顺序区分：先标题后正文。
 * `requires` 只校验「在长文编辑页」，具体填哪个靠 `locate.intent` 和 `act.inputLocator`。
 */
function fillArticleField(
  id: string,
  title: string,
  intent: string,
  text: string,
  locator: ActionSpec['act'] extends { kind: 'input'; inputLocator: infer L } ? L : never,
): ActionSpec {
  return {
    id,
    title,
    requires: ARTICLE_PAGES,
    // 填写类禁止恢复：已有输入内容，退回会丢数据。
    recoverable: false,
    locate: { intent },
    act: { kind: 'input', text, inputLocator: locator },
    verify: { kind: 'inputEquals', locator, text },
    rounds: 6,
    gap: [0.8, 1.4],
  }
}

/**
 * 创建长文笔记发布流程。
 *
 * @param input 发布内容
 */
export function createPublishArticleFlow(input: PublishArticleInput): FlowDefinition {
  // 动作清单：纯参数，按定义顺序执行，前一动作成功才做下一个。
  const actions: ActionSpec[] = [
    {
      id: 'open-article-entry',
      title: '点「写长文」进入长文编辑页',
      requires: ['text-note'],
      locate: { intent: '写长文', fallback: getWriteArticleButtonPosition },
      act: { kind: 'tap' },
      verify: { kind: 'page', expect: [...ARTICLE_PAGES] },
      rounds: 6,
      settle: [1.5, 2.5],
    },
    {
      id: 'dismiss-try-it',
      title: '关闭「try it」引导',
      requires: ARTICLE_PAGES,
      locate: { intent: '试试看 try it', fallback: getTryItButtonPosition },
      act: { kind: 'tap' },
      // 引导可能不出现：标记 optional，找不到也算成功。
      optional: true,
      rounds: 2,
      gap: [0.3, 0.5],
    },
  ]

  return {
    id: 'xhs.publish.article',
    uiChannel: 'yadb',
    app: {
      packageName: XHS_PACKAGE,
      homeUri: DEEPLINK_HOME,
      pages: new PageRegistry().register(XHS_PAGES),
      recoveryRules: XHS_RECOVERY_RULES,
    },
    title: `发布长文笔记（${input.title || '无标题'}）`,
    steps: [
      // ── 准备：输入法 + yadb + 归位 ──
      {
        id: 'prepare',
        title: '准备输入法并回到首页',
        async run(ctx) {
          await prepareEnvironment(ctx)
        },
      },

      // ── 打开个人页 → 写想法页 ──
      {
        id: 'open-profile',
        title: '打开个人页（等「我」按钮，5 轮）',
        async run(ctx) {
          await ctx.device.openUri(ctx.serial, DEEPLINK_PROFILE, XHS_PACKAGE)
          for (let i = 0; i < 5; i += 1) {
            await sleepRandom(ctx, 0.5, 1.0)
            const page = await currentPage(ctx, pagesOf(ctx))
            if (page === 'profile') break
          }
          await sleepRandom(ctx, 2, 3)
        },
      },

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

      // ── 进入长文编辑页（引擎动作）──
      {
        id: 'open-article',
        title: '进入长文编辑页',
        async run(ctx) {
          const outcome = await runActions(ctx, pagesOf(ctx), actions)
          if (!outcome.ok) {
            const failed = outcome.results.at(-1)
            throw new Error(`「${failed?.id}」失败：${failed?.result.reason ?? '未知原因'}`)
          }
        },
      },

      // ── 填写标题 ──
      {
        id: 'fill-article-title',
        title: '填写长文标题（6 轮，带回读校验）',
        async run(ctx) {
          if (!input.title) return
          await assertPage(ctx, pagesOf(ctx), ARTICLE_PAGES, '长文标题', false)
          const result = await runAction(ctx, pagesOf(ctx), {
            id: 'fill-title',
            title: '填写长文标题',
            requires: ARTICLE_PAGES,
            recoverable: false,
            // 意图用候选里的精确文字：长文页还有「一键排版」，写「标题」会选错。
            locate: { intent: '输入标题', fallback: getArticleTitleInputPosition },
            act: { kind: 'input', text: input.title, inputLocator: getArticleTitleInputPosition },
            verify: { kind: 'inputEquals', locator: getArticleTitleInputPosition, text: input.title },
            rounds: 6,
            gap: [0.8, 1.4],
          })
          if (!result.ok) throw new Error(result.reason ?? '长文标题输入失败')
        },
      },

      // ── 填写正文 ──
      {
        id: 'fill-article-body',
        title: '填写长文正文（6 轮，带回读校验）',
        async run(ctx) {
          if (!input.body) return
          await assertPage(ctx, pagesOf(ctx), ARTICLE_PAGES, '长文正文', false)
          const result = await runAction(ctx, pagesOf(ctx), {
            id: 'fill-body',
            title: '填写长文正文',
            requires: ARTICLE_PAGES,
            recoverable: false,
            locate: { intent: '粘贴到这里或输入文字', fallback: getArticleBodyInputPosition },
            act: { kind: 'input', text: input.body, inputLocator: getArticleBodyInputPosition },
            verify: { kind: 'inputEquals', locator: getArticleBodyInputPosition, text: input.body },
            rounds: 6,
            gap: [0.8, 1.4],
          })
          if (!result.ok) throw new Error(result.reason ?? '长文正文输入失败')
        },
      },

      // ── 格式化 ──
      {
        id: 'format',
        title: '点击格式化（6 轮）',
        async run(ctx) {
          const result = await runAction(ctx, pagesOf(ctx), {
            id: 'format',
            title: '点击格式化',
            requires: ARTICLE_PAGES,
            locate: { intent: '一键排版', fallback: getFormatButtonPosition },
            act: { kind: 'tap' },
            rounds: 6,
          })
          if (!result.ok) throw new Error(result.reason ?? '未找到格式化按钮')
        },
      },

      // ── 长文页没有「下一步」，走返回 → 存草稿 ──
      {
        id: 'article-save-draft',
        title: '长文页返回并选择「存草稿」',
        async run(ctx) {
          // 收起键盘，避免返回键只关键盘。
          await ctx.device.pressKey(ctx.serial, 'KEYCODE_BACK')
          await sleepRandom(ctx, 0.5, 1.0)

          for (let i = 0; i < 6; i += 1) {
            const snapshot = await ctx.snapshot({ refresh: true })
            const dialog = findButtonByText(snapshot.root, ['存草稿', '发布'])
            if (dialog) {
              await tapHuman(ctx, dialog)
              await sleepRandom(ctx, 1.5, 2.5)
              return
            }
            const back = getBackButtonPosition(snapshot.root)
            if (back) await tapHuman(ctx, back)
            await sleepRandom(ctx, 1, 1.5)
          }
          throw new Error('长文页未出现「存草稿」弹窗')
        },
      },

      // ── 关闭相册定位弹窗 ──
      {
        id: 'dismiss-album-location',
        title: '关闭相册内容定位弹窗',
        async run(ctx) {
          for (let i = 0; i < 5; i += 1) {
            await sleepRandom(ctx, 0.1, 0.5)
            const snapshot = await ctx.snapshot({ refresh: true })
            if (getPublishButtonPosition(snapshot.root)) return
            const cancel = getAlbumPermissionCancelButtonPosition(snapshot.root)
            if (cancel) {
              await tapHuman(ctx, cancel)
              return
            }
          }
        },
      },

      // ── 保存或发布 ──
      {
        id: 'submit',
        title: input.fbMode === 'save' ? '存草稿' : '发布笔记',
        async run(ctx) {
          await submitNote(ctx, input.fbMode)
        },
      },

      // ── 校验结果 ──
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

export { DEEPLINK_HOME }
