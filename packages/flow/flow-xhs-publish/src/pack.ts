/**
 * 小红书**发布**业务包（`FlowPack` 实现）。
 *
 * 与上号包 `@myt/flow-xhs` 完全解耦：只依赖 `@myt/device` 这一层基础能力，
 * 删掉任一包都不影响另一个。
 *
 * 三个流程：
 * - `xhs.publish.image`   图文笔记（`fb_image`）
 * - `xhs.publish.text`    文字笔记（`fb_wz`）
 * - `xhs.publish.article` 长文笔记（`fb_long_wz`）
 */

import type { FlowPack, FlowPackCapabilities, FlowRegistry } from '@myt/flow'
import { createPublishArticleFlow } from './flows/publish-article\.ts'
import { createPublishImageFlow } from './flows/publish-image\.ts'
import { createPublishTextFlow } from './flows/publish-text\.ts'

/** 从 params 取字符串。 */
function text(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** 从 params 取逗号分隔的列表。 */
function list(params: Record<string, unknown>, key: string): string[] {
  const value = params[key]
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value !== 'string') return []
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/** 从 params 取布尔。 */
function bool(params: Record<string, unknown>, key: string): boolean {
  const value = params[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return /^(true|1|是|yes)$/i.test(value.trim())
  return false
}

/** 发布模式：默认存草稿（与旧实现 `fb_mode` 默认值一致）。 */
function fbMode(params: Record<string, unknown>): 'save' | 'publish' {
  return text(params, 'fbMode') === 'publish' ? 'publish' : 'save'
}

/**
 * 注册发布流程。
 *
 * 三个流程都用**工厂**注册：内容（标题/正文/话题/图片）来自模板行，
 * 每个运行实例的参数不同，不能注册成静态流程。
 */
function registerPublishFlows(flows: FlowRegistry): void {
  flows.registerFactory('xhs.publish.image', { title: '发布图文笔记' }, (params) =>
    createPublishImageFlow({
      title: text(params, 'title'),
      body: text(params, 'body'),
      topics: list(params, 'topics'),
      imagePaths: list(params, 'imagePaths'),
      musicImg: bool(params, 'musicImg'),
      fbMode: fbMode(params),
    }),
  )

  flows.registerFactory('xhs.publish.text', { title: '发布文字笔记' }, (params) =>
    createPublishTextFlow({
      title: text(params, 'title'),
      body: text(params, 'body'),
      topics: list(params, 'topics'),
      textContent: text(params, 'textContent'),
      fbMode: fbMode(params),
    }),
  )

  flows.registerFactory('xhs.publish.article', { title: '发布长文笔记' }, (params) =>
    createPublishArticleFlow({
      title: text(params, 'title'),
      body: text(params, 'body'),
      topics: list(params, 'topics'),
      fbMode: fbMode(params),
    }),
  )
}

/** 小红书发布包。 */
export const xhsPublishPack: FlowPack = {
  id: 'xhs-publish',
  title: '小红书发布',
  register(flows: FlowRegistry, _capabilities: FlowPackCapabilities): void {
    registerPublishFlows(flows)
  },
}

export default xhsPublishPack
