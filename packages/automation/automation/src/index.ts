/**
 * 安卓自动化引擎：把「取界面 → 判页面 → 找坐标 → 执行 → 校验」写一次。
 *
 * 这一层不认识任何具体 App——包名、页面表、恢复规则都由业务包传入。
 * 换业务（抖音、快手）只需要提供自己的定位器与页面定义，引擎不用改。
 *
 * 依赖方向：
 * ```
 * @myt/device（纯 ADB） ← @myt/ui-perception（UI 解析）
 *                      ← @myt/ui-decide（模型决策）
 *                      ← @myt/automation（本包：五步循环）
 *                      ← @myt/flow-xhs-publish（业务）
 * ```
 */

export {
  runAction,
  runActions,
  makeStep,
  canLocate,
  askPageYesNo,
  screenSizeOf,
  type ActionResult,
  appContextOf,
} from './run.ts'

export type {
  ActionSpec,
  ActSpec,
  LocateSpec,
  VerifySpec,
  Point,
} from './types.ts'

export {
  PageRegistry,
  UNKNOWN_PAGE,
  currentActivity,
  currentPage,
  waitForPage,
  assertPage,
  ensurePage,
  type PageSpec,
} from './page-guard.ts'

export {
  recoverTo,
  activityMatches,
  restartToHome,
  type RecoveryAction,
  type RecoveryConfig,
  type RecoveryResult,
  type RecoveryRule,
} from './recovery.ts'

export {
  locateByModel,
  askYesNo,
  screenSizeOf as locateScreenSizeOf,
  type LocateOutcome,
} from './locate-adapter.ts'

export {
  ADB_KEYBOARD_IME,
  clearPhoneInput,
  pasteText,
  randInt,
  sleep,
  sleepRandom,
  tapHuman,
  typeWithVerify,
  type InputPosition,
  type MatchMode,
} from './actions.ts'

export { Browser, browseHome, browseSearch, type BrowseResult, type BrowseStep } from './browse.ts'

// ── 流程图引擎（节点 + 连线，按端口路由）──
export {
  PORTS_OF_TYPE,
  FlowGraphError,
  loadFlowGraph,
  loadFlowGraphs,
  validateFlowGraph,
  runGraph,
  executeNode,
  type ActionNodeConfig,
  type ActConfig,
  type AppConfig,
  type CanvasPosition,
  type ConditionNodeConfig,
  type CustomActions,
  type CustomMeasures,
  type CustomVerifiers,
  type FlowEdge,
  type FlowGraph,
  type FlowNode,
  type GraphOutcome,
  type GraphRuntime,
  type LocateConfig,
  type LocatorTable,
  type LoopNodeConfig,
  type NodeType,
  type NodeResult,
  type PortId,
  type VerifyConfig,
} from './graph/index.ts'
