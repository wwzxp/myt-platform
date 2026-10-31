import type { FlowDefinition } from '@myt/flow'
import {
  getAlbumPermissionCancelButtonPosition,
  getAllowAlbumButtonPosition,
  getBodyInputPosition,
  getDoneButtonPosition,
  getGotItButtonPosition,
  getImageSaveButtonPosition,
  getMusicButtonPosition,
  getMuteDialogCancelButtonPosition,
  getNextStepButtonPosition,
  getTitleInputPosition,
  isGalleryPagePresent,
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
  pickImagesAction,
  prepareEnvironment,
  submitNote,
  verifyPublished,
  pagesOf,
} from '../shared.ts'
import { XHS_PAGES, XHS_RECOVERY_RULES, XHS_PACKAGE, DEEPLINK_HOME } from '../pages.ts'

/**
 * 图文笔记发布流程（**1:1 移植**自 `auto_fb.fb_image`，1198-1554 行）。
 *
 * **引擎化**：动作只剩参数，五步循环（取界面→判页面→找坐标→执行→校验）由 `runAction` 统一处理。
 * 与旧代码的段位一一对应，不合并、不删减。
 */

/** 发布入口深链（`open_fb_image_page`，269-271 行）。 */
const DEEPLINK_PUBLISH_IMAGE = 'xhsdiscover://post_note/'

/** 图文笔记发布入参。 */
export interface PublishImageInput {
  /** 标题。 */
  title: string
  /** 正文。 */
  body: string
  /** 话题（不含 `#`）。 */
  topics: readonly string[]
  /** 本地图片绝对路径（已展开的文件列表）。 */
  imagePaths: readonly string[]
  /** 是否音乐图集。 */
  musicImg: boolean
  /** 保存方式。 */
  fbMode: 'save' | 'publish'
}

/**
 * 创建图文笔记发布流程。
 *
 * @param input 发布内容
 */
export function createPublishImageFlow(input: PublishImageInput): FlowDefinition {
  /** 话题拼接（旧实现：先换行，再每个话题前加 `#` 后加空格）。 */
  const topicParts: string[] = []
  if (input.topics.length > 0) {
    topicParts.push('\n')
    for (const topic of input.topics) {
      topicParts.push('#')
      topicParts.push(`${topic} `)
    }
  }

  /** 选完图后弹出的各种提示（都是可选动作：不出现是正常的）。 */
  const galleryNoticeActions: ActionSpec[] = [
    {
      id: 'dismiss-chapter-dialog',
      title: '关闭「添加章节」提示',
      requires: ['post-editor', 'image-editor', 'album'],
      locate: { intent: '我知道了', fallback: getGotItButtonPosition, strict: true },
      act: { kind: 'tap' },
      optional: true,
      rounds: 3,
      gap: [0.2, 0.5],
    },
    {
      id: 'dismiss-mute-dialog',
      title: '关闭账号静音提示',
      requires: ['post-editor', 'image-editor', 'album'],
      locate: { intent: 'Cancel 取消', fallback: getMuteDialogCancelButtonPosition, strict: true },
      act: { kind: 'tap' },
      optional: true,
      rounds: 3,
      gap: [0.2, 0.5],
    },
  ]

  /** 填标题动作（填写类：禁止恢复，已有内容退回会丢）。 */
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

  /**
   * 标题框与正文框的区分。
   *
   * 实测踩过的坑：页面刚切完、`添加标题` 还没渲染时，标题动作按路径取到的
   * 其实是正文框，结果把标题写成了正文内容（还带上了话题格式 `#标题`，
   * 触发「话题最多只可以输入 30 个字符」）。
   * 判据：标题框在上方（y 更小），正文框在下方。
   */
  const isTitleAboveBody = (root: Parameters<typeof getTitleInputPosition>[0]): boolean => {
    const title = getTitleInputPosition(root)
    const body = getBodyInputPosition(root)
    if (!title || !body) return false
    return title.y < body.y
  }

  /** 填正文 + 话题动作（同框输入，contains 校验）。 */
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
    id: 'xhs.publish.image',
    uiChannel: 'yadb',
    app: {
      packageName: XHS_PACKAGE,
      homeUri: DEEPLINK_HOME,
      pages: new PageRegistry().register(XHS_PAGES),
      recoveryRules: XHS_RECOVERY_RULES,
    },
    title: `发布图文笔记（${input.title || '无标题'}）`,
    steps: [
      // ── 段 0：准备环境 + 上传图片（旧代码 1201-1207 行）──
      {
        id: 'prepare',
        title: '上传图片并准备输入法',
        async run(ctx) {
          if (input.imagePaths.length > 0) {
            // 倒序上传：后选中的先传，避免相册按时间排序错乱。
            for (const localPath of [...input.imagePaths].reverse()) {
              await ctx.device.pushToGallery(ctx.serial, localPath)
            }
            await sleepRandom(ctx, 0.5, 1.5)
          }
          await prepareEnvironment(ctx)
        },
      },

      // ── 段 1：打开个人页（旧代码 1209-1216 行，5 轮）──
      {
        id: 'open-profile',
        title: '打开个人页（5 轮）',
        async run(ctx) {
          await ctx.device.openUri(ctx.serial, DEEPLINK_PROFILE, XHS_PACKAGE)
          for (let i = 0; i < 5; i += 1) {
            await sleepRandom(ctx, 0.5, 1.0)
            if ((await currentPage(ctx, pagesOf(ctx))) === 'profile') break
          }
          await sleepRandom(ctx, 2, 3)
        },
      },

      // ── 段 2：等相册加载（旧代码 1219-1233 行，5 轮）──
      {
        id: 'wait-gallery',
        title: '等待相册加载（5 轮）',
        async run(ctx) {
          for (let i = 0; i < 5; i += 1) {
            await sleepRandom(ctx, 0.5, 1.0)
            const page = await currentPage(ctx, pagesOf(ctx))
            if (page === 'album' || page === 'photo-picker' || page === 'permission') return

            const snapshot = await ctx.snapshot({ refresh: true })
            if (getAllowAlbumButtonPosition(snapshot.root) || isGalleryPagePresent(snapshot.root)) {
              await sleepRandom(ctx, 0.5, 1.0)
              return
            }

            await ctx.device.openUri(ctx.serial, DEEPLINK_PUBLISH_IMAGE, XHS_PACKAGE)
            const arrived = await waitForPage(ctx, pagesOf(ctx), ['album', 'photo-picker', 'permission'], 6_000)
            if (arrived === 'album' || arrived === 'photo-picker' || arrived === 'permission') return
          }
          throw new Error('相册未加载')
        },
      },

      // ── 段 3：允许访问相册（旧代码 1236-1250 行）──
      {
        id: 'album-permission',
        title: '允许访问相册',
        async run(ctx) {
          // 不在权限弹窗就直接返回：之前在任何页面上找「全部允许」会误点。
          if ((await currentPage(ctx, pagesOf(ctx))) !== 'permission') return
          const result = await runAction(ctx, pagesOf(ctx), {
            id: 'allow-album',
            title: '点「全部允许」',
            requires: ['permission'],
            locate: { intent: '全部允许', fallback: getAllowAlbumButtonPosition },
            act: { kind: 'tap' },
            optional: true,
            rounds: 5,
            gap: [0.3, 0.6],
          })
          if (!result.ok) throw new Error(result.reason ?? '相册权限未处理')
        },
      },

      // ── 段 4：选图（旧代码 1252-1295 行）──
      {
        id: 'pick-images',
        title: `选择 ${input.imagePaths.length} 张图片`,
        async run(ctx) {
          if (input.imagePaths.length === 0) return
          const startPage = await waitForPage(ctx, pagesOf(ctx), ['album', 'photo-picker'], 10_000)
          if (startPage !== 'album' && startPage !== 'photo-picker') {
            throw new Error(`选图：当前页面是 ${startPage}，期望相册`)
          }

          const result = await runAction(ctx, pagesOf(ctx), pickImagesAction(input.imagePaths.length))
          if (!result.ok) throw new Error(result.reason ?? '选图失败')

          // 选完点「下一步」：意图必须带角标数字，否则模型会选「一键成片」。
          const next = await runAction(ctx, pagesOf(ctx), {
            id: 'gallery-next',
            title: '图库点「下一步」',
            requires: ['album', 'photo-picker'],
            locate: {
              intent: `下一步(${input.imagePaths.length})`,
              fallback: getImageSaveButtonPosition,
            },
            act: { kind: 'tap' },
            rounds: 5,
            settle: [1.5, 2.5],
          })
          if (!next.ok) throw new Error(next.reason ?? '未找到图片保存按钮')
        },
      },

      // ── 段 4.5：图片编辑页 → 发布编辑页（**正常路径**，不是异常）──
      //
      // 实测链路：相册点「下一步(N)」→ `ImageEditActivity3`（图片编辑页）
      //           → 点右下角「下一步」→ `CapaPostNotePlatformActivity`
      //
      // 旧版小红书是「相册 → 直接到发布编辑页」，所以旧代码没有这一步。
      // 当前版本每次必经编辑页，所以放在流程里主动点，
      // **不能交给恢复层**——恢复层是「出了意外才走」的兜底，
      // 把正常路径塞进去会导致每步都承担误判风险（实测把「图文模板」当成「完成」点了）。
      {
        id: 'skip-image-editor',
        title: '图片编辑页点「下一步」进入发布编辑页',
        async run(ctx) {
          await sleepRandom(ctx, 1.5, 2.5)

          for (let i = 0; i < 4; i += 1) {
            const page = await currentPage(ctx, pagesOf(ctx))
            if (page === 'post-editor') return
            // 还在相册说明选图没生效，交给后面的步骤处理。
            if (page === 'album' || page === 'photo-picker') return
            if (page !== 'image-editor') break

            // 编辑页的「下一步」是右下角红底按钮，候选列表里名字就是「下一步」。
            const result = await runAction(ctx, pagesOf(ctx), {
              id: 'editor-next',
              title: '点编辑页「下一步」',
              requires: ['image-editor'],
              locate: { intent: '下一步', fallback: getNextStepButtonPosition },
              act: { kind: 'tap' },
              rounds: 5,
              settle: [2, 3],
            })
            if (!result.ok) throw new Error(result.reason ?? '编辑页未找到「下一步」')
          }

          if ((await currentPage(ctx, pagesOf(ctx))) !== 'post-editor') {
            throw new Error(`进入发布编辑页失败：当前是 ${await currentPage(ctx, pagesOf(ctx))}`)
          }

          // 页面切换完成 ≠ 界面渲染完成。
          // 实测：Activity 已经是 CapaPostNotePlatformActivity，但候选里还没有
          // 「添加标题」，直接往下走会把标题输进正文框（标题被写成了正文内容）。
          // 所以这里必须等到标题输入框真的出现。
          const deadline = Date.now() + 10_000
          while (Date.now() < deadline) {
            const snapshot = await ctx.snapshot({ refresh: true })
            if (getTitleInputPosition(snapshot.root)) {
              await sleepRandom(ctx, 0.5, 1.0)
              return
            }
            await sleepRandom(ctx, 0.4, 0.8)
          }
          throw new Error('发布编辑页已打开，但标题输入框迟迟未出现')
        },
      },

      // ── 段 5-8：章节弹窗 / 静音提示 / 音乐图集 / 再关静音（旧代码 1307-1378 行）──
      {
        id: 'gallery-notices',
        title: '处理选图后的提示弹窗',
        async run(ctx) {
          const outcome = await runActions(ctx, pagesOf(ctx), galleryNoticeActions)
          if (!outcome.ok) {
            const failed = outcome.results.at(-1)
            throw new Error(`「${failed?.id}」失败：${failed?.result.reason ?? '未知原因'}`)
          }
        },
      },

      // ── 音乐图集（旧代码 1343-1360 行，仅模板勾选时执行）──
      {
        id: 'music-album',
        title: '选择音乐图集（仅模板勾选时执行）',
        async run(ctx) {
          if (!input.musicImg) return
          const result = await runAction(ctx, pagesOf(ctx), {
            id: 'music-album',
            title: '点「选择音乐」',
            requires: ['post-editor', 'image-editor'],
            locate: { intent: '选择音乐', fallback: getMusicButtonPosition },
            act: { kind: 'tap' },
            rounds: 5,
            gap: [2, 3],
          })
          if (!result.ok) throw new Error(result.reason ?? '未找到音乐图集')
        },
      },

      // ── 段 8：再关一次静音提示（旧代码 1362-1378 行）──
      {
        id: 'dismiss-mute-dialog-again',
        title: '再次关闭账号静音提示',
        async run(ctx) {
          const result = await runAction(ctx, pagesOf(ctx), {
            id: 'dismiss-mute-again',
            title: '关闭静音提示',
            requires: ['post-editor', 'image-editor'],
            locate: { intent: 'Cancel 取消', fallback: getMuteDialogCancelButtonPosition, strict: true },
            act: { kind: 'tap' },
            optional: true,
            rounds: 3,
            gap: [0.2, 0.5],
          })
          if (!result.ok) throw new Error(result.reason ?? '静音提示未关闭')
        },
      },

      // ── 段 9：图文编辑页下一步（旧代码 1380-1397 行，20 轮）──
      {
        id: 'next-step',
        title: '点击图文编辑页「下一步」',
        async run(ctx) {
          const page = await waitForPage(ctx, pagesOf(ctx), ['image-editor', 'post-editor'], 8_000)
          // 已经在发布编辑页说明前一步已完成推进。
          if (page === 'post-editor') return

          const result = await runAction(ctx, pagesOf(ctx), {
            id: 'next-step',
            title: '点「下一步」',
            requires: ['image-editor'],
            locate: { intent: '下一步', fallback: getNextStepButtonPosition },
            act: { kind: 'tap' },
            landsOn: ['post-editor'],
            rounds: 20,
            settle: [1.5, 2.5],
          })
          if (!result.ok) throw new Error(result.reason ?? '未找到图文编辑页下一步')
        },
      },

      // ── 段 10：取消相册内容定位（旧代码 1399-1415 行）──
      {
        id: 'dismiss-album-location',
        title: '关闭相册内容定位弹窗',
        async run(ctx) {
          // 这个弹窗只在特定机型/版本出现（「申请获取您的相册内容位置信息」）。
          // 用**精确路径**判断，不让模型泛化找「取消」——实测泛化时，
          // 在发布编辑页上模型会选中「返回」，一点就退回图片编辑页，整单失败。
          const result = await runAction(ctx, pagesOf(ctx), {
            id: 'dismiss-album-location',
            title: '点「取消」',
            requires: ['post-editor'],
            locate: { intent: '取消', fallback: getAlbumPermissionCancelButtonPosition, strict: true },
            act: { kind: 'tap' },
            optional: true,
            rounds: 2,
            gap: [0.2, 0.5],
          })
          if (!result.ok) throw new Error(result.reason ?? '相册定位弹窗未关闭')
        },
      },

      // ── 段 11：填标题（旧代码 1417-1441 行）──
      {
        id: 'fill-title',
        title: '填写标题（带回读校验）',
        async run(ctx) {
          if (!input.title) return
          await assertPage(ctx, pagesOf(ctx), ['post-editor'], '填写标题', false)

          // 标题框必须在正文框上方；否则说明页面还没渲染好，宁可失败重跑，
          // 也不能把标题写进正文框。
          const deadline = Date.now() + 8_000
          while (Date.now() < deadline) {
            const snapshot = await ctx.snapshot({ refresh: true })
            if (isTitleAboveBody(snapshot.root)) break
            await sleepRandom(ctx, 0.4, 0.8)
          }
          const ready = await ctx.snapshot({ refresh: true })
          if (!isTitleAboveBody(ready.root)) {
            throw new Error('标题输入框未就绪（或与正文框位置异常），已中止以免写错位置')
          }

          const result = await runAction(ctx, pagesOf(ctx), fillTitleAction)
          if (!result.ok) throw new Error(result.reason ?? '标题输入失败')
        },
      },

      // ── 段 12-13：填正文 + 话题（旧代码 1443-1485 行）──
      {
        id: 'fill-body',
        title: '填写正文与话题（同框校验）',
        async run(ctx) {
          await assertPage(ctx, pagesOf(ctx), ['post-editor'], '填写正文', false)
          const result = await runAction(ctx, pagesOf(ctx), fillBodyAction)
          if (!result.ok) throw new Error(result.reason ?? '正文输入失败')

          // 点「完成」收起键盘（旧代码 1480-1485 行）。
          const done = await runAction(ctx, pagesOf(ctx), {
            id: 'done',
            title: '点「完成」收起键盘',
            requires: ['post-editor'],
            locate: { intent: '完成', fallback: getDoneButtonPosition },
            act: { kind: 'tap' },
            optional: true,
            rounds: 2,
          })
          void done
        },
      },

      // ── 段 14：保存或发布（旧代码 1487-1513 行）──
      {
        id: 'submit',
        title: input.fbMode === 'save' ? '存草稿' : '发布笔记',
        async run(ctx) {
          await assertPage(ctx, pagesOf(ctx), ['post-editor'], '保存/发布', false)
          await submitNote(ctx, input.fbMode)
        },
      },

      // ── 段 15：校验结果（旧代码 1515-1554 行，9 轮）──
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

export { askPageYesNo, tapHuman }
