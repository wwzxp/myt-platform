/**
 * 定位提示词的行为测试。
 *
 * 断言的是实测中真正影响成功率的几条契约（见 `docs/spec/llm-ui-locate-experiment.md`）：
 * 1. fewshot 必须包含「不可点文字 → 选可点父节点」这条规则（实测最大坑）
 * 2. 提示词只要求 index + 坐标，不允许同时要 text（1.7B 会崩到 35%）
 * 3. 解析要容忍模型加解释文字
 */

import { describe, expect, it } from 'vitest'
import { buildLocatePrompt, parseLocateAnswer } from './ui-locate-prompt.ts'
import type { CompactNode } from './ui-compact.ts'

/** 造一个紧凑节点。 */
function n(overrides: Partial<CompactNode> & { index: number }): CompactNode {
  return {
    className: 'Button',
    text: '',
    desc: '',
    clickable: true,
    x: 0,
    y: 0,
    bounds: [0, 0, 10, 10],
    ...overrides,
  }
}

describe('buildLocatePrompt', () => {
  const nodes = [
    n({ index: 1, text: '手机号登录', clickable: false, x: 360, y: 166 }),
    n({ index: 2, text: '138 0013 8000', className: 'EditText', x: 389, y: 325 }),
  ]
  const screen = { width: 720, height: 1280 }

  it('包含节点列表与目标意图', () => {
    const p = buildLocatePrompt(nodes, '点击手机号输入框', screen)
    expect(p).toContain('[1]')
    expect(p).toContain('[2]')
    expect(p).toContain('目标：点击手机号输入框')
  })

  it('每行带序号、可点性与中心坐标', () => {
    // 用 plain 变体，避免 fewshot 示例里的同名行干扰断言
    const p = buildLocatePrompt(nodes, 'x', screen, 'plain')
    const lines = p.split('\n')
    expect(lines).toContain('[1] Button | text="手机号登录" | 不可点 | 中心=(360,166)')
    expect(lines).toContain('[2] EditText | text="138 0013 8000" | 可点击 | 中心=(389,325)')
  })

  it('fewshot 变体包含事件冒泡规则（实测最大的坑）', () => {
    const p = buildLocatePrompt(nodes, 'x', screen, 'fewshot')
    expect(p).toContain('被可点节点包住时，选可点的那个')
  })

  it('plain 变体不含示例，节省 token', () => {
    const plain = buildLocatePrompt(nodes, 'x', screen, 'plain')
    const fewshot = buildLocatePrompt(nodes, 'x', screen, 'fewshot')
    expect(plain).not.toContain('示例1')
    expect(fewshot.length).toBeGreaterThan(plain.length)
  })

  it('输出契约只要求序号（实测：多要 reason/坐标会让小模型 JSON 合法率掉到 0）', () => {
    const p = buildLocatePrompt(nodes, 'x', screen)
    const contract = p.slice(p.indexOf('只输出序号'))
    expect(contract).toContain('"index":N')
    // 不允许出现 reason，否则 1B 模型会退化成写自由文本
    expect(contract).not.toContain('reason')
    expect(contract).not.toContain('"x"')
  })

  it('节点行标注可点性（供模型判断，而非靠额外指令）', () => {
    const p = buildLocatePrompt(nodes, 'x', screen, 'plain')
    expect(p).toContain('不可点')
    expect(p).toContain('可点击')
  })
})

describe('parseLocateAnswer', () => {
  it('解析纯 JSON', () => {
    expect(parseLocateAnswer('{"index":2,"x":389,"y":325}')).toEqual({ index: 2, x: 389, y: 325 })
  })

  it('容忍前后解释文字', () => {
    const raw = '好的，答案是：\n{"index":2,"x":389,"y":325,"reason":"输入框"}\n以上。'
    expect(parseLocateAnswer(raw)?.index).toBe(2)
  })

  it('容忍 markdown 代码块', () => {
    expect(parseLocateAnswer('```json\n{"index":1,"x":84,"y":94}\n```')?.index).toBe(1)
  })

  it('缺少坐标与序号时返回 null', () => {
    expect(parseLocateAnswer('{"reason":"不知道"}')).toBeNull()
  })

  it('无 JSON 时返回 null', () => {
    expect(parseLocateAnswer('我无法确定')).toBeNull()
  })

  it('JSON 语法错误时返回 null', () => {
    expect(parseLocateAnswer('{"index":2,}')).toBeNull()
  })
})
