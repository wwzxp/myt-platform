/**
 * `ui-compact` 的行为测试。
 *
 * 数据来自真实抓取（`data/yadb-layout.xml` / `data/dump-setting.xml`），
 * 断言的是「LLM 定位」这条链路最容易出错的三处契约：
 *
 * 1. 只有可点/有文字/有 desc 的节点进入候选集（决定 token 量）
 * 2. 坐标必须能命中真实节点（防幻觉的最后一道闸）
 * 3. 命中判定要按 Android 事件冒泡处理（TextView → 可点父节点）
 */

import { describe, expect, it } from 'vitest'
import { collectCandidates, compactNodes, hitTest, renderCompact, type RawUiNode } from './ui-compact.ts'

/** 构造一个最小节点。 */
function node(
  overrides: Partial<RawUiNode> & { bounds: [number, number, number, number] },
): RawUiNode {
  return {
    className: 'android.widget.TextView',
    text: '',
    contentDesc: '',
    clickable: false,
    ...overrides,
  }
}

describe('compactNodes', () => {
  it('只保留可点、有文字或有 desc 的节点', () => {
    const root = node({
      bounds: [0, 0, 720, 1280],
      children: [
        node({ bounds: [0, 0, 10, 10] }), // 无意义容器
        node({ bounds: [1, 1, 2, 2], clickable: true }),
        node({ bounds: [3, 3, 4, 4], text: '有字' }),
        node({ bounds: [5, 5, 6, 6], contentDesc: '有desc' }),
      ],
    })
    const nodes = compactNodes(root)
    // 根节点自身无意义 → 被排除；三个子节点入选
    expect(nodes).toHaveLength(3)
    expect(nodes.map((n) => n.index)).toEqual([1, 2, 3])
  })

  it('类名去掉包名前缀', () => {
    const root = node({
      bounds: [0, 0, 10, 10],
      className: 'android.widget.EditText',
      text: 'x',
    })
    expect(compactNodes(root)[0]?.className).toBe('EditText')
  })

  it('中心坐标由 bounds 计算', () => {
    const root = node({ bounds: [100, 200, 300, 400], clickable: true })
    const [n] = compactNodes(root)
    expect(n?.x).toBe(200)
    expect(n?.y).toBe(300)
  })

  it('保留完整 bounds 供校验', () => {
    const root = node({ bounds: [1, 2, 3, 4], clickable: true })
    expect(compactNodes(root)[0]?.bounds).toEqual([1, 2, 3, 4])
  })
})

describe('collectCandidates', () => {
  it('深度优先且保持视觉顺序', () => {
    const root = node({
      bounds: [0, 0, 100, 100],
      children: [
        node({ bounds: [0, 0, 50, 50], text: 'first' }),
        node({
          bounds: [50, 0, 100, 50],
          children: [node({ bounds: [50, 0, 100, 25], text: 'nested' })],
        }),
        node({ bounds: [0, 50, 100, 100], text: 'last' }),
      ],
    })
    // 根节点 bounds 非零但无文字/不可点 → 不入选
    expect(collectCandidates(root).map((n) => n.text)).toEqual(['first', 'nested', 'last'])
  })
})

describe('hitTest', () => {
  const nodes = compactNodes(
    node({
      bounds: [0, 0, 720, 1280],
      children: [
        // 不可点的文字，被可点按钮完全包住（真实登录页的「验证并登录」）
        node({
          bounds: [96, 462, 624, 542],
          clickable: true,
          className: 'android.widget.Button',
          children: [node({ bounds: [270, 481, 450, 522], text: '验证并登录' })],
        }),
      ],
    }),
  )

  it('坐标落在可点节点内时返回该节点', () => {
    const hit = hitTest(nodes, 360, 502)
    expect(hit?.className).toBe('Button')
  })

  it('落在不可点的子文字上，仍返回可点的父节点（事件冒泡）', () => {
    // 该点同时落在 Button 与内部 TextView 内；Android 会把点击冒泡到 Button
    const hit = hitTest(nodes, 360, 502)
    expect(hit?.clickable).toBe(true)
  })

  it('坐标在树外返回 null', () => {
    expect(hitTest(nodes, 5000, 5000)).toBeNull()
  })

  it('多个可点节点重叠时取面积最小的那个（更精确）', () => {
    const overlap = compactNodes(
      node({
        bounds: [0, 0, 100, 100],
        children: [
          node({ bounds: [0, 0, 100, 100], clickable: true }),
          node({ bounds: [10, 10, 30, 30], clickable: true }),
        ],
      }),
    )
    const hit = hitTest(overlap, 20, 20)
    expect(hit?.bounds).toEqual([10, 10, 30, 30])
  })
})

describe('renderCompact', () => {
  it('输出包含屏幕尺寸、节点数与每行的中心坐标', () => {
    const nodes = compactNodes(node({ bounds: [100, 200, 300, 400], clickable: true, text: '登录' }))
    const text = renderCompact(nodes, { width: 720, height: 1280 })
    expect(text).toContain('720x1280')
    expect(text).toContain('共 1 个候选节点')
    expect(text).toContain('text="登录"')
    expect(text).toContain('中心=(200,300)')
    expect(text).toContain('可点击')
  })

  it('无文字节点不输出空的 text/desc 字段', () => {
    const nodes = compactNodes(node({ bounds: [0, 0, 10, 10], clickable: true }))
    const text = renderCompact(nodes, { width: 720, height: 1280 })
    expect(text).not.toContain('text=""')
    expect(text).not.toContain('desc=""')
  })
})
