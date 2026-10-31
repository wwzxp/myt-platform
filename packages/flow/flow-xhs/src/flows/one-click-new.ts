/**
 * 一键新机（`tools/One_click_new_device.py` 255 行的**逐函数复刻**）。
 *
 * 复刻原则：**不改逻辑、不改默认值、不改失败行为**。
 * 旧代码有问题的地方在注释里标注，但代码保持一致。
 *
 * 原文件结构：
 * ```
 * _ui_xml(adb_port)                     → uiXml()
 * _normalize_text_candidates(text)      → normalizeTextCandidates()
 * _find_ui_element(xml, res_id, text)   → findUiElement()
 * _check_ui(...)                        → checkUi()
 * _check_ui_scroll_list(...)            → checkUiScrollList()
 * _get_specified_tab_position(...)      → getSpecifiedTabPosition()
 * _get_spinner_position(adb, path)      → getSpinnerPosition()
 * One_click_new_device(...)             → oneClickNewDevice()
 * ```
 */

import type { StepContext } from '@myt/flow'
import type { UiNode } from '@myt/device'
import { sleep } from '@myt/human'

/** 旧 `com.blue.backup` 包名与 Activity。 */
const BLUE_PACKAGE = 'com.blue.backup'
const BLUE_ACTIVITY = '.FunctionMenuActivity'

/** 旧代码里用到的全部 resource-id（原样保留）。 */
const RID = {
  textView1: 'com.blue.backup:id/textView1',
  setCardProperty: 'com.blue.backup:id/set_card_property',
  randomBtn: 'com.blue.backup:id/random_btn',
  specifiedBtn: 'com.blue.backup:id/specified_btn',
  brand: 'com.blue.backup:id/brand',
  model: 'com.blue.backup:id/model',
  appName: 'com.blue.backup:id/app_name',
} as const

/** 旧 `_get_spinner_position` 用到的全部层级路径（原样保留）。 */
const P = {
  specifiedTab: [0, 0, 0, 0, 1, 0, 1],
  brandSpinner: [0, 0, 0, 0, 2, 0, 0, 1],
  modelSpinner: [0, 0, 0, 0, 2, 0, 1, 1],
  nextButton: [0, 0, 0, 0, 5, 1],
  overseasCheckbox: [0, 0, 0, 0, 2, 0, 0, 0],
  randomConfirm: [0, 0, 0, 0, 2, 0, 3],
} as const

/** 旧代码里的小红书名称候选（简繁 + 英文）。 */
const XHS_APP_NAME = ['小紅書', '小红书', 'rednote']

/** 上次 dump 的 XML 字符串（旧 `_ui_xml` 每次都重新拉，这里保持同样语义）。 */
async function uiXml(ctx: StepContext): Promise<string> {
  // 旧 `adb_client.device(port).ui_xml()` 返回原始 XML 字符串；
  // 本项目用 `dumpUi` 拿结构化快照，这里转回"原始 XML"语义供正则复用。
  const snapshot = await ctx.device.dumpUi(ctx.serial, { channel: 'yadb' })
  return serializeUi(snapshot.root)
}

/**
 * 把 `UiNode` 树序列化成旧代码期望的 XML 形态。
 *
 * 旧 `_find_ui_element` 用正则匹配 `resource-id="..." ... bounds="[x,y][x,y]"`，
 * 所以节点属性顺序必须保证 `resource-id` 在 `bounds` 之前（旧 uiautomator 就是这个顺序）。
 */
function serializeUi(root: UiNode): string {
  const parts: string[] = []
  const walk = (node: UiNode): void => {
    const [x1, y1, x2, y2] = node.bounds
    parts.push(
      `<node class="${node.className}" text="${node.text}" resource-id="${node.resourceId}"` +
        ` checked="${node.checked}" clickable="${node.clickable}"` +
        ` bounds="[${x1},${y1}][${x2},${y2}]">`,
    )
    for (const child of node.children) walk(child)
    parts.push('</node>')
  }
  walk(root)
  return `<hierarchy rotation="0">${parts.join('')}</hierarchy>`
}

/** 旧 `_normalize_text_candidates`：把 text 参数规整成候选数组。 */
function normalizeTextCandidates(text: unknown): string[] {
  if (text === null || text === undefined) return []
  if (Array.isArray(text) || text instanceof Set) {
    return [...(text as Iterable<unknown>)]
      .filter((t) => t !== null && t !== undefined)
      .map((t) => String(t).trim())
      .filter((t) => t.length > 0)
  }
  const s = String(text).trim()
  return s ? [s] : []
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 旧 `_find_ui_element`：正则找节点，返回 `[found, x, y]`。 */
function findUiElement(
  xmlContent: string,
  resId: string,
  text: unknown = '',
): [boolean, number | null, number | null] {
  try {
    const candidates = normalizeTextCandidates(text)
    const bounds = '.*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"'

    if (candidates.length > 0) {
      for (const t of candidates) {
        const pattern =
          resId
            ? `text="${escapeRegExp(t)}".*?resource-id="${escapeRegExp(resId)}"`
            : `text="${escapeRegExp(t)}"`
        const m = new RegExp(pattern + bounds, 's').exec(xmlContent)
        if (m) {
          const [x1, y1, x2, y2] = m.slice(1, 5).map(Number) as [number, number, number, number]
          return [true, Math.floor((x1 + x2) / 2), Math.floor((y1 + y2) / 2)]
        }
      }
      return [false, null, null]
    }

    const m = new RegExp(
      `resource-id="${escapeRegExp(resId)}"` + bounds,
      's',
    ).exec(xmlContent)
    if (m) {
      const [x1, y1, x2, y2] = m.slice(1, 5).map(Number) as [number, number, number, number]
      return [true, Math.floor((x1 + x2) / 2), Math.floor((y1 + y2) / 2)]
    }
    return [false, null, null]
  } catch {
    return [false, null, null]
  }
}

/**
 * 旧 `_check_ui`：轮询等待节点。
 *
 * 注意旧版**先 sleep 再检查**（不是先检查），这里保持一致。
 */
async function checkUi(
  ctx: StepContext,
  resId: string,
  text: unknown = '',
  maxRetries = 20,
  intervalMs = 2000,
): Promise<[boolean, number | null, number | null]> {
  for (let i = 0; i < maxRetries; i += 1) {
    await sleep(intervalMs)
    try {
      const xmlContent = await uiXml(ctx)
      if (!xmlContent) continue
      const [found, x, y] = findUiElement(xmlContent, resId, text)
      if (found) return [true, x, y]
    } catch {
      continue
    }
  }
  return [false, null, null]
}

/**
 * 旧 `_check_ui_scroll_list`：列表里找不到就上滑。
 *
 * 连续两次看到的候选集合相同即判定到底（原样保留这个启发式）。
 */
async function checkUiScrollList(
  ctx: StepContext,
  resId: string,
  text: unknown = '',
  maxRetries = 20,
  intervalMs = 2000,
): Promise<[boolean, number | null, number | null]> {
  let lastVisible: string[] = []
  for (let i = 0; i < maxRetries; i += 1) {
    await sleep(intervalMs)
    try {
      const xmlContent = await uiXml(ctx)
      if (!xmlContent) continue
      const [found, x, y] = findUiElement(xmlContent, resId, text)
      if (found) return [true, x, y]

      const visible: string[] = []
      const pattern = new RegExp(
        `<node[^>]*text="([^"]*)"[^>]*resource-id="${escapeRegExp(resId)}"[^>]*/?>`,
        's',
      )
      let m: RegExpExecArray | null
      while ((m = pattern.exec(xmlContent)) !== null) visible.push(m[1] ?? '')
      if (visible.length > 0 && visible.join('\u0000') === lastVisible.join('\u0000')) {
        return [false, null, null]
      }
      lastVisible = visible

      // 旧版固定坐标上滑：(382,1180) → (382,620)，500ms。
      await ctx.device.swipe(ctx.serial, { x: 382, y: 1180 }, { x: 382, y: 620 }, 500)
    } catch {
      continue
    }
  }
  return [false, null, null]
}

/** 旧 `_get_spinner_position`：按层级路径取中心点。 */
async function getSpinnerPosition(
  ctx: StepContext,
  spinnerPath: readonly number[],
): Promise<[number, number] | null> {
  const xmlContent = await uiXml(ctx)
  // 旧版用 ElementTree 解析；这里等价于按索引走 children。
  const root = parseSimpleXml(xmlContent)
  if (!root) return null
  let target: SimpleNode | null = root
  for (const idx of spinnerPath) {
    if (!target) return null
    if (idx >= target.children.length) return null
    target = target.children[idx] ?? null
  }
  if (!target) return null
  const m = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(target.bounds)
  if (!m) return null
  const [x1, y1, x2, y2] = m.slice(1, 5).map(Number) as [number, number, number, number]
  return [Math.floor((x1 + x2) / 2), Math.floor((y1 + y2) / 2)]
}

/** `getSpinnerPosition` 用的极简节点。 */
interface SimpleNode {
  bounds: string
  children: SimpleNode[]
}

/**
 * 极简 XML → 树（只为支持层级路径索引）。
 *
 * 不依赖外部 XML 库：旧代码用 `ElementTree.fromstring`，
 * 我们只需要 `children[i]` 与 `bounds` 两个能力。
 */
function parseSimpleXml(xml: string): SimpleNode | null {
  const root: SimpleNode = { bounds: '', children: [] }
  const stack: SimpleNode[] = [root]
  const tag = /<(\/?)node\b([^>]*?)(\/?)>/g
  let m: RegExpExecArray | null
  let sawNode = false
  while ((m = tag.exec(xml)) !== null) {
    const [, closing, attrs, selfClosing] = m
    if (closing === '/') {
      if (stack.length > 1) stack.pop()
      continue
    }
    const boundsMatch = /bounds="([^"]*)"/.exec(attrs ?? '')
    const node: SimpleNode = { bounds: boundsMatch?.[1] ?? '', children: [] }
    stack[stack.length - 1]!.children.push(node)
    sawNode = true
    if (selfClosing !== '/') stack.push(node)
  }
  // 旧 `ElementTree` 的 root 是 `<hierarchy>`，其 children 才是第一个 <node>；
  // 这里 root 本身就是"hierarchy"，children 结构与之一致。
  return sawNode ? root : null
}

/** 旧 `_get_specified_tab_position`。 */
async function getSpecifiedTabPosition(ctx: StepContext): Promise<[number, number] | null> {
  return getSpinnerPosition(ctx, P.specifiedTab)
}

/** 旧 `One_click_new_device` 的参数。 */
export interface OneClickNewDeviceOptions {
  deviceBrand?: string | null
  deviceModel?: string | null
  overseasRandom?: boolean
}

/**
 * 一键新机（旧 `One_click_new_device`）。
 *
 * @returns `true` 表示流程走完；`false` 表示某一步节点未找到（与旧版一致）
 */
export async function oneClickNewDevice(
  ctx: StepContext,
  options: OneClickNewDeviceOptions = {},
): Promise<boolean> {
  const deviceBrand = options.deviceBrand ?? null
  const deviceModel = options.deviceModel ?? null
  const overseasRandom = options.overseasRandom ?? true

  await ctx.device.forceStop(ctx.serial, BLUE_PACKAGE)
  await sleep(2000)
  await ctx.device.shell(ctx.serial, `am start -n ${BLUE_PACKAGE}/${BLUE_ACTIVITY}`)

  let ok = await checkUi(ctx, RID.textView1)
  if (!ok[0]) return false
  await ctx.device.tap(ctx.serial, ok[1]!, ok[2]!)

  ok = await checkUi(ctx, RID.setCardProperty)
  if (!ok[0]) return false
  await ctx.device.tap(ctx.serial, ok[1]!, ok[2]!)

  ok = await checkUi(ctx, RID.randomBtn)
  if (!ok[0]) return false

  if (deviceBrand && deviceModel) {
    // ── 指定机型（层级路径定位）──
    const pos = await getSpecifiedTabPosition(ctx)
    if (!pos) return false
    await ctx.device.tap(ctx.serial, pos[0], pos[1])

    ok = await checkUi(ctx, RID.specifiedBtn)
    if (!ok[0]) return false

    // 选择品牌
    const brandPos = await getSpinnerPosition(ctx, P.brandSpinner)
    if (!brandPos) return false
    await ctx.device.tap(ctx.serial, brandPos[0], brandPos[1])
    ok = await checkUi(ctx, RID.brand, deviceBrand)
    if (!ok[0]) return false
    await ctx.device.tap(ctx.serial, ok[1]!, ok[2]!)

    // 等待品牌列表消失（旧版同样只是再等一次）
    await checkUi(ctx, RID.brand, deviceBrand)

    // 选择机型
    const modelPos = await getSpinnerPosition(ctx, P.modelSpinner)
    if (!modelPos) return false
    await ctx.device.tap(ctx.serial, modelPos[0], modelPos[1])
    ok = await checkUiScrollList(ctx, RID.model, deviceModel)
    if (!ok[0]) return false
    await ctx.device.tap(ctx.serial, ok[1]!, ok[2]!)

    // 下一步
    ok = await checkUi(ctx, RID.specifiedBtn)
    if (!ok[0]) return false
    await ctx.device.tap(ctx.serial, ok[1]!, ok[2]!)

    // 清除小红书数据
    ok = await checkUi(ctx, RID.appName, XHS_APP_NAME)
    if (!ok[0]) return false
    await ctx.device.tap(ctx.serial, ok[1]!, ok[2]!)
    await sleep(1000)
    const clearPos = await getSpinnerPosition(ctx, P.nextButton)
    if (clearPos) await ctx.device.tap(ctx.serial, clearPos[0], clearPos[1])

    // 等待回到主界面
    for (let i = 0; i < 30; i += 1) {
      await sleep(1000)
      try {
        const xmlContent = await uiXml(ctx)
        const [found] = findUiElement(xmlContent, RID.setCardProperty, '')
        if (found) break
      } catch {
        // 旧版同样吞掉异常继续等。
      }
    }
    return true
  }

  // ── 随机机型（海外随机）──
  if (overseasRandom) {
    const pos = await getSpinnerPosition(ctx, P.overseasCheckbox)
    if (pos) await ctx.device.tap(ctx.serial, pos[0], pos[1])
  }

  const confirmPos = await getSpinnerPosition(ctx, P.randomConfirm)
  if (confirmPos) await ctx.device.tap(ctx.serial, confirmPos[0], confirmPos[1])

  // 清除小红书数据
  ok = await checkUi(ctx, RID.appName, XHS_APP_NAME)
  if (!ok[0]) return false
  await ctx.device.tap(ctx.serial, ok[1]!, ok[2]!)
  await sleep(1000)
  const clearPos = await getSpinnerPosition(ctx, P.nextButton)
  if (clearPos) await ctx.device.tap(ctx.serial, clearPos[0], clearPos[1])

  for (let i = 0; i < 30; i += 1) {
    await sleep(1000)
    try {
      const xmlContent = await uiXml(ctx)
      const [found] = findUiElement(xmlContent, RID.setCardProperty, '')
      if (found) break
    } catch {
      // 旧版同样吞掉异常继续等。
    }
  }
  return true
}

/** 供流程层复用的导出（与旧模块同名语义）。 */
export const ONE_CLICK_INTERNALS = {
  BLUE_PACKAGE,
  BLUE_ACTIVITY,
  RID,
  P,
  XHS_APP_NAME,
  findUiElement,
  normalizeTextCandidates,
} as const

/**
 * 流程包装（旧 `One_click_new_device` 在 `_run_device_reset` 里被调用的方式）。
 *
 * 与旧行为一致：**整个新机是一个原子操作**，任一步失败即整体失败。
 * 所以这里只有一个 step，内部照旧代码顺序执行。
 */
export function createOneClickNewDeviceFlow(input: {
  brand?: string
  model?: string
  overseasRandom?: boolean
} = {}): import('@myt/flow').FlowDefinition {
  const brand = input.brand?.trim() ?? ''
  const model = input.model?.trim() ?? ''
  const overseas = input.overseasRandom ?? true
  const specified = Boolean(brand && model)
  return {
    id: 'xhs.device.one-click-new',
    title: specified ? `一键新机（${brand} ${model}）` : '一键新机（随机）',
    steps: [
      {
        id: 'one-click-new',
        title: '一键新机',
        // 旧版没有重试；这里也不加重试。
        async run(ctx) {
          const ok = await oneClickNewDevice(ctx, {
            deviceBrand: specified ? brand : null,
            deviceModel: specified ? model : null,
            overseasRandom: overseas,
          })
          if (!ok) throw new Error('一键新机失败: 超时或 UI 节点未找到')
          return '一键新机完成'
        },
      },
    ],
  }
}
