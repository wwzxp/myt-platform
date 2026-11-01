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
} from './locators/publish-locators.ts'

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
    // 「选 N 张图」的算法在引擎里；这里只告诉它「哪些是可点的图片格」。
    gallery: (root) =>
      getAllImagePositions(root).map((img) => ({ point: { x: img.x, y: img.y }, selected: img.selected })),
    verifiers: XHS_VERIFIERS,
    measures: XHS_MEASURES,
  }
}

/** 执行一张小红书流程图。 */
export async function runXhsGraph(ctx: StepContext, graph: FlowGraph) {
  return runGraph(ctx, graph, xhsRuntime(graph))
}

