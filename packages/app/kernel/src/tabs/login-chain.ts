/**
 * 登录链执行器（通用解释器）。
 *
 * 旧版把整条链写成一个 800 行的 `elif event.event == SUCCEEDED:` 分支
 * （`device_tab.py:5852-6290`），靠「改 `current_action` 再顺序 if + continue」串起来。
 * 本文件把它拆成两部分：
 *
 * 1. **配方**（`ChainRecipe`）由业务包提供，声明「什么条件下跑哪一步」；
 * 2. **解释器**（本文件的 `advanceChain` / `beginChain`）只做条件求值和阶段消费。
 *
 * 内核因此不含任何具体动作 id，换业务只需换配方。
 */

import type { ChainCondition, ChainRecipe, ChainStepSpec } from '@myt/flow'

/**
 * 运行期上下文：条件求值只看这里。
 *
 * 刻意不叫 `ChainConfig` —— 它不是「配置」，而是**一次运行的输入快照**：
 * 开关来自 UI、数据来自批导入、剩余次数随执行递减。
 */
export interface ChainRun {
  /** 开关与参数快照（键名即 UI 传的 opts 键）。 */
  flags: Record<string, unknown>
  /** 运行数据（头像路径、昵称、关注关键词等）。 */
  data: Record<string, string>
  /** 剩余循环次数（每完成一轮 -1）。 */
  loopRemaining: number
  /** 剩余重试次数。 */
  retryRemaining: number
  /** 本次运行已执行过的动作（供 `once` 判断）。 */
  done: Set<string>
}

/** 链的当前状态。 */
export interface ChainState {
  deviceId: string
  serial: string
  /** 当前动作。 */
  action: string
  /** 已完成的动作序列（审计用）。 */
  history: string[]
  /** 运行期上下文。 */
  run: ChainRun
  /** 本次绑定用的是「批导入 → 绑定账号」里的第几条（-1 表示未用）。 */
  bindAccountIndex?: number
  /** 绑定账号分配给的设备序列号（回写用）。 */
  bindAccountSerial?: string
}

/** 链的下一步。 */
export interface ChainStep {
  action: string
  /** 传给该动作的参数。 */
  params: Record<string, string>
}

/** 求值所需的上下文。 */
interface EvalScope {
  run: ChainRun
}

/** 从运行数据里取一个字符串值。 */
function dataValue(run: ChainRun, key: string): string {
  const value = run.data[key]
  return typeof value === 'string' ? value : ''
}

/** 开关是否为真（兼容 UI 传来的 `'true'` / `true`）。 */
function flagValue(run: ChainRun, key: string): boolean {
  const value = run.flags[key]
  return value === true || value === 'true'
}

/**
 * 求值一个条件表达式。
 *
 * @param condition 条件；缺省视为真
 * @param scope 运行期上下文
 */
export function evaluateCondition(condition: ChainCondition | undefined, scope: EvalScope): boolean {
  if (!condition) return true
  const { run } = scope

  if (condition.all && !condition.all.every((item) => evaluateCondition(item, scope))) return false
  if (condition.any && !condition.any.some((item) => evaluateCondition(item, scope))) return false
  if (condition.not && evaluateCondition(condition.not, scope)) return false
  if (condition.flag !== undefined && !flagValue(run, condition.flag)) return false
  if (condition.has !== undefined && !dataValue(run, condition.has)) return false
  if (condition.remaining === 'loop' && run.loopRemaining <= 0) return false
  if (condition.remaining === 'retry' && run.retryRemaining <= 0) return false
  if (condition.once !== undefined && run.done.has(condition.once)) return false

  return true
}

/**
 * 展开步骤模板里的 `${key}` 占位。
 *
 * @param spec 步骤声明
 * @param run 运行期上下文
 * @returns 传给流程的参数
 */
export function expandParams(spec: ChainStepSpec, run: ChainRun): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, template] of Object.entries(spec.params ?? {})) {
    const matched = /^\$\{(\w+)\}$/.exec(template)
    out[key] = matched ? dataValue(run, matched[1] ?? '') : template
  }
  return out
}

/**
 * 从一组步骤里挑出第一个满足条件的。
 *
 * @param specs 步骤列表
 * @param scope 运行期上下文
 * @param skip 需要跳过的动作（已被 `afterAction` 接管）
 */
function pickStep(
  specs: readonly ChainStepSpec[],
  scope: EvalScope,
  skip: ReadonlySet<string>,
): ChainStep | null {
  for (const spec of specs) {
    if (skip.has(spec.action)) continue
    if (!evaluateCondition(spec.when, scope)) continue
    return { action: spec.action, params: expandParams(spec, scope.run) }
  }
  return null
}

/** 某个动作成功后需要续接的阶段名。 */
type Phase = 'before' | 'afterLogin' | 'finalize'

/**
 * 计算链的第一个步骤（登录前阶段）。
 *
 * @param recipe 业务包提供的配方
 * @param state 链状态
 */
export function beginChain(recipe: ChainRecipe, state: ChainState): ChainStep | null {
  state.run.done.clear()
  state.history = []
  const step = pickStep(recipe.before, { run: state.run }, new Set())
  if (step) return step
  // 无前置动作 → 直接登录。
  return { action: 'login', params: {} }
}

/**
 * 推进链状态机。
 *
 * @param recipe 业务包提供的配方
 * @param state 链状态
 * @param completed 刚成功的动作
 * @returns 下一步；null 表示整条链结束
 */
export function advanceChain(
  recipe: ChainRecipe,
  state: ChainState,
  completed: string,
): ChainStep | null {
  state.history.push(completed)
  state.action = completed
  state.run.done.add(completed)

  const scope: EvalScope = { run: state.run }

  // ── 登录前阶段：继续消费剩余前置动作，走完进入登录 ──
  if (isInPhase(recipe, 'before', completed)) {
    const remaining = remainingOf(recipe.before, scope, completed)
    if (remaining) return remaining
    return { action: 'login', params: {} }
  }

  // ── 登录成功：进入第一轮后置动作 ──
  if (completed === 'login') {
    return nextAfterLogin(recipe, scope, new Set())
  }

  // ── 后置动作成功：先看 afterAction 续接，再回到第一轮余下步骤 ──
  const continuation = recipe.afterAction?.[completed]
  if (continuation) {
    const next = pickStep(continuation, scope, new Set())
    if (next) return next
  }

  // 第一轮里排在当前动作之后的步骤。
  const after = remainingOf(recipe.afterLogin, scope, completed)
  if (after) return after

  // ── 所有后置动作走完：收尾（备份 → 清除）──
  return nextFinalize(recipe, scope)
}

/**
 * 第一轮后置动作。
 *
 * `skip` 用于排除那些「已由 afterAction 接管」的动作——例如改资料路径下的绑定，
 * 必须等 `MODIFY_PROFILE` 成功后才执行，不能在登录后立刻跑。
 *
 * @param recipe 配方
 * @param scope 运行期上下文
 * @param skip 需要跳过的动作
 */
function nextAfterLogin(recipe: ChainRecipe, scope: EvalScope, skip: ReadonlySet<string>): ChainStep | null {
  // 找出本次会执行、且带 afterAction 的动作：它们的第一轮同名步骤要跳过，
  // 留到该动作成功后由 afterAction 续接（旧版 MODIFY_PROFILE → BIND_PHONE 的语义）。
  const deferred = new Set<string>(skip)
  // 只有「afterAction 里的动作」需要从第一轮里排除（例如改资料路径下的绑定）。
  // 触发者本身（modify-profile）必须照常执行，否则续接永远不会发生。
  for (const spec of recipe.afterLogin) {
    if (!evaluateCondition(spec.when, scope)) continue
    const continuation = recipe.afterAction?.[spec.action]
    if (!continuation) continue
    for (const next of continuation) deferred.add(next.action)
  }

  const step = pickStep(recipe.afterLogin, scope, deferred)
  if (step) return step

  return nextFinalize(recipe, scope)
}

/**
 * 收尾阶段：备份 → 清除，各执行一次。
 *
 * 已执行过的动作靠 `run.done` 排除，避免 backup → afterBackup → backup 的循环。
 */
function nextFinalize(recipe: ChainRecipe, scope: EvalScope): ChainStep | null {
  const step = pickStep(recipe.finalize, scope, scope.run.done)
  if (step) return step
  return finishOrLoop(recipe, { run: scope.run } as ChainState)
}

/** 判断某动作是否属于指定阶段。 */
function isInPhase(recipe: ChainRecipe, phase: Phase, action: string): boolean {
  const specs = phase === 'before' ? recipe.before : phase === 'afterLogin' ? recipe.afterLogin : recipe.finalize
  return specs.some((spec) => spec.action === action)
}

/**
 * 取「同一阶段里排在 `completed` 之后」的下一个可执行步骤。
 *
 * @param specs 阶段步骤列表
 * @param scope 运行期上下文
 * @param completed 刚完成的动作
 */
function remainingOf(
  specs: readonly ChainStepSpec[],
  scope: EvalScope,
  completed: string,
): ChainStep | null {
  const index = specs.findIndex((spec) => spec.action === completed)
  if (index < 0) return null
  return pickStep(specs.slice(index + 1), scope, new Set())
}

/** 收尾都做完后：循环就再来一轮登录，否则结束。 */
function finishOrLoop(recipe: ChainRecipe, state: ChainState): ChainStep | null {
  if (!recipe.loopBackTo) return null
  if (state.run.loopRemaining <= 0) return null
  state.run.loopRemaining -= 1
  state.run.done.clear()
  return { action: recipe.loopBackTo, params: { loop: String(state.run.loopRemaining) } }
}

/** 动作的中文名（日志用）；由业务包的动作清单提供，未知时回落 id。 */
export function actionLabel(actions: ReadonlyArray<{ id: string; label: string }>, action: string): string {
  return actions.find((item) => item.id === action)?.label ?? action
}
