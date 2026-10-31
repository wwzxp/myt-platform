import type { Context } from '@deepseek-ai/cordis'
import { ModelControl, type CompleteOptions } from '@myt/model'

/**
 * OpenAI 兼容接口的模型 Provider（Ollama / vLLM / 任意 `/v1/chat/completions`）。
 *
 * 默认指向本机 Ollama 的 minicpm46——这是实测选出的定位模型
 * （见 `docs/spec/local-model-ui-locate.md`）。
 */
export interface OpenAiModelConfig {
  /** 接口地址，默认 `http://127.0.0.1:11434/v1/chat/completions`。 */
  baseUrl?: string
  /** 模型名，默认 `minicpm46`。 */
  model?: string
  /** 单次超时（毫秒），默认 30 秒。 */
  timeoutMs?: number
  /** 鉴权头（远端服务需要时）。 */
  apiKey?: string
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1/chat/completions'
const DEFAULT_MODEL = 'minicpm46'

/** OpenAI 兼容 Provider。 */
export class OpenAiModelControl extends ModelControl {
  private readonly baseUrl: string
  private readonly modelName: string
  private readonly timeoutMs: number
  private readonly apiKey?: string

  constructor(ctx: Context, config: OpenAiModelConfig = {}) {
    super(ctx)
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
    this.modelName = config.model ?? DEFAULT_MODEL
    this.timeoutMs = config.timeoutMs ?? 30_000
    this.apiKey = config.apiKey
  }

  async complete(prompt: string, options: CompleteOptions = {}): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.modelName,
      messages: [{ role: 'user', content: prompt }],
      // 定位任务要确定性输出，温度固定为 0。
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens ?? 64,
      // Ollama 扩展：跳过思考过程（minicpm46 不加会拖长耗时）。
      reasoning_effort: 'none',
    }
    if (options.json) body.response_format = { type: 'json_object' }

    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      throw new Error(`模型请求失败：HTTP ${response.status} ${await response.text()}`)
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new Error(`模型响应缺少 choices[0].message.content：${JSON.stringify(data).slice(0, 200)}`)
    }
    return content.trim()
  }
}

/** 注册到 Context（与其它 Provider 一致：构造即注册）。 */
export function installOpenAiModel(ctx: Context, config: OpenAiModelConfig = {}): OpenAiModelControl {
  return new OpenAiModelControl(ctx, config)
}
