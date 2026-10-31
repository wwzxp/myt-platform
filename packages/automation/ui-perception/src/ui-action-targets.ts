/**
 * 语义化 UI 解析：把 uiautomator 原始树转成「可操作目标」列表。
 *
 * 与朴素扁平化的区别（均由真实数据驱动，见 `docs/spec/llm-ui-locate-experiment.md`）：
 *
 * 1. **合并同义节点**：`ViewGroup desc="首页"` 内嵌 `TextView text="首页"` 是同一目标，
 *    实测 43 个有用节点里有 5 处这种父子重复。
 * 2. **祖先代理**：不可点节点（如笔记卡片里的作者名）实际由可点祖先接收点击，
 *    实测 13 个节点属于这种情况。合并后候选从 43 降到 33。
 * 3. **语义命名**：无 text/desc 的可点节点给出「无名按钮（底部右）」这类可指代的名字。
 * 4. **区域归属**：按 y 划分顶部/内容/底部，帮助理解「底部我」这类位置词。
 *
 * 解析结果直接用于 LLM 定位，不再需要调用方二次加工。
 */

/** 原始 UI 节点（只保留定位需要的字段）。 */
export interface RawNode {
  className: string
  text: string
  contentDesc: string
  resourceId: string
  clickable: boolean
  longClickable: boolean
  scrollable: boolean
  enabled: boolean
  selected: boolean
  checked: boolean
  focused: boolean
  isPassword: boolean
  /** 屏幕坐标 [x1, y1, x2, y2]。 */
  bounds: [number, number, number, number]
  children: RawNode[]
}

/** 一个可操作目标。 */
export interface ActionTarget {
  /** 本次快照内唯一，从 1 开始。 */
  id: number
  /** 该目标的完整语义（已合并文字与祖先提示）。 */
  name: string
  /** 实际点击位置的中心坐标。 */
  x: number
  y: number
  /** 实际接收点击的节点边界（可能是祖先）。 */
  clickBounds: [number, number, number, number]
  /** 所属区域。 */
  region: 'top' | 'content' | 'bottom'
  /** 语义类型。 */
  kind: 'button' | 'input' | 'icon' | 'text' | 'scrollable' | 'card'
  /** 是否可点（含祖先可点）。 */
  actionable: boolean
  /** 合并进来的原始节点数（1 表示未合并）。 */
  mergedCount: number
  /** 是否为密码输入框（值不参与定位，但可用于避免误点）。 */
  password: boolean
  /**
   * 位置提示（仅同区域内可用于相对定位时给出）。
   *
   * 实测：所有小模型都无法从坐标推断「最右侧」，但能理解「最右」这个词。
   */
  positionHint?: '最左' | '最右' | '正中间' | '最上' | '最下'
}

/** 屏幕尺寸，用于划分区域。 */
export interface ScreenSize {
  width: number
  height: number
}

/** 类名精简：`android.widget.Button` → `Button`。 */
function shortClass(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx < 0 ? name : name.slice(idx + 1)
}

/** 节点自身是否有语义。 */
function hasOwnLabel(node: RawNode): boolean {
  return Boolean(node.text.trim() || node.contentDesc.trim())
}

/** 是否值得进入候选集。 */
function isCandidate(node: RawNode): boolean {
  return node.clickable || hasOwnLabel(node) || node.scrollable
}

/** 判断节点语义类型。 */
function classify(node: RawNode): ActionTarget['kind'] {
  const cls = shortClass(node.className)
  if (cls === 'EditText') return 'input'
  if (cls === 'ImageView' || cls === 'ImageButton') return 'icon'
  if (node.scrollable) return 'scrollable'
  if (cls === 'TextView') return 'text'
  // 大块可点区域通常是卡片（笔记、商品等）
  const [x1, y1, x2, y2] = node.bounds
  const area = (x2 - x1) * (y2 - y1)
  if (node.clickable && area > 100_000) return 'card'
  return node.clickable ? 'button' : 'text'
}

/** 按中心 y 划分区域。 */
function regionOf(node: RawNode, screen: ScreenSize): ActionTarget['region'] {
  const cy = (node.bounds[1] + node.bounds[3]) / 2
  if (cy < screen.height * 0.12) return 'top'
  if (cy > screen.height * 0.88) return 'bottom'
  return 'content'
}

/** 区域的中文名。 */
const REGION_LABEL: Record<ActionTarget['region'], string> = {
  top: '顶部',
  content: '内容区',
  bottom: '底部',
}

/** 类型的中文名。 */
const KIND_LABEL: Record<ActionTarget['kind'], string> = {
  button: '按钮',
  input: '输入框',
  icon: '图标',
  text: '文字',
  scrollable: '滚动区',
  card: '卡片',
}

/**
 * 收集可操作目标。
 *
 * @param root 原始树根
 * @param screen 屏幕尺寸
 * @returns 去重、合并、带语义的目标列表
 */
export function collectActionTargets(root: RawNode, screen: ScreenSize): ActionTarget[] {
  const targets: ActionTarget[] = []
  /** 已经合并进某个目标的原始节点 id，避免重复。 */
  const merged = new Set<RawNode>()

  /**
   * 递归遍历。
   *
   * @param node 当前节点
   * @param clickableAncestor 最近的可点祖先（用于祖先代理）
   */
  const walk = (node: RawNode, clickableAncestor: RawNode | null, labeledAncestor: string): void => {
    if (merged.has(node)) return

    if (isCandidate(node)) {
      const ownLabel = node.text.trim() || node.contentDesc.trim()

      // —— 规则 1：不可点节点的文字若与可点祖先描述相同，合并进祖先 ——
      const ancestorLabel = clickableAncestor
        ? clickableAncestor.text.trim() || clickableAncestor.contentDesc.trim()
        : ''
      if (!node.clickable && ownLabel && ancestorLabel && ownLabel === ancestorLabel && clickableAncestor) {
        merged.add(node)
        const owner = targets.find((t) => t.clickBounds === clickableAncestor.bounds && t.mergedCount > 0)
        if (owner) {
          owner.mergedCount += 1
        } else {
          // 祖先还没生成目标，稍后由祖先自己生成（mergedCount 会 ≥2）
        }
        for (const child of node.children) walk(child, clickableAncestor, labeledAncestor)
        return
      }

      // —— 规则 2：祖先代理。不可点节点由可点祖先接收点击 ——
      const receiver = node.clickable ? node : clickableAncestor
      const actionable = Boolean(receiver)

      // —— 规则 3：语义命名 ——
      let name = ownLabel
      if (!name && receiver) name = receiver.text.trim() || receiver.contentDesc.trim()
      const kind = classify(node)
      const region = regionOf(node, screen)
      if (!name) {
        // 优先用祖先语义：实测底部区域的「无名图标」其实是笔记卡片的点赞/收藏，
        // 命名成「无名图标（底部中）」会与真正的导航按钮混淆（用户说「点击中间那个加号」
        // 时会误选它）。继承祖先描述可消除歧义。
        if (labeledAncestor) {
          name = `${labeledAncestor}的${KIND_LABEL[kind]}`
        } else {
          const [x1, , x2] = node.bounds
          const cx = (x1 + x2) / 2
          const side = cx < screen.width * 0.33 ? '左' : cx > screen.width * 0.67 ? '右' : '中'
          name = `无名${KIND_LABEL[kind]}（${REGION_LABEL[region]}${side}）`
        }
      }

      const bounds = receiver ? receiver.bounds : node.bounds
      targets.push({
        id: targets.length + 1,
        name,
        x: Math.round((bounds[0] + bounds[2]) / 2),
        y: Math.round((bounds[1] + bounds[3]) / 2),
        clickBounds: bounds,
        region,
        kind,
        actionable,
        mergedCount: 1,
        password: node.isPassword,
      })
    }

    // 传给子节点的「可点祖先」与「最近有语义的祖先」
    const nextAncestor = node.clickable ? node : clickableAncestor
    const ownSemantic = node.text.trim() || node.contentDesc.trim()
    // 截断过长的祖先描述，避免名字太长
    const nextLabeled = ownSemantic ? ownSemantic.slice(0, 20) : labeledAncestor
    for (const child of node.children) walk(child, nextAncestor, nextLabeled)
  }

  walk(root, null, '')

  // —— 规则 4：按「接收点击的边界 + 坐标」去重 ——
  // 同一块区域常被多层容器表示（可点 ViewGroup + 内部 ScrollView），
  // 它们对点击而言是同一个目标，保留第一个（外层，通常语义更完整）。
  const seen = new Map<string, ActionTarget>()
  for (const target of targets) {
    const key = `${target.clickBounds.join(',')}@${target.x},${target.y}`
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, target)
      continue
    }
    // 优先保留「可点」的那个：实测笔记卡片外层不可点（但有标题文字），
    // 内层可点（但无文字），只按名字取舍会丢掉可点性。
    if (!existing.actionable && target.actionable) {
      // 继承外层的名字（更有语义），但保留内层的可点性
      const inheritedName = existing.name.startsWith('无名') ? target.name : existing.name
      target.name = inheritedName
      target.mergedCount += existing.mergedCount
      seen.set(key, target)
    } else if (existing.actionable && !target.actionable) {
      existing.mergedCount += target.mergedCount
    } else if (!existing.name.startsWith('无名') && target.name.startsWith('无名')) {
      existing.mergedCount += target.mergedCount
    } else if (existing.name.startsWith('无名') && !target.name.startsWith('无名')) {
      target.mergedCount += existing.mergedCount
      seen.set(key, target)
    } else {
      existing.mergedCount += target.mergedCount
    }
  }

  // —— 规则 5：父子重复（子节点文字已被祖先 name 包含）—— 
  const deduped: ActionTarget[] = []
  for (const target of seen.values()) {
    const isRedundantChild = deduped.some(
      (parent) =>
        parent.clickBounds[0] <= target.clickBounds[0] &&
        parent.clickBounds[1] <= target.clickBounds[1] &&
        parent.clickBounds[2] >= target.clickBounds[2] &&
        parent.clickBounds[3] >= target.clickBounds[3] &&
        target.name.length > 0 &&
        (parent.name === target.name || parent.name.includes(target.name)),
    )
    if (isRedundantChild) continue
    deduped.push(target)
  }

  // —— 规则 5b：同 bounds 的「不可点父 + 可点子」合并 ——
  // 实测：小红书笔记卡片外层 FrameLayout(clk=false, desc="笔记 xxx") 内嵌一个
  // bounds 完全相同的 FrameLayout(clk=true)。若不合并，模型会选中不可点的外层，
  // 校验层拒绝后看起来像「模型选错」，其实是解析没把可点性传递出来。
  for (const outer of deduped) {
    if (outer.actionable) continue
    const inner = deduped.find(
      (other) =>
        other !== outer &&
        other.actionable &&
        other.clickBounds[0] === outer.clickBounds[0] &&
        other.clickBounds[1] === outer.clickBounds[1] &&
        other.clickBounds[2] === outer.clickBounds[2] &&
        other.clickBounds[3] === outer.clickBounds[3],
    )
    if (!inner) continue
    // 外层有更好的文字（如笔记标题），保留它但当它可点
    if (outer.name.length > inner.name.length && !outer.name.startsWith('无名')) {
      inner.name = outer.name
      inner.mergedCount += outer.mergedCount
    } else {
      inner.mergedCount += outer.mergedCount
    }
    outer.actionable = true
    outer.clickBounds = inner.clickBounds
  }

  // 移除被合并掉的可点子（避免重复候选）
  for (const outer of deduped) {
    const dupIdx = deduped.findIndex(
      (t) =>
        t !== outer &&
        t.actionable &&
        t.clickBounds[0] === outer.clickBounds[0] &&
        t.clickBounds[1] === outer.clickBounds[1] &&
        t.clickBounds[2] === outer.clickBounds[2] &&
        t.clickBounds[3] === outer.clickBounds[3],
    )
    if (dupIdx >= 0 && dupIdx !== deduped.indexOf(outer)) deduped.splice(dupIdx, 1)
  }

  // —— 规则 6：位置提示 ——
  // 小模型不做几何推理（实测：19 个用例里"最右侧导航项"所有小模型都失败）。
  // 这里直接算出同一行/列上的极值，把几何关系变成文字。
  annotatePositions(deduped, screen)

  // 重新编号，保证 id 连续
  return deduped.map((target, i) => ({ ...target, id: i + 1 }))
}

/**
 * 给同一水平带（y 相近）或垂直带（x 相近）的目标标注极值位置。
 *
 * @param targets 目标列表（原地修改）
 * @param screen 屏幕尺寸
 */
function annotatePositions(targets: ActionTarget[], screen: ScreenSize): void {
  // 同一行的判定必须非常严格。实测底部区域有三组 y：
  //   1498（笔记卡片的按钮）、1503（笔记卡片的图标）、1555（导航栏）
  // 差值 5px 与 52px。若容差 ≥5px，笔记图标会和卡片按钮混成一行，
  // 导致「最右」标到笔记的收藏图标上（x=824），而不是导航栏的「我」（x=810）。
  // 因此容差取 4px——只合并真正同一水平线的元素。
  const yTolerance = 4
  const xTolerance = Math.max(8, screen.width * 0.015)

  for (const region of ['top', 'content', 'bottom'] as const) {
    const sameRegion = targets.filter((t) => t.region === region && t.actionable)
    if (sameRegion.length < 3) continue

    // 行分组：把 y 相近的归为一行
    const rows: ActionTarget[][] = []
    for (const t of sameRegion) {
      const row = rows.find((r) => Math.abs(r[0]!.y - t.y) < yTolerance)
      if (row) row.push(t)
      else rows.push([t])
    }
    for (const row of rows) {
      if (row.length < 3) continue
      const sorted = [...row].sort((a, b) => a.x - b.x)
      const minX = sorted[0]!.x
      const maxX = sorted[sorted.length - 1]!.x
      const midIdx = Math.floor(sorted.length / 2)
      for (const [i, t] of sorted.entries()) {
        if (t.x === minX && minX !== maxX) t.positionHint = '最左'
        else if (t.x === maxX) t.positionHint = '最右'
        // 奇数个才标正中间（偶数个没有唯一的中间）
        else if (sorted.length % 2 === 1 && i === midIdx) t.positionHint = '正中间'
      }
    }

    // 列分组
    const cols: ActionTarget[][] = []
    for (const t of sameRegion) {
      const col = cols.find((c) => Math.abs(c[0]!.x - t.x) < xTolerance)
      if (col) col.push(t)
      else cols.push([t])
    }
    for (const col of cols) {
      if (col.length < 3) continue
      const minY = Math.min(...col.map((t) => t.y))
      const maxY = Math.max(...col.map((t) => t.y))
      for (const t of col) {
        if (t.positionHint) continue
        if (t.y === minY && minY !== maxY) t.positionHint = '最上'
        else if (t.y === maxY) t.positionHint = '最下'
      }
    }
  }
}

/**
 * 渲染成 LLM 输入文本。
 *
 * 契约由实测确定：**只给序号和极简属性，不要求模型输出 reason**
 * （1B 模型会退化成写自由文本，JSON 合法率从 100% 掉到 0%）。
 *
 * @param targets 目标列表
 * @param options.withRegion 是否按区域分组（帮助理解位置词）
 * @returns 多行文本，每行一个目标
 */
export function renderTargets(
  targets: readonly ActionTarget[],
  options: { withRegion?: boolean } = {},
): string {
  const line = (t: ActionTarget): string => {
    const parts = [`[${t.id}]`, t.name]
    const attrs: string[] = []
    if (t.kind !== 'text') attrs.push(KIND_LABEL[t.kind])
    attrs.push(t.actionable ? '可点' : '不可点')
    if (t.password) attrs.push('密码框')
    parts.push(attrs.join(' '))
    if (t.positionHint) parts.push(t.positionHint)
    parts.push(`(${t.x},${t.y})`)
    return parts.join(' | ')
  }

  if (!options.withRegion) return targets.map(line).join('\n')

  const groups: Record<ActionTarget['region'], ActionTarget[]> = {
    top: [],
    content: [],
    bottom: [],
  }
  for (const t of targets) groups[t.region].push(t)

  const out: string[] = []
  for (const region of ['top', 'content', 'bottom'] as const) {
    const items = groups[region]
    if (items.length === 0) continue
    out.push(`── ${REGION_LABEL[region]} ──`)
    for (const t of items) out.push(line(t))
  }
  return out.join('\n')
}

/**
 * 校验坐标是否命中某个目标。
 *
 * 防幻觉的最后一道闸：LLM 给出的坐标必须落在真实目标的边界内。
 *
 * @param targets 目标列表
 * @param x 横坐标
 * @param y 纵坐标
 * @returns 命中的目标；未命中返回 null
 */
export function hitTarget(
  targets: readonly ActionTarget[],
  x: number,
  y: number,
): ActionTarget | null {
  let best: ActionTarget | null = null
  let bestArea = Infinity
  for (const t of targets) {
    const [x1, y1, x2, y2] = t.clickBounds
    if (x < x1 || x > x2 || y < y1 || y > y2) continue
    // 可点的优先，其次取面积最小
    const area = (x2 - x1) * (y2 - y1)
    if (t.actionable && (!best || !best.actionable || area < bestArea)) {
      best = t
      bestArea = area
    } else if (!best && area < bestArea) {
      best = t
      bestArea = area
    }
  }
  return best
}

/**
 * 按区域与关键词预筛候选，缩小 LLM 的选择范围。
 *
 * 实测依据（`docs/spec/local-model-ui-locate.md`）：
 * 同一页面 19 个目标时模型准确率 90%，只给底部 5 个目标时 100% 且延迟降至 1/3。
 * 小模型的有效注意力窗口窄，候选越少越准。
 *
 * @param targets 全部目标
 * @param options.region 限定区域
 * @param options.actionableOnly 只保留可点目标
 * @param options.excludeUnnamed 排除无名目标（「无名图标」这类）
 * @returns 预筛后的目标（保持原有 id，便于回查）
 */
export function narrowTargets(
  targets: readonly ActionTarget[],
  options: {
    region?: ActionTarget['region']
    actionableOnly?: boolean
    excludeUnnamed?: boolean
    /** 名字里包含任一关键词（不区分大小写）。 */
    keywords?: string[]
  } = {},
): ActionTarget[] {
  return targets.filter((target) => {
    if (options.region && target.region !== options.region) return false
    if (options.actionableOnly && !target.actionable) return false
    // 只排除「无名且不可点」——实测排除所有无名目标会误删真目标
    // （如底部导航的纯图标按钮，名字是「无名图标（底部右）」但确实是要点的东西）
    if (options.excludeUnnamed && target.name.startsWith('无名') && !target.actionable) return false
    if (options.keywords?.length) {
      const name = target.name.toLowerCase()
      if (!options.keywords.some((k) => name.includes(k.toLowerCase()))) return false
    }
    return true
  })
}

/**
 * 从自然语言意图推断区域。
 *
 * 只做保守推断：识别「底部/导航栏」「顶部/右上/左上」这类明确的位置词。
 * 无法判断时返回 undefined，由调用方决定是否预筛。
 *
 * @param intent 用户写的意图
 * @returns 推断出的区域
 */
/**
 * 区域词表：意图语言与 UI 语言无关，用户可能用任意语言描述位置。
 *
 * 实测依据：英文页面 + 中文意图时 minicpm46 达 8/8，
 * 说明模型本身能跨语言映射；这里只需让「区域预筛」也支持多语言。
 */
const REGION_HINTS: Array<{ region: ActionTarget['region']; patterns: RegExp[] }> = [
  {
    region: 'bottom',
    patterns: [
      /底部|导航栏|导航项|底栏|下方栏|下面|底端/,
      /\b(bottom|footer|tab ?bar|nav(igation)? ?bar|nav ?item|tab|lower|dock)\b/i,
      /下部|ナビ|フッター/,
      /하단|네비/,
    ],
  },
  {
    region: 'top',
    patterns: [
      /顶部|右上|左上|标题栏|状态栏|上面|顶端/,
      /\b(top|header|title ?bar|upper|right ?corner|left ?corner|toolbar)\b/i,
      /上部|ヘッダー|タイトル/,
      /상단|헤더/,
    ],
  },
]

/**
 * 从自然语言意图推断区域（多语言）。
 *
 * 只做保守推断：识别明确的区域词就返回，否则返回 undefined 由调用方决定。
 * 不要在这里猜——猜错会导致把正确目标筛掉。
 *
 * @param intent 用户写的意图（任意语言）
 * @returns 推断出的区域
 */
export function inferRegion(intent: string): ActionTarget['region'] | undefined {
  for (const { region, patterns } of REGION_HINTS) {
    if (patterns.some((p) => p.test(intent))) return region
  }
  return undefined
}
