import type { StepContext } from '@myt/flow'
import type { FlowGraph } from '@myt/automation'
import { PageRegistry, runGraph, type GraphRuntime, type LocatorTable } from '@myt/automation'
import {
  findButtonByText,
  getAlbumPermissionCancelButtonPosition,
  getAllowAlbumButtonPosition,
  getArticleBodyInputPosition,
  getArticleTitleInputPosition,
  getBodyInputPosition,
  getBottomProfileButtonPosition,
  getCancelButtonPosition,
  getConfirmDialogButtonPosition,
  getDoneButtonPosition,
  getAllImagePositions,
  getFormatButtonPosition,
  getGotItButtonPosition,
  getImageSaveButtonPosition,
  getMusicButtonPosition,
  getMuteDialogCancelButtonPosition,
  getNextStepButtonPosition,
  getPreviewNextStepButtonPosition,
  getPublishButtonPosition,
  getSaveDraftButtonPosition,
  getTextEditInputPosition,
  getTextNextStepButtonPosition,
  getTextNoteInputPosition,
  getTitleInputPosition,
  getTryItButtonPosition,
  getWriteArticleButtonPosition,
  isGalleryPagePresent,
  pickImagesByCount,
} from './locators/publish-locators.ts'
import {
  DEEPLINK_HOME,
  DEEPLINK_PROFILE,
  XHS_PACKAGE,
  pullToRefresh,
  scrollAlbumPage,
  submitNote,
  verifyPublished,
} from './shared.ts'
import { sleepRandom, tapHuman } from '@myt/automation'

/**
 * 把 JSON 图跑起来：注入小红书专属的定位器与自定义动作。
 *
 * 图本身是纯数据（`data/flows/*.json`），这里提供它引用的实现。
 * 引擎不认识小红书——所有业务知识都在这个文件里。
 */

/** 定位器表：JSON 里的 `fallback` / `inputLocator` 按名字查这里。 */
export const XHS_LOCATORS: LocatorTable = {
  getAllowAlbumButtonPosition,
  getAlbumPermissionCancelButtonPosition,
  getBodyInputPosition,
  getBottomProfileButtonPosition,
  getConfirmDialogButtonPosition,
  getDoneButtonPosition,
  getGotItButtonPosition,
  getImageSaveButtonPosition,
  getMusicButtonPosition,
  getMuteDialogCancelButtonPosition,
  getNextStepButtonPosition,
  getPublishButtonPosition,
  getSaveDraftButtonPosition,
  getTitleInputPosition,
  getArticleBodyInputPosition,
  getArticleTitleInputPosition,
  getCancelButtonPosition,
  getFormatButtonPosition,
  getPreviewNextStepButtonPosition,
  getTextEditInputPosition,
  getTextNextStepButtonPosition,
  getTextNoteInputPosition,
  getTryItButtonPosition,
  getWriteArticleButtonPosition,
}

/**
 * 小红书自定义动作。
 *
 * 图里写 `{ "kind": "custom", "name": "pickImages" }`，执行时查这张表。
 */
export const XHS_ACTIONS = {
  /** 准备环境：输入法 + yadb + 归位。 */
  async prepareEnvironment(ctx: StepContext): Promise<void> {
    await ctx.device.ensureIme(ctx.serial).catch(() => undefined)
    if (!ctx.yadbPath) throw new Error('未配置 yadb 路径（MYT_YADB_PATH）')
    await ctx.device.ensureYadb(ctx.serial, ctx.yadbPath)
    await ctx.device.openUri(ctx.serial, DEEPLINK_HOME, XHS_PACKAGE)
    await sleepRandom(ctx, 2, 3)
  },

  /** 上传图片到相册（倒序，避免相册按时间排序错乱）。 */
  async uploadImages(ctx: StepContext): Promise<void> {
    const paths = listParam(ctx.flowParams['imagePaths'])
    for (const localPath of [...paths].reverse()) {
      await ctx.device.pushToGallery(ctx.serial, localPath)
    }
    await sleepRandom(ctx, 0.5, 1.5)
  },

  /** 打开发布页并等相册就绪。 */
  async waitGallery(ctx: StepContext): Promise<void> {
    await ctx.device.openUri(ctx.serial, DEEPLINK_PROFILE, XHS_PACKAGE)
    await sleepRandom(ctx, 2, 3)
    await ctx.device.openUri(ctx.serial, 'xhsdiscover://post_note/', XHS_PACKAGE)
    await sleepRandom(ctx, 2, 3)
  },

  /** 选图：算坐标列表 → 逐个点击 → 不够就滚动补选。 */
  async pickImages(ctx: StepContext): Promise<void> {
    const targetCount = listParam(ctx.flowParams['imagePaths']).length
    if (targetCount === 0) return

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
        if (totalSelected < targetCount) await scrollAlbumPage(ctx)
      } else {
        emptyScrolls += 1
        await scrollAlbumPage(ctx)
      }
    }
    if (totalSelected < targetCount) {
      throw new Error(`选图不足：${totalSelected}/${targetCount}`)
    }
  },

  /** 保存或发布。 */
  async submitNote(ctx: StepContext): Promise<void> {
    const mode = ctx.flowParams['fbMode'] === 'publish' ? 'publish' : 'save'
    await submitNote(ctx, mode)
  },

  /** 校验发布结果（回主页刷新，判断有没有笔记）。 */
  async verifyPublished(ctx: StepContext): Promise<void> {
    if (!(await verifyPublished(ctx))) throw new Error('未找到草稿或笔记')
  },

  /** 打开写想法页（文字/长文笔记入口）。 */
  async openThoughtPage(ctx: StepContext): Promise<void> {
    await ctx.device.openUri(
      ctx.serial,
      'xhsdiscover://post_new_note?page={"page_type":"now_portal_home_page"}',
      XHS_PACKAGE,
    )
  },

  /** 长文页没有「下一步」：收起键盘 → 点返回 → 弹窗选「存草稿」。 */
  async saveArticleDraft(ctx: StepContext): Promise<void> {
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
      const back = findButtonByText(snapshot.root, ['返回', '不保存返回'])
      if (back) await tapHuman(ctx, back)
      await sleepRandom(ctx, 1, 1.5)
    }
    throw new Error('长文页未出现「存草稿」弹窗')
  },

  /** 下拉刷新（图里可用 swipe 表达，这里留一个具名动作备用）。 */
  async pullToRefresh(ctx: StepContext): Promise<void> {
    await pullToRefresh(ctx)
  },
}

/** 小红书自定义测量器。 */
export const XHS_MEASURES = {
  /** 已选图片数。 */
  async selectedImageCount(ctx: StepContext): Promise<number> {
    const snapshot = await ctx.snapshot({ refresh: true })
    return getAllImagePositions(snapshot.root).filter((image: { selected: boolean }) => image.selected).length
  },
}

/** 小红书自定义校验。 */
export const XHS_VERIFIERS = {
  /** 图库里是否已出现「下一步(N)」按钮。 */
  async galleryNextVisible(ctx: StepContext): Promise<boolean> {
    const snapshot = await ctx.snapshot({ refresh: true })
    return findButtonByText(snapshot.root, ['下一步']) !== null
  },
}

/** 构造某张图的运行时依赖。 */
export function xhsRuntime(graph: FlowGraph): GraphRuntime {
  return {
    pages: new PageRegistry().register(graph.data.app.pages),
    locators: XHS_LOCATORS,
    actions: XHS_ACTIONS,
    verifiers: XHS_VERIFIERS,
    measures: XHS_MEASURES,
  }
}

/** 执行一张小红书流程图。 */
export async function runXhsGraph(ctx: StepContext, graph: FlowGraph) {
  return runGraph(ctx, graph, xhsRuntime(graph))
}

/** 把逗号分隔的参数拆成列表。 */
function listParam(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}
