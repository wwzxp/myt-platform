import { describe, expect, it } from 'vitest'

import { buildAlignPrompt, parseAlignTable, translateTerms } from './keyword-align.ts'
import { assessCollection, collectKeywords } from './keyword-collect.ts'
import { PageRegistry, currentPage } from './page-guard.ts'
import { OCR_PROMPT, parseOcrText } from './screen-ocr.ts'

/**
 * 页面识别配套组件的测试。
 *
 * 只测外部行为（给定输入得到什么输出），不测内部实现细节——
 * 这些都是纯函数，重构时不该让测试碎掉。
 */

describe('关键词权重判定', () => {
  const pages = () => new PageRegistry().register([
    { id: 'album', markers: [], keywords: ['实况图', '全屏图', '草稿箱'] },
    { id: 'review', markers: [], keywords: ['一键成片', '下一步'] },
    { id: 'image-editor', markers: [], keywords: ['滤镜', '贴纸', '拼图'] },
  ])

  it('两个以上独有词命中才判', () => {
    expect(pages().resolveByKeywords(['全部', '实况图', '全屏图'])).toBe('album')
  })

  it('单个 2 字词不够——防止撞正文', () => {
    // 「随便什么文字」这类正文会含「文字」，单个命中不可信
    expect(pages().resolveByKeywords(['滤镜'])).toBe('unknown')
  })

  it('一个 3 字词可以单独成立', () => {
    expect(pages().resolveByKeywords(['一键成片'])).toBe('review')
  })

  it('两个页面同分时返回 unknown', () => {
    const tied = new PageRegistry().register([
      { id: 'a', markers: [], keywords: ['实况图'] },
      { id: 'b', markers: [], keywords: ['全屏图'] },
    ])
    expect(tied.resolveByKeywords(['实况图', '全屏图'])).toBe('unknown')
  })

  it('关键词必须占该条文字一半以上，长正文里的词不算', () => {
    expect(pages().resolveByKeywords(['随便什么滤镜都没关系的一段文案'])).toBe('unknown')
  })

  it('带后缀的标签仍能命中', () => {
    expect(pages().resolveByKeywords(['实况图（3）', '全屏图'])).toBe('album')
  })
})


describe('currentPage 整合路径', () => {
  const pages = () => new PageRegistry().register([
    { id: 'album', markers: ['AlbumActivity'], keywords: ['实况图', '全屏图', '草稿箱'] },
    { id: 'home', markers: ['IndexActivity'], keywords: ['关注', '发现', '同城'] },
  ])

  /** 造最小 ctx：只实现 currentPage 用到的部分。 */
  const ctxOf = (activity: string, texts: string[]) => ({
    serial: 'fake',
    deviceId: 'fake',
    runId: 'r',
    device: {
      screenshot: async () => Buffer.from('x'),
      // Activity 来自 `dumpsys window`，这里给一行符合正则的输出。
      shell: async () => `mCurrentFocus=Window{abc u0 ${activity}}`,
    },
    async snapshot() {
      return { root: { children: texts.map((t) => ({ text: t, children: [] })) } }
    },
  })

  it('Activity 命中时直接用，不看文字', async () => {
    const ctx = ctxOf('com.x/AlbumActivity', [])
    expect(await currentPage(ctx as never, pages())).toBe('album')
  })

  it('Activity 认不出时按中文关键词判定', async () => {
    const ctx = ctxOf('com.x/UnknownActivity', ['实况图', '全屏图', '草稿箱'])
    expect(await currentPage(ctx as never, pages())).toBe('album')
  })

  it('英文界面经对齐表翻译后判定', async () => {
    const ctx = ctxOf('com.x/UnknownActivity', ['Live Photos', 'Panoramas', 'Drafts'])
    const align = { 'live photos': '实况图', panoramas: '全屏图', drafts: '草稿箱' }
    expect(await currentPage(ctx as never, pages(), { align })).toBe('album')
  })

  it('没有对齐表时英文界面判不出', async () => {
    const ctx = ctxOf('com.x/UnknownActivity', ['Live Photos', 'Panoramas', 'Drafts'])
    expect(await currentPage(ctx as never, pages())).toBe('unknown')
  })

})


describe('属性匹配（通用，不绑定具体 App）', () => {
  const pages = () => new PageRegistry().register([
    {
      id: 'home-explore',
      markers: [],
      attributes: [{ class: '~ActionBar$Tab', selected: 'true', 'content-desc': '发现' }],
    },
    {
      id: 'home-recommend',
      markers: [],
      attributes: [{ class: '~ActionBar$Tab', selected: 'true', 'content-desc': '推荐' }],
    },
    {
      id: 'album',
      markers: [],
      // resource-id 在混淆过的 App 上不可用，但这只是「使用者可选」的指纹
      attributes: [{ 'resource-id': 'com.example:id/album_grid' }],
    },
  ])

  const tab = (desc: string, selected: boolean): Record<string, string> => ({
    class: 'androidx.appcompat.app.ActionBar$Tab',
    selected: selected ? 'true' : 'false',
    'content-desc': desc,
    text: '',
  })

  it('按标准控件类 + 选中态判定', () => {
    expect(pages().resolveByAttributes([tab('推荐', false), tab('发现', true)])).toBe('home-explore')
  })

  it('未选中的 tab 不命中', () => {
    expect(pages().resolveByAttributes([tab('推荐', false), tab('发现', false)])).toBe('unknown')
  })

  it('resource-id 精确匹配', () => {
    expect(pages().resolveByAttributes([{ 'resource-id': 'com.example:id/album_grid' }])).toBe('album')
  })

  it('值以 ~ 开头表示包含', () => {
    const reg = new PageRegistry().register([
      { id: 'p', markers: [], attributes: [{ 'resource-id': '~album' }] },
    ])
    expect(reg.resolveByAttributes([{ 'resource-id': 'com.example:id/album_grid' }])).toBe('p')
  })

  it('条件越多越具体，压过宽条件', () => {
    const reg = new PageRegistry().register([
      { id: 'any-tab', markers: [], attributes: [{ class: '~Tab', selected: 'true' }] },
      { id: 'specific', markers: [], attributes: [{ class: '~Tab', selected: 'true', 'content-desc': '发现' }] },
    ])
    expect(reg.resolveByAttributes([tab('发现', true)])).toBe('specific')
  })

  it('没有属性条件时返回 unknown', () => {
    expect(pages().resolveByAttributes([{ text: '随便' }])).toBe('unknown')
  })
})

describe('关键词自动采集', () => {
  it('只保留多次采样都出现的词', () => {
    const result = collectKeywords([
      { pageId: 'p', texts: ['滤镜', '贴纸', '今天天气不错'] },
      { pageId: 'p', texts: ['滤镜', '贴纸', '另一条文案'] },
      { pageId: 'p', texts: ['滤镜', '贴纸', '第三条内容'] },
    ])
    expect(result['p']).toEqual(['滤镜', '贴纸'])
  })

  it('跨页出现的词被剔除', () => {
    const result = collectKeywords([
      { pageId: 'a', texts: ['首页', '关注'] },
      { pageId: 'a', texts: ['首页', '关注'] },
      { pageId: 'b', texts: ['首页', '市集'] },
      { pageId: 'b', texts: ['首页', '市集'] },
    ])
    expect(result['a']).toEqual(['关注'])
    expect(result['b']).toEqual(['市集'])
  })

  it('纯数字与时间不算界面特征', () => {
    const result = collectKeywords([
      { pageId: 'p', texts: ['16:30', '20', '滤镜'] },
      { pageId: 'p', texts: ['16:30', '20', '滤镜'] },
    ])
    expect(result['p']).toEqual(['滤镜'])
  })

  it('词太少时给出提示', () => {
    expect(assessCollection([]).ok).toBe(false)
    expect(assessCollection(['滤镜']).ok).toBe(false)
    expect(assessCollection(['滤镜', '贴纸']).ok).toBe(true)
  })
})

describe('跨语言对齐', () => {
  it('解析「英文=中文」并忽略「无」', () => {
    const table = parseAlignTable('Filters=滤镜\nNext=下一步\nUnknown=无')
    expect(table['filters']).toBe('滤镜')
    expect(table['next']).toBe('下一步')
    expect(table['unknown']).toBeUndefined()
  })

  it('容错全角冒号与项目符号', () => {
    const table = parseAlignTable('- Crop：裁切\n• Stickers: 贴纸')
    expect(table['crop']).toBe('裁切')
    expect(table['stickers']).toBe('贴纸')
  })

  it('查表翻译界面词', () => {
    const table = { filters: '滤镜', next: '下一步' }
    expect(translateTerms(['Filters', 'Next', 'Nobody'], table)).toEqual(['滤镜', '下一步'])
  })

  it('提示词约束「只能从词表选」', () => {
    const prompt = buildAlignPrompt(['Filters'], ['滤镜', '贴纸'])
    expect(prompt).toContain('只能从这里选')
    expect(prompt).toContain('无')
  })
})

describe('截图读字解析', () => {
  it('剥掉编号、项目符号与 markdown 强调', () => {
    expect(parseOcrText('1. 选择音乐\n- 滤镜\n• 贴纸\n**标记**')).toEqual([
      '选择音乐',
      '滤镜',
      '贴纸',
      '标记',
    ])
  })

  it('丢弃引导语与过长正文', () => {
    const long = '这是一段很长很长的正文内容用来测试过滤逻辑'.repeat(3)
    expect(parseOcrText(`所有可提取文字如下：\n滤镜\n${long}`)).toEqual(['滤镜'])
  })

  it('提示词强调「完整列出」且不要求计数', () => {
    expect(OCR_PROMPT).toContain('完整列出')
    expect(OCR_PROMPT).toContain('不要遗漏')
    expect(OCR_PROMPT).not.toContain('几个')
  })
})


describe('节点级重试', () => {
  const mkNode = (retries: number | undefined) => ({
    id: 'r',
    type: 'mt-action' as const,
    meta: { position: { x: 0, y: 0 } },
    data: {
      title: '重试测试',
      inputsValues: {
        actKind: { type: 'constant', content: 'tapText' },
        actTexts: { type: 'constant', content: '发布笔记' },
        ...(retries === undefined ? {} : { retries: { type: 'constant', content: String(retries) } }),
        retryGap: { type: 'constant', content: '0' },
      },
    },
  })

  const mkCtx = (onSnapshot: () => void) => ({
    serial: 'f',
    deviceId: 'f',
    runId: 'r',
    device: {
      shell: async () => '',
      screenshot: async () => Buffer.alloc(0),
      tapLikeHuman: async () => {},
    },
    async snapshot() {
      onSnapshot()
      // 永远找不到「发布笔记」→ 必然失败，用调用次数衡量重试
      return { root: { bounds: [0, 0, 1080, 1920], children: [] } }
    },
    throwIfCancelled() {},
    flowParams: {},
    random: { next: () => 0.5 },
  })

  it('failure 会按 retries 重跑', async () => {
    const { executeNode } = await import('./graph/run.ts')
    let calls = 0
    const result = await executeNode(
      mkCtx(() => { calls += 1 }) as never,
      mkNode(2) as never,
      { pages: new PageRegistry(), locators: {} } as never,
    )
    expect(calls).toBe(3) // 1 次原始 + 2 次重试
    expect(result.port).toBe('failure')
  })

  it('retries 未填时只跑一次', async () => {
    const { executeNode } = await import('./graph/run.ts')
    let calls = 0
    const result = await executeNode(
      mkCtx(() => { calls += 1 }) as never,
      mkNode(undefined) as never,
      { pages: new PageRegistry(), locators: {} } as never,
    )
    expect(calls).toBe(1)
    expect(result.port).toBe('failure')
  })
})

describe('动作原语：自定义动作已移除', () => {
  it('actKind=custom 不再被执行，走 failure', async () => {
    const { executeNode } = await import('./graph/run.ts')
    const node = {
      id: 'c',
      type: 'mt-action' as const,
      meta: { position: { x: 0, y: 0 } },
      data: {
        title: '自定义',
        inputsValues: {
          actKind: { type: 'constant', content: 'custom' },
          actName: { type: 'constant', content: 'waitGallery' },
        },
      },
    }
    // 目标定位会先失败，但关键是：不会再去找 runtime.actions
    const ctx = {
      serial: 'f', deviceId: 'f', runId: 'r',
      device: { shell: async () => '', screenshot: async () => Buffer.alloc(0) },
      async snapshot() { return { root: { children: [] } } },
      throwIfCancelled() {},
      flowParams: {},
    }
    const result = await executeNode(ctx as never, node as never, {
      pages: new PageRegistry(), locators: {},
    } as never)
    expect(result.port).toBe('failure')
    // 任何失败原因都行，只要不是「执行成功」
    expect(result.reason).toBeTruthy()
  })
})
