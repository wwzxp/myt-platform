/**
 * 流程图：节点 + 连线。
 *
 * 为什么用图而不是平铺数组：
 * 现有流程的分支逻辑（没有标题就跳过、找不到元素就继续、页面不对就恢复）
 * 全部藏在代码里，UI 上看不到也改不了。改成图之后，每个分支都是画布上的一条边。
 *
 * 术语（见 CONTEXT.md）：
 * - 节点 `FlowNode`：流程中的一步，有明确的出入口
 * - 端口 `PortId`：节点的一个出口，连到不同的下一步
 * - 边 `FlowEdge`：端口到节点的连线
 */

/** 端口：节点走完后可选的去向。 */
export type PortId =
  /** start 节点的唯一出口。 */
  | 'out'
  /** action 成功。 */
  | 'success'
  /** action 失败（定位不到或校验不过）。 */
  | 'failure'
  /** action 的前置页面不符。 */
  | 'mismatch'
  /** condition 成立。 */
  | 'true'
  /** condition 不成立。 */
  | 'false'
  /** loop 未达次数，走循环体。 */
  | 'body'
  /** loop 已达次数，退出循环。 */
  | 'done'

/**
 * 可执行节点类型（与画布 `node.type` 完全一致）。
 *
 * **统一格式**：磁盘上只有一种 JSON（画布格式），引擎直接读它，
 * 不再有「我们的格式 → 画布格式」的转换层。
 *
 * 画布能拖的节点必须都在这里——否则拖进来就报「type 非法」。
 * `group` / `comment` 不在列：纯视觉节点，不进图。
 */
export type NodeType =
  | 'start'
  | 'mt-action'
  | 'mt-condition'
  | 'mt-loop'
  /** flowgram 内置循环容器（数组遍历）。 */
  | 'loop'
  /** flowgram 内置条件节点（纯变量比较）。 */
  | 'condition'
  | 'http'
  | 'code'
  | 'llm'
  | 'variable'
  /**
   * 循环体的起止标记：由 `mt-loop` / `loop` 的容器自动插入，**不该手动拖**。
   * 面板里隐藏，但引擎必须认识——否则跑循环体时报「没有执行器」。
   */
  | 'block-start'
  | 'block-end'
  | 'end'

/** 每种节点允许的出口端口。 */
export const PORTS_OF_TYPE: Record<NodeType, readonly PortId[]> = {
  start: ['out'],
  'mt-action': ['success', 'failure', 'mismatch'],
  'mt-condition': ['true', 'false'],
  // 循环体在 `blocks` 里，不走端口；只有退出后的 `done`。
  'mt-loop': ['done'],
  loop: ['done'],
  condition: ['true', 'false'],
  http: ['out'],
  code: ['out'],
  llm: ['out'],
  variable: ['out'],
  'block-start': ['out'],
  'block-end': ['done'],
  end: [],
}

/** 节点类型是否属于「动作」类（需要定位+执行+校验）。 */
export function isActionType(type: NodeType): boolean {
  return type === 'mt-action'
}

/** 节点类型是否属于「条件」类。 */
export function isConditionType(type: NodeType): boolean {
  return type === 'mt-condition'
}

/** 节点类型是否属于「循环容器」类。 */
export function isLoopType(type: NodeType): boolean {
  return type === 'mt-loop' || type === 'loop'
}

/** 画布坐标（仅供 UI 渲染，不影响执行）。 */
export interface CanvasPosition {
  x: number
  y: number
}

/**
 * 一个输入值的来源（与 flowgram demo 的 `FlowValue` 同构）。
 *
 * 三种来源显式区分，消除「这段文字是字面量还是参数名」的歧义——
 * 旧的 `resolveText` 只能做 `ctx.flowParams[key]` 查表，分不清两者。
 */
export type FlowValue =
  /**
   * 常量。`content` 可以是任意 JSON 值——字符串、数字、布尔，
   * 也可以是整块结构化配置（如 `verify` 校验规则）。
   */
  | { type: 'constant'; content: unknown }
  /** 引用上游节点的输出，如 `['submitNote', 'ok']`。 */
  | { type: 'ref'; content: readonly string[] }
  /** 模板插值，如 `'点击{{keyword}}'`。 */
  | { type: 'template'; content: string }

/**
 * 节点数据的统一形状（与 flowgram demo 同构）。
 *
 * 所有节点——包括自研的 `mt-*`——都用这个形状，这样变量系统与表单
 * 渲染只有一套实现。
 */
export interface NodeData {
  /** 中文展示名，给用户看。 */
  title?: string
  /** 输入值：常量 / 引用 / 模板。执行前由引擎统一求值。 */
  inputsValues?: Record<string, FlowValue>
  /** 输入声明（JSON Schema）：驱动变量面板与校验。 */
  inputs?: { type: 'object'; properties: Record<string, unknown> }
  /** 输出声明（JSON Schema）：下游节点据此引用本节点产出。 */
  outputs?: { type: 'object'; properties: Record<string, unknown> }
  /** 兼容旧模板：已迁移的节点不再产生这些字段。 */
  [key: string]: unknown
}

/** 定位模式。 */
export type LocateMode =
  /** 自然语言描述，模型在 UI 树上定位。能见到 UI 树的场景都用它。 */
  | 'intent'
  /** 绝对坐标。UI 树看不到的元素（Canvas / WebView / 游戏画面）用它。 */
  | 'point'
  /** 比例坐标（0-1）。同 point 但换机型不失效，**优先选它**。 */
  | 'ratio'

/** 定位方式。 */
export interface LocateConfig {
  /** 用哪种定位；缺省按 `intent`。 */
  mode?: LocateMode
  /**
   * 意图描述（`mode: 'intent'`）。会被直接送给模型，写成界面上能看到的
   * **精确文字**（「输入标题」而不是「标题」——后者会选到「一键排版」，实测）。
   */
  intent?: string
  /** 绝对坐标（`mode: 'point'`）。 */
  point?: { x: number; y: number }
  /** 比例坐标（`mode: 'ratio'`），取值 0-1。 */
  ratio?: { x: number; y: number }
  /** 确定性兜底：模型不可用时用旧路径。JSON 里用定位器名，运行时查表。 */
  fallback?: string
  /** 是否启用视觉兜底，默认开启。 */
  vision?: boolean
  /**
   * 严格模式：命中结果必须与意图字面相关，否则视为未命中。
   *
   * 用在「可能不存在」的弹窗上——默认模式下模型找不到会挑一个最像的，
   * 实测在发布编辑页找「取消」选中了「返回」，一点就退回上一页。
   */
  strict?: boolean
}

/** 执行方式。 */
export type ActConfig =
  /** 点击（拟人化）。 */
  | { kind: 'tap' }
  /** 输入文本：先点输入框，再粘贴，再回读校验。 */
  | {
      kind: 'input'
      /** 要输入的文字。若流程参数里有同名键则优先用参数值。 */
      text: string
      /** 附加片段（话题等），逐条粘贴。 */
      extras?: readonly string[]
      /** 回读比较方式，默认 exact。 */
      match?: 'exact' | 'contains'
      /** 回读校验用的定位器名。 */
      inputLocator: string
    }
  /** 滑动。 `from`/`to` 用 0-1 的相对坐标，按屏幕尺寸换算。 */
  | { kind: 'swipe'; from: { x: number; y: number }; to: { x: number; y: number }; durationMs: number }
  /** 按返回键。 */
  | { kind: 'back' }
  /** 打开深链。 */
  | { kind: 'openUri'; uri: string }
  /** 等待固定时长（秒区间）。 */
  | { kind: 'sleep'; min: number; max: number }
  /** 执行注册过的自定义动作（如选图）。 */
  | { kind: 'custom'; name: string }

/** 校验方式：五种内置 + 自定义。 */
export type VerifyConfig =
  /** 页面变成目标页面之一。 */
  | { kind: 'page'; expect: readonly string[] }
  /** 元素存在。 */
  | { kind: 'exists'; locate: LocateConfig }
  /** 元素消失。 */
  | { kind: 'gone'; locate: LocateConfig }
  /** 输入框内容等于（或包含）期望文字。 */
  | { kind: 'inputEquals'; locator: string; text: string; match?: 'exact' | 'contains' }
  /** 数值达标（例：已选图片数 ≥ 目标数）。 */
  | { kind: 'countAtLeast'; measure: string; target: number }
  /** 自定义校验（上面五种覆盖不到的）。 */
  | { kind: 'custom'; name: string }

/** 动作节点的配置。 */
export interface ActionNodeConfig {
  /** 执行前必须处于这些页面之一；不符走 `mismatch` 端口。 */
  requires: readonly string[]
  /** 定位方式；`act.kind` 为 `custom` / `sleep` / `back` / `openUri` 时可省略。 */
  locate?: LocateConfig
  /** 执行方式。 */
  act: ActConfig
  /** 成功后如何判定；省略表示「执行完就算成功」。 */
  verify?: VerifyConfig
  /** 执行后额外等待（秒），用于吸收页面跳转延迟。 */
  settle?: readonly [number, number]
}

/** 条件节点的配置。 */
export type ConditionNodeConfig =
  /** 当前页面是否属于某组页面 id。 */
  | { kind: 'page'; expect: readonly string[] }
  /** 某元素是否存在。 */
  | { kind: 'exists'; locate: LocateConfig }
  /** 流程参数是否非空。 */
  | { kind: 'param'; key: string }

/**
 * 循环节点的配置（**容器式**）。
 *
 * 循环体是 `FlowNode.blocks` 里的子节点，不再用「body/done 端口回环」表达。
 * 这样画布上能一眼看出哪些步骤在循环里。
 */
export interface LoopNodeConfig {
  /** 最大循环次数。 */
  max: number
  /** 每轮之间的等待区间（秒）。 */
  gap?: readonly [number, number]
}

/** 一个节点。 */
/**
 * 一个节点（**字段名与画布 JSON 完全一致**）。
 *
 * 与 flowgram `WorkflowNodeJSON` 的对应：
 * - `type` ← 同名字段
 * - `meta.position` ← 同名字段
 * - `data` ← 业务数据（title / locate / act / verify / judge / loopFor）
 */
export interface FlowNode {
  /** 节点 id，图内唯一。 */
  id: string
  /** 节点类型（与画布 `node.type` 一致）。 */
  type: NodeType
  /** 画布元信息。 */
  meta: {
    /** 画布坐标，仅供 UI，不影响执行。 */
    position: CanvasPosition
  }
  /**
   * 业务数据。
   *
   * 形状统一为 `NodeData`（`title` / `inputsValues` / `inputs` / `outputs`），
   * 与画布其它节点一致。旧的裸字段（`locate` / `act` / `judge` / `loopFor`）
   * 已迁进 `inputsValues`，由 `parseNodeInputs` 求值后得到。
   */
  data: NodeData
  /**
   * 子节点（仅循环容器使用）。
   *
   * 容器式循环：循环体写在 blocks 里，坐标相对容器。
   * 子节点之间的连线仍走顶层 `edges`（用节点 id 引用，不分层级）。
   */
  blocks?: readonly FlowNode[]
}

/** 一条边（**字段名与画布 JSON 完全一致**）。 */
export interface FlowEdge {
  /** 源节点 id。 */
  sourceNodeID: string
  /** 从哪个端口出去。 */
  sourcePortID: PortId
  /** 目标节点 id。 */
  targetNodeID: string
  /** 目标端口（我们只有一个入口 `in`，可省略）。 */
  targetPortID?: string
}

/** 目标 App 配置（包名、首页深链、页面表、恢复规则）。 */
export interface AppConfig {
  /** 包名（强杀 / 深链要用）。 */
  packageName: string
  /** 首页深链（回到起点）。 */
  homeUri: string
  /** 页面表：id + Activity 关键字。顺序即匹配优先级。 */
  pages: ReadonlyArray<{ id: string; markers: readonly string[] }>
  /** 已知异常页面的恢复规则。 */
  recoveryRules: readonly unknown[]
}

/**
 * 一张完整的流程图（**就是画布 JSON**）。
 *
 * 顶层结构与 flowgram `FlowDocumentJSON` 一致（`nodes` + `edges`），
 * 业务配置放在 `data` 扩展位里（flowgram 的类型有 `[key: string]: any`，不违反它）。
 */
export interface FlowGraph {
  /** 流程 id（如 `xhs.publish.image`）。 */
  id: string
  /** 中文标题。 */
  title: string
  /** 节点集合。 */
  nodes: readonly FlowNode[]
  /** 边集合。 */
  edges: readonly FlowEdge[]
  /**
   * 业务配置（flowgram 的 `data` 扩展位）。
   *
   * - `app`：包名、首页深链、页面表、恢复规则
   * - `maxSteps`：最大执行步数，防环形连线跑死
   */
  data: {
    /** 目标 App 配置。 */
    app: AppConfig
    /** 最大执行步数。 */
    maxSteps: number
    /** 其它扩展字段。 */
    [key: string]: unknown
  }
  /**
   * 入口节点 id。
   *
   * 省略时自动取唯一的 `start` 节点——画布上 start 本来就只有一个。
   */
  entry?: string
}

/** 一次图执行的结果。 */
export interface GraphOutcome {
  /**
   * 是否正常完成。
   *
   * **只有从 `success` 端口进入 end 才算成功**——经 `failure` / `mismatch`
   * 到 end 属于「失败后中止」，必须报失败，否则流程静默成功但什么都没做。
   */
  ok: boolean
  /** 实际执行轨迹：节点 id → 走的端口。 */
  trail: Array<{
    node: string
    port?: PortId
    ms: number
    /**
     * 该节点的失败/跳过原因。
     *
     * 有值时即使端口有连线也会一路带到最终 `reason`——
     * 否则「失败→连到下一个节点→最终中止」时原因会丢，
     * 只剩一句「经 failure 端口中止」，无法定位。
     */
    reason?: string
  }>
  /** 失败时停在哪个节点。 */
  failedAt?: string | undefined
  /** 失败原因。 */
  reason?: string | undefined
  /** 总耗时毫秒。 */
  ms: number
}
