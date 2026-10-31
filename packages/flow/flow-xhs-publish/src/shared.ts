import type { StepContext } from '@myt/flow'
import type { PageRegistry } from '@myt/automation'
import {
  askYesNo,
  locateByModel,
  randInt,
  runAction,
  screenSizeOf,
  sleepRandom,
  tapHuman,
} from '@myt/automation'
import {
  getAllImagePositions,
  getConfirmDialogButtonPosition,
  getPublishButtonPosition,
  getSaveDraftButtonPosition,
  hasPublicNotesContent,
  isGalleryPagePresent,
  isLoadingSpinnerPresent,
  pickImagesByCount,
} from './locators/publish-locators.ts'
import type { ActionSpec } from '@myt/automation'
import { DEEPLINK_HOME, DEEPLINK_PROFILE, XHS_PACKAGE } from './pages.ts'

/**
 * 小红书发布流程的共用动作。
 *
 * 引擎（`@myt/automation`）提供通用的五步循环、页面识别、异常恢复；
 * 这里放**小红书特有的**编排：准备环境、保存/发布、校验结果、选图。
 */

/** 从步骤上下文取页面注册表。 */
export function pagesOf(ctx: StepContext): PageRegistry {
  const app = ctx.app as { pages: PageRegistry } | undefined
  if (!app?.pages) throw new Error('StepContext 缺少页面注册表（ctx.app.pages）')
  return app.pages
}

/** 拟人化下拉刷新（`pull_to_refresh`，840-850 行，坐标改为按屏幕比例）。 */
export async function pullToRefresh(ctx: StepContext): Promise<void> {
  const { width, height } = await screenSizeOf(ctx)
  const baseX = Math.round(width * (0.36 + ctx.random.next() * 0.08))
  await ctx.device.swipe(
    ctx.serial,
    { x: baseX, y: Math.round(height * (0.16 + ctx.random.next() * 0.09)) },
    { x: baseX, y: Math.round(height * (0.69 + ctx.random.next() * 0.09)) },
    randInt(ctx, 700, 900),
  )
  await sleepRandom(ctx, 0.5, 1.0)
}

/** 滚动相册（`scroll_album_page`，970-973 行，坐标改为按屏幕比例）。 */
export async function scrollAlbumPage(ctx: StepContext): Promise<void> {
  const { width, height } = await screenSizeOf(ctx)
  const x = Math.round(width * 0.535)
  await ctx.device.swipe(
    ctx.serial,
    { x, y: Math.round(height * 0.5) },
    { x, y: Math.round(height * 0.26) },
    411,
  )
  await sleepRandom(ctx, 0.5, 1.0)
}

/** 准备环境：输入法 + yadb + 归位。 */
export async function prepareEnvironment(ctx: StepContext): Promise<void> {
  await ctx.device.ensureIme(ctx.serial).catch(() => undefined)
  if (!ctx.yadbPath) throw new Error('未配置 yadb 路径（MYT_YADB_PATH）')
  await ctx.device.ensureYadb(ctx.serial, ctx.yadbPath)

  const { pages } = { pages: pagesOf(ctx) }
  const { currentPage } = await import('@myt/automation')
  const page = await currentPage(ctx, pages)
  if (page === 'home' || page === 'profile') return
  await ctx.device.openUri(ctx.serial, DEEPLINK_HOME, XHS_PACKAGE)
  await sleepRandom(ctx, 2, 3)
}

/** 保存或发布（三个流程共用）。 */
export async function submitNote(ctx: StepContext, mode: 'save' | 'publish'): Promise<void> {
  await sleepRandom(ctx, 0.3, 0.8)

  if (mode === 'save') {
    const save = await ctx.snapshot({ refresh: true })
    const savePoint = getSaveDraftButtonPosition(save.root)
    if (savePoint) await tapHuman(ctx, savePoint)

    await sleepRandom(ctx, 1, 2)
    const confirm = await ctx.snapshot({ refresh: true })
    const confirmPoint = getConfirmDialogButtonPosition(confirm.root)
    if (confirmPoint) await tapHuman(ctx, confirmPoint)
    return
  }

  const publish = await ctx.snapshot({ refresh: true })
  const publishPoint = getPublishButtonPosition(publish.root)
  if (publishPoint) await tapHuman(ctx, publishPoint)
}

/** 校验发布结果：回主页 → 刷新 → 判断有没有笔记。 */
export async function verifyPublished(ctx: StepContext, rounds = 9): Promise<boolean> {
  await sleepRandom(ctx, 0.3, 0.8)

  for (let i = 0; i < rounds; i += 1) {
    ctx.throwIfCancelled()
    await sleepRandom(ctx, 0.2, 0.5)
    await ctx.device.openUri(ctx.serial, DEEPLINK_PROFILE, XHS_PACKAGE)
    await sleepRandom(ctx, 0.2, 0.5)
    await pullToRefresh(ctx)

    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const snapshot = await ctx.snapshot({ refresh: true })
      if (!isLoadingSpinnerPresent(snapshot.root)) break
      await sleepRandom(ctx, 1, 5)
    }

    for (let j = 0; j < 3; j += 1) await scrollAlbumPage(ctx)

    const asked = await askYesNo(
      ctx,
      ctx.model,
      '这是我自己主页的笔记区域，判断页面上有没有我发布的笔记或草稿。',
      'hasNote',
    )
    if (asked.value === true) return true

    if (asked.value === null) {
      const snapshot = await ctx.snapshot({ refresh: true })
      if (hasPublicNotesContent(snapshot.root)) return true
    }

    await sleepRandom(ctx, 2, 6)
  }
  return false
}

/** 选图动作：先算坐标列表，再逐个点击。 */
export function pickImagesAction(targetCount: number): ActionSpec {
  return {
    id: 'pick-images',
    title: `选择 ${targetCount} 张图片`,
    requires: ['album', 'photo-picker'],
    act: {
      kind: 'custom',
      async run(ctx) {
        let totalSelected = 0
        let emptyScrolls = 0

        for (let attempt = 0; attempt < 10; attempt += 1) {
          ctx.throwIfCancelled()
          const remaining = targetCount - totalSelected
          if (remaining <= 0) break

          const snapshot = await ctx.snapshot({ refresh: true })
          if (!isGalleryPagePresent(snapshot.root)) throw new Error('未找到图库页')

          const maxVisible = emptyScrolls >= 2 ? 9 : 6
          const points = pickImagesByCount(snapshot.root, remaining, maxVisible)

          if (points.length > 0) {
            emptyScrolls = 0
            for (const point of points) {
              await tapHuman(ctx, point)
              await sleepRandom(ctx, 0.3, 0.5)
            }
            totalSelected += points.length
            await sleepRandom(ctx, 0.3, 0.6)
            if (totalSelected < targetCount) {
              await scrollAlbumPage(ctx)
              await sleepRandom(ctx, 0.5, 1.0)
            }
          } else {
            emptyScrolls += 1
            await scrollAlbumPage(ctx)
            await sleepRandom(ctx, 0.5, 1.0)
          }
        }

        if (totalSelected < targetCount) {
          throw new Error(`选图不足：${totalSelected}/${targetCount}`)
        }
      },
    },
    verify: {
      kind: 'countAtLeast',
      target: targetCount,
      async measure(ctx) {
        const snapshot = await ctx.snapshot({ refresh: true })
        return getAllImagePositions(snapshot.root).filter((image) => image.selected).length
      },
    },
    rounds: 3,
    gap: [1.0, 1.5],
  }
}

/** 关闭「相册内容位置信息」弹窗（有就关，没有就算）。 */
export function dismissAlbumLocationAction(fallback: ActionSpec['locate'] extends infer L ? L : never): ActionSpec {
  void fallback
  return {
    id: 'dismiss-album-location',
    title: '关闭相册内容定位弹窗',
    requires: ['post-editor'],
    locate: { intent: '取消', strict: true },
    act: { kind: 'tap' },
    optional: true,
    rounds: 2,
    gap: [0.2, 0.5],
  }
}

export { locateByModel, runAction, askYesNo }
export { DEEPLINK_HOME, DEEPLINK_PROFILE, DEEPLINK_PUBLISH_IMAGE, DEEPLINK_WZ, XHS_PACKAGE } from './pages.ts'
