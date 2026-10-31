import type { ModelControl } from '@myt/model'
import type { LocateModel } from './ui-locate.ts'

/**
 * 把 `ModelControl` 适配成定位函数。
 *
 * 定位任务的输出是短 JSON，固定走 json 模式、温度 0、输出上限 64 token。
 * 单独抽出来是为了让业务包只依赖 `@myt/model` 的接口，
 * 不需要知道定位的具体参数。
 *
 * @param model 模型能力（`ctx.modelControl`）
 */
export function createModelLocate(model: ModelControl): LocateModel {
  return (prompt: string) => model.complete(prompt, { json: true, maxTokens: 64, temperature: 0 })
}
