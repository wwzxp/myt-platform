import { describe, expect, it } from 'vitest'
import { PageRegistry } from '../page-guard.ts'
import { runGraph, executeNode, type GraphRuntime } from './run.ts'
import { validateFlowGraph, FlowGraphError } from './load.ts'
import type { FlowEdge, FlowGraph, FlowNode, FlowValue, NodeType } from './types.ts'
import type { StepContext } from '@myt/flow'

/**
 * 图引擎测试：只测外部行为（执行轨迹、选的端口、抛不抛错），
 * 不测内部有没有调用某个函数——重构时测试不该碎。
 */

/** 造一个最小上下文：记录被调用的动作，不碰真机。 */
function fakeCtx(overrides: Partial<StepContext> = {}): StepContext & { calls: string[] } {
  const calls: string[] = []
  const ctx = {
    serial: 'fake',
    deviceId: 'fake',
    runId: 'fake',
    calls,
    device: {
      back: async () => void calls.push('back'),
      swipe: async () => void calls.push('swipe'),
      openUri: async () => void calls.push('openUri'),
      tap: async () => void calls.push('tap'),
      tapLikeHuman: async () => void calls.push('tapLikeHuman'),
      pressKey: async () => void calls.push('pressKey'),
      shell: async () => '',
      dumpUi: async () => ({ serial: 'fake', channel: 'yadb', capturedAt: 0, root: {}, nodeCount: 0 }),
    },
    runs: { stepSucceeded: () => {} },
    random: { next: () => 0.5, int: (a: number) => a },
    humanPolicy: {},
    flowParams: {},
    throwIfCancelled: () => {},
    snapshot: async () => ({ serial: 'fake', channel: 'yadb', capturedAt: 0, root: {} as never, nodeCount: 0 }),
    ...overrides,
  } as unknown as StepContext & { calls: string[] }
  return ctx
}

/** 造一个页面注册表。 */
function pages(): PageRegistry {
  return new PageRegistry().register([
    { id: 'home', markers: ['IndexActivity'] },
    { id: 'editor', markers: ['EditorActivity'] },
  ])
}

/** 造图：给定节点与边，自动补 app / entry / maxSteps。 */
function graph(nodes: FlowNode[], edges: FlowEdge[], entry = 'start'): FlowGraph {
  return {
    id: 'test.flow',
    title: '测试流程',
    nodes,
    edges,
    data: {
      app: {
        packageName: 'com.test',
        homeUri: 'test://home',
        pages: [
          { id: 'home', markers: ['IndexActivity'] },
          { id: 'editor', markers: ['EditorActivity'] },
        ],
        recoveryRules: [],
      },
      maxSteps: 50,
    },
    entry,
  }
}

/** 节点构造。 */
const KIND_TO_TYPE: Record<string, NodeType> = {
  start: 'start',
  action: 'mt-action',
  condition: 'mt-condition',
  loop: 'mt-loop',
  end: 'end',
}

/**
 * 把旧式扁平配置转成新形状的 `inputsValues`。
 *
 * 等价于 `scripts/migrate-workflow-nodes.ts` 的转换。测试关心的是**路由行为**，
 * 不是数据形状——用这个辅助保持用例可读。
 *
 * @param config - 旧式配置（`{ requires, act:{...} }` 等）。
 * @param type - 节点类型，决定字段怎么铺开。
 */
function toInputs(config: Record<string, unknown>, type: NodeType): Record<string, FlowValue> {
  const out: Record<string, FlowValue> = {}
  const put = (key: string, content: unknown): void => {
    if (content === undefined || content === null || content === '') return
    out[key] = { type: 'constant', content }
  }
  if (type === 'mt-action') {
    const act = config['act'] as Record<string, unknown> | undefined
    if (act) for (const [k, v] of Object.entries(act)) put(`act.${k}`, v)
    const locate = config['locate'] as Record<string, unknown> | undefined
    if (locate) for (const [k, v] of Object.entries(locate)) put(`locate.${k}`, v)
    const requires = config['requires']
    if (Array.isArray(requires) && requires.length > 0) put('requires', requires.join(','))
    const settle = config['settle']
    if (Array.isArray(settle)) put('settle', settle.join(','))
    if (config['verify']) out['verify'] = { type: 'constant', content: config['verify'] }
  }
  if (type === 'mt-condition') {
    put('judge.kind', config['kind'])
    put('judge.key', config['key'])
    const expect = config['expect']
    if (Array.isArray(expect)) put('judge.expect', expect.join(','))
  }
  if (type === 'mt-loop' || type === 'loop') {
    const loopFor = config['loopFor'] as Record<string, unknown> | undefined
    put('loopFor.max', loopFor ? loopFor['max'] : config['max'])
  }
  return out
}

function node(
  id: string,
  kind: 'start' | 'action' | 'condition' | 'loop' | 'end',
  config?: Record<string, unknown>,
  blocks?: FlowNode[],
): FlowNode {
  const type = KIND_TO_TYPE[kind]!
  return {
    id,
    type,
    meta: { position: { x: 0, y: 0 } },
    data: { title: id, inputsValues: toInputs(config ?? {}, type) },
    ...(blocks === undefined ? {} : { blocks }),
  }
}

const runtime = (): GraphRuntime => ({ pages: pages(), locators: {} })

describe('runGraph — 端到端路由', () => {
  it('线性图按顺序执行到 end', async () => {
    const g = graph(
      [
        node('start', 'start'),
        node('a', 'action', { requires: [], act: { kind: 'sleep', min: 0, max: 0 } }),
        node('b', 'action', { requires: [], act: { kind: 'sleep', min: 0, max: 0 } }),
        node('end', 'end'),
      ],
      [
        { sourceNodeID: 'start', sourcePortID: 'out', targetNodeID: 'a' },
        { sourceNodeID: 'a', sourcePortID: 'success', targetNodeID: 'b' },
        { sourceNodeID: 'b', sourcePortID: 'success', targetNodeID: 'end' },
      ],
    )
    const outcome = await runGraph(fakeCtx(), g, runtime())
    expect(outcome.ok).toBe(true)
    expect(outcome.trail.map((t) => t.node)).toEqual(['start', 'a', 'b', 'end'])
  })

  it('条件判 true 时只走 true 分支', async () => {
    const g = graph(
      [
        node('start', 'start'),
        node('cond', 'condition', { kind: 'param', key: 'go' }),
        node('yes', 'action', { requires: [], act: { kind: 'sleep', min: 0, max: 0 } }),
        node('no', 'action', { requires: [], act: { kind: 'sleep', min: 0, max: 0 } }),
        node('end', 'end'),
      ],
      [
        { sourceNodeID: 'start', sourcePortID: 'out', targetNodeID: 'cond' },
        { sourceNodeID: 'cond', sourcePortID: 'true', targetNodeID: 'yes' },
        { sourceNodeID: 'cond', sourcePortID: 'false', targetNodeID: 'no' },
        { sourceNodeID: 'yes', sourcePortID: 'success', targetNodeID: 'end' },
        { sourceNodeID: 'no', sourcePortID: 'success', targetNodeID: 'end' },
      ],
    )
    const outcome = await runGraph(fakeCtx({ flowParams: { go: '1' } }), g, runtime())
    expect(outcome.ok).toBe(true)
    expect(outcome.trail.map((t) => t.node)).toEqual(['start', 'cond', 'yes', 'end'])
  })

  it('条件判 false 时只走 false 分支', async () => {
    const g = graph(
      [
        node('start', 'start'),
        node('cond', 'condition', { kind: 'param', key: 'go' }),
        node('yes', 'action', { requires: [], act: { kind: 'sleep', min: 0, max: 0 } }),
        node('no', 'action', { requires: [], act: { kind: 'sleep', min: 0, max: 0 } }),
        node('end', 'end'),
      ],
      [
        { sourceNodeID: 'start', sourcePortID: 'out', targetNodeID: 'cond' },
        { sourceNodeID: 'cond', sourcePortID: 'true', targetNodeID: 'yes' },
        { sourceNodeID: 'cond', sourcePortID: 'false', targetNodeID: 'no' },
        { sourceNodeID: 'yes', sourcePortID: 'success', targetNodeID: 'end' },
        { sourceNodeID: 'no', sourcePortID: 'success', targetNodeID: 'end' },
      ],
    )
    const outcome = await runGraph(fakeCtx({ flowParams: {} }), g, runtime())
    expect(outcome.ok).toBe(true)
    expect(outcome.trail.map((t) => t.node)).toEqual(['start', 'cond', 'no', 'end'])
  })

  it('容器式循环：blocks 跑满 max 轮后走 done', async () => {
    // 循环体放在 loop 节点的 blocks 里（与画布上的容器一致）
    const loopNode = node('loop', 'loop', { loopFor: { max: 3 } })
    loopNode.blocks = [node('body', 'action', { requires: [], act: { kind: 'sleep', min: 0, max: 0 } })]

    const g = graph(
      [node('start', 'start'), loopNode, node('end', 'end')],
      [
        { sourceNodeID: 'start', sourcePortID: 'out', targetNodeID: 'loop' },
        { sourceNodeID: 'loop', sourcePortID: 'done', targetNodeID: 'end' },
      ],
    )
    const outcome = await runGraph(fakeCtx(), g, runtime())
    expect(outcome.ok).toBe(true)
    expect(outcome.trail.filter((t) => t.node === 'body')).toHaveLength(3)
  })

  it('动作失败时走 failure 端口，不走 success', async () => {
    const g = graph(
      [
        node('start', 'start'),
        // 缺少 locate 的动作必然失败
        node('bad', 'action', { requires: [], act: { kind: 'tap' } }),
        node('ok', 'action', { requires: [], act: { kind: 'sleep', min: 0, max: 0 } }),
        node('fail', 'action', { requires: [], act: { kind: 'sleep', min: 0, max: 0 } }),
        node('end', 'end'),
      ],
      [
        { sourceNodeID: 'start', sourcePortID: 'out', targetNodeID: 'bad' },
        { sourceNodeID: 'bad', sourcePortID: 'success', targetNodeID: 'ok' },
        { sourceNodeID: 'bad', sourcePortID: 'failure', targetNodeID: 'fail' },
        { sourceNodeID: 'ok', sourcePortID: 'success', targetNodeID: 'end' },
        { sourceNodeID: 'fail', sourcePortID: 'success', targetNodeID: 'end' },
      ],
    )
    const outcome = await runGraph(fakeCtx(), g, runtime())
    expect(outcome.ok).toBe(true)
    expect(outcome.trail.map((t) => t.node)).toEqual(['start', 'bad', 'fail', 'end'])
  })

  it('到达 end 立即停止', async () => {
    const g = graph(
      [
        node('start', 'start'),
        node('end', 'end'),
        node('after', 'action', { requires: [], act: { kind: 'sleep', min: 0, max: 0 } }),
      ],
      [
        { sourceNodeID: 'start', sourcePortID: 'out', targetNodeID: 'end' },
        { sourceNodeID: 'after', sourcePortID: 'success', targetNodeID: 'end' },
      ],
    )
    const outcome = await runGraph(fakeCtx(), g, runtime())
    expect(outcome.ok).toBe(true)
    expect(outcome.trail.map((t) => t.node)).toEqual(['start', 'end'])
  })

  it('经 failure 端口到 end 时不算成功', async () => {
    const g = graph(
      [
        node('start', 'start'),
        // 缺 locate 的动作必然失败
        node('bad', 'action', { requires: [], act: { kind: 'tap' } }),
        node('end', 'end'),
      ],
      [
        { sourceNodeID: 'start', sourcePortID: 'out', targetNodeID: 'bad' },
        { sourceNodeID: 'bad', sourcePortID: 'failure', targetNodeID: 'end' },
      ],
    )
    const outcome = await runGraph(fakeCtx(), g, runtime())
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toContain('failure')
  })

  it('经 mismatch 端口到 end 时不算成功', async () => {
    const ctx = fakeCtx()
    ;(ctx.device as unknown as { shell: () => Promise<string> }).shell = async () =>
      'mCurrentFocus=Window{1 u0 com.test/com.test.IndexActivity}'
    const g = graph(
      [
        node('start', 'start'),
        node('guarded', 'action', { requires: ['editor'], act: { kind: 'sleep', min: 0, max: 0 } }),
        node('end', 'end'),
      ],
      [
        { sourceNodeID: 'start', sourcePortID: 'out', targetNodeID: 'guarded' },
        { sourceNodeID: 'guarded', sourcePortID: 'mismatch', targetNodeID: 'end' },
      ],
    )
    const outcome = await runGraph(ctx, g, runtime())
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toContain('mismatch')
  })

  it('环形连线超过 maxSteps 时抛错', async () => {
    const g = {
      ...graph(
        [
          node('start', 'start'),
          node('spin', 'action', { requires: [], act: { kind: 'sleep', min: 0, max: 0 } }),
        ],
        [
          { sourceNodeID: 'start', sourcePortID: 'out', targetNodeID: 'spin' },
          { sourceNodeID: 'spin', sourcePortID: 'success', targetNodeID: 'spin' },
        ],
      ),
      maxSteps: 10,
    }
    const outcome = await runGraph(fakeCtx(), g, runtime())
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toContain('最大步数')
  })
})

describe('executeNode — 节点内部', () => {
  it('action 缺配置返回 failure', async () => {
    const result = await executeNode(fakeCtx(), node('a', 'action'), runtime())
    expect(result.port).toBe('failure')
  })

  it('action 页面不符返回 mismatch', async () => {
    const ctx = fakeCtx()
    // 让 currentPage 读到 home（IndexActivity），而 requires 要求 editor
    ;(ctx.device as unknown as { shell: () => Promise<string> }).shell = async () =>
      'mCurrentFocus=Window{1 u0 com.test/com.test.IndexActivity}'
    const result = await executeNode(
      ctx,
      node('a', 'action', { requires: ['editor'], act: { kind: 'sleep', min: 0, max: 0 } }),
      runtime(),
    )
    expect(result.port).toBe('mismatch')
  })

  it('condition/param 参数非空走 true', async () => {
    const result = await executeNode(
      fakeCtx({ flowParams: { title: 'x' } }),
      node('c', 'condition', { kind: 'param', key: 'title' }),
      runtime(),
    )
    expect(result.port).toBe('true')
  })

  it('loop 单节点执行返回 done（容器循环由 runGraph 处理）', async () => {
    const loopNode = node('l', 'loop', { max: 2 })
    expect((await executeNode(fakeCtx(), loopNode, runtime())).port).toBe('done')
  })

  it('start 返回 out', async () => {
    const result = await executeNode(fakeCtx(), node('s', 'start'), runtime())
    expect(result.port).toBe('out')
  })
})

describe('validateFlowGraph — 加载校验', () => {
  const base = {
    id: 'x',
    title: 'x',
    nodes: [
      { id: 's', type: 'start', meta: { position: { x: 0, y: 0 } }, data: { title: 's' } },
      { id: 'e', type: 'end', meta: { position: { x: 1, y: 0 } }, data: { title: 'e' } },
    ],
    edges: [{ sourceNodeID: 's', sourcePortID: 'out', targetNodeID: 'e' }],
    data: {
      app: { packageName: 'p', homeUri: 'u', pages: [{ id: 'home', markers: ['A'] }] },
      maxSteps: 10,
    },
    entry: 's',
  }

  it('合法图通过', () => {
    expect(() => validateFlowGraph(base)).not.toThrow()
  })

  it('缺 end 抛错', () => {
    const bad = { ...base, nodes: [base.nodes[0]], edges: [] }
    expect(() => validateFlowGraph(bad)).toThrow(FlowGraphError)
  })

  it('entry 指向非 start 抛错', () => {
    const bad = { ...base, entry: 'e' }
    expect(() => validateFlowGraph(bad)).toThrow(/entry 必须指向 start/)
  })

  it('边指向不存在的节点抛错', () => {
    const bad = { ...base, edges: [{ sourceNodeID: 's', sourcePortID: 'out', targetNodeID: 'nope' }] }
    expect(() => validateFlowGraph(bad)).toThrow(/不存在的目标节点/)
  })

  it('端口与节点类型不匹配抛错', () => {
    const bad = { ...base, edges: [{ sourceNodeID: 's', sourcePortID: 'success', targetNodeID: 'e' }] }
    expect(() => validateFlowGraph(bad)).toThrow(/没有端口/)
  })

  it('同端口多条边抛错', () => {
    const bad = {
      ...base,
      nodes: [
        ...base.nodes,
        { id: 'e2', type: 'end', meta: { position: { x: 2, y: 0 } }, data: { title: 'e2' } },
      ],
      edges: [
        { sourceNodeID: 's', sourcePortID: 'out', targetNodeID: 'e' },
        { sourceNodeID: 's', sourcePortID: 'out', targetNodeID: 'e2' },
      ],
    }
    expect(() => validateFlowGraph(bad)).toThrow(/多条边/)
  })

  it('节点 id 重复抛错', () => {
    const bad = {
      ...base,
      nodes: [base.nodes[0], base.nodes[0], base.nodes[1]],
    }
    expect(() => validateFlowGraph(bad)).toThrow(/id 重复/)
  })

  it('到不了 end 抛错', () => {
    const bad = {
      ...base,
      nodes: [
        { id: 's', type: 'start', meta: { position: { x: 0, y: 0 } }, data: { title: 's' } },
        {
          id: 'a',
          type: 'mt-action',
          meta: { position: { x: 1, y: 0 } },
          data: { title: 'a', requires: [], act: { kind: 'sleep', min: 0, max: 0 } },
        },
        { id: 'e', type: 'end', meta: { position: { x: 2, y: 0 } }, data: { title: 'e' } },
      ],
      edges: [
        { sourceNodeID: 's', sourcePortID: 'out', targetNodeID: 'a' },
        { sourceNodeID: 'a', sourcePortID: 'failure', targetNodeID: 'a' },
      ],
    }
    expect(() => validateFlowGraph(bad)).toThrow(FlowGraphError)
  })
})
