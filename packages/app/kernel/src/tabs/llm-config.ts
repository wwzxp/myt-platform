import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * 大模型配置与安全验证识图（**1:1 移植**自 auto_login / check_safety_verification）。
 *
 * 用途只有一个：小红书安全验证页的 6 宫格识别。
 * 字段与默认值来自 `auth_client.py:28-29` 与 `check_safety_verification.py`。
 */

/** 默认值（auth_client.py:28-29）。 */
export const DEFAULT_LLM_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
export const DEFAULT_LLM_MODEL = 'doubao-seed-1-8-251228'

export interface LlmConfig {
  baseUrl: string
  model: string
  apiKey: string
}

const EMPTY: LlmConfig = {
  baseUrl: DEFAULT_LLM_BASE_URL,
  model: DEFAULT_LLM_MODEL,
  apiKey: '',
}

/** 读配置；文件不存在或损坏时返回默认值（旧实现同样容错）。 */
export async function loadLlmConfig(configFile: string): Promise<LlmConfig> {
  try {
    const parsed = JSON.parse(await readFile(configFile, 'utf8')) as Record<string, unknown>
    return {
      baseUrl: String(parsed['baseUrl'] ?? EMPTY.baseUrl) || EMPTY.baseUrl,
      model: String(parsed['model'] ?? EMPTY.model) || EMPTY.model,
      apiKey: String(parsed['apiKey'] ?? ''),
    }
  } catch {
    return { ...EMPTY }
  }
}

/**
 * 写配置（原子替换）。
 *
 * 注意：`apiKey` 为空字符串表示「明确清空」，`undefined` 表示「保持不变」——
 * 与旧 `save_llm_config` 一致（旧实现是整份覆盖，前端留空即不改）。
 */
/**
 * 部分更新配置。
 *
 * 每个字段都显式允许 `undefined`：调用方常用「未提供就保持原值」的语义，
 * 在 `exactOptionalPropertyTypes` 下 `Partial<T>` 不接受显式 undefined。
 */
export interface LlmConfigPatch {
  baseUrl?: string | undefined
  model?: string | undefined
  apiKey?: string | undefined
}

export async function saveLlmConfig(
  configFile: string,
  config: LlmConfigPatch,
): Promise<LlmConfig> {
  const current = await loadLlmConfig(configFile)
  const next: LlmConfig = {
    baseUrl: (config.baseUrl ?? current.baseUrl).trim() || DEFAULT_LLM_BASE_URL,
    model: (config.model ?? current.model).trim() || DEFAULT_LLM_MODEL,
    apiKey: config.apiKey === undefined ? current.apiKey : config.apiKey.trim(),
  }
  await mkdir(dirname(configFile), { recursive: true })
  const tmp = `${configFile}.tmp`
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
  await rename(tmp, configFile)
  return next
}

/**
 * 从模型回复里提取数字（`extract_answer_digits`）。
 *
 * 旧实现先尝试 JSON（`answer`/`selected`/`result`/`indexes`/`indices`），
 * 失败则剥离所有非数字字符。必须逐条一致，否则识图结果会被误判。
 */
export function extractAnswerDigits(text: string): string {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return ''

  let payload: unknown = null
  try {
    payload = JSON.parse(trimmed)
  } catch {
    payload = null
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    for (const key of ['answer', 'selected', 'result', 'indexes', 'indices']) {
      const value = record[key]
      if (Array.isArray(value)) {
        const digits = value
          .map((item) => String(item))
          .filter((item) => /^\d+$/.test(item))
          .join('')
        if (digits) return digits
      }
      if (typeof value === 'string') {
        const digits = value.replace(/\D+/g, '')
        if (digits) return digits
      }
    }
  }
  return trimmed.replace(/\D+/g, '')
}

/** 识图提示词（`solve_captcha` 原文）。 */
const SAFETY_PROMPT =
  '这是小红书安全验证截图。' +
  '图片按 2 行 3 列排列，第一行从左到右编号为 1、2、3，第二行从左到右编号为 4、5、6。' +
  '先准确读取题目文字，再判断最符合题意的 2 张图片。' +
  '你必须只返回 JSON，格式严格为 {"answer":"16"}。' +
  'answer 字段中只能放升序编号，不能有空格、逗号、解释或其他文本。'

/**
 * 安全验证识图：返回两位数（如 `16`）。
 *
 * 与旧实现一致：`temperature=0.1`、OpenAI 兼容 `/chat/completions`、
 * 单图 + 文本；解析失败抛错（旧实现同样抛）。
 */
export async function solveSafetyVerification(
  config: LlmConfig,
  image: Buffer,
  options: { timeoutMs?: number; logger?: (line: string) => void } = {},
): Promise<number> {
  if (!config.apiKey) throw new Error('未配置大模型 API 秘钥（上号器 → 大模型配置）')

  const dataUrl = `data:image/png;base64,${image.toString('base64')}`
  const log = options.logger ?? (() => {})
  log(`solve_captcha base_url=${config.baseUrl} model=${config.model} len=${dataUrl.length}`)

  const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: SAFETY_PROMPT },
            { type: 'image_url', image_url: dataUrl },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 40_000),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    log(`识图失败 HTTP ${response.status} ${body.slice(0, 200)}`)
    throw new Error(`识图请求失败：HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = payload.choices?.[0]?.message?.content ?? ''
  const digits = extractAnswerDigits(text)
  log(`识图原文=${JSON.stringify(text).slice(0, 160)} 解析=${digits}`)

  if (digits.length < 2) throw new Error(`识图结果无法解析：${text.slice(0, 80)}`)
  const answer = Number(digits.slice(0, 2))
  if (!Number.isInteger(answer) || answer < 11 || answer > 66) {
    throw new Error(`识图结果超出范围：${answer}`)
  }
  return answer
}
