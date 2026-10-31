import { Service } from '@deepseek-ai/cordis'

/**
 * 本地模型能力接缝。
 *
 * 定位（`ui-locate`）与状态判定（发布流程的校验步骤）都只依赖这个接口：
 * 传入提示词，拿回模型的文本输出。模型的具体形态（Ollama / vLLM / 远端）
 * 由 Provider 决定，流程层不感知。
 *
 * 设计依据（见 `docs/spec/local-model-ui-locate.md`）：
 * - 只要求序号/短 JSON，不要让模型做位置推理
 * - 输出必须能被 `parseLocateIndex` 之类的解析器消费
 */
export abstract class ModelControl extends Service {
  constructor(ctx: ConstructorParameters<typeof Service>[0]) {
    super(ctx, 'modelControl')
  }

  /**
   * 发送一次请求并返回模型原始输出。
   *
   * Provider 负责超时、重试与错误包装；失败必须抛错，不允许返回空串冒充成功。
   */
  abstract complete(prompt: string, options?: CompleteOptions): Promise<string>
}

/** 单次调用的可选参数。 */
export interface CompleteOptions {
  /** 期望输出是 JSON 对象（Provider 应据此设置 response_format）。 */
  json?: boolean
  /** 覆盖默认输出上限。 */
  maxTokens?: number
  /** 覆盖默认温度。 */
  temperature?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    modelControl: ModelControl
  }
}
