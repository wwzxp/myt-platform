import type { UiNode, UiSnapshot } from '@myt/device'

/**
 * 定位策略：`id > text > desc > class > path`，前四者为命名策略，
 * `path` 是层级下标，只允许作为最后兜底（shared-steps §4）。
 */
export type LocatorKind = 'id' | 'text' | 'desc' | 'class' | 'path'

export interface Locator {
  kind: LocatorKind
  value: string | number[]
  /** 命中后校验节点 class；不匹配视为未命中。 */
  requireClass?: string
  /** 节点必须可点击。 */
  requireClickable?: boolean
  /** 按序尝试的备用策略。 */
  fallbacks?: Locator[]
}

export interface LocatorHit {
  node: UiNode
  /** 实际命中的策略，用于事件记录「是否用了兜底」。 */
  matchedBy: LocatorKind
  /** 是否为兜底策略（`path` 或 fallbacks 中非首项）。 */
  fallback: boolean
}

function findAll(root: UiNode, predicate: (node: UiNode) => boolean, out: UiNode[] = []): UiNode[] {
  if (predicate(root)) out.push(root)
  for (const child of root.children) findAll(child, predicate, out)
  return out
}

function byPath(root: UiNode, path: number[]): UiNode | null {
  let current: UiNode | undefined = root
  for (const index of path.slice(1)) {
    current = current.children[index]
    if (!current) return null
  }
  return current ?? null
}

function matches(node: UiNode, locator: Locator): boolean {
  if (locator.requireClass && node.className !== locator.requireClass) return false
  if (locator.requireClickable && !node.clickable) return false
  switch (locator.kind) {
    case 'id':
      return node.resourceId === locator.value
    case 'text':
      return node.text === locator.value
    case 'desc':
      return node.contentDesc === locator.value
    case 'class':
      return node.className === locator.value
    case 'path':
      return true
  }
}

/** 在快照里按单条策略查找；`path` 策略直接按层级取。 */
export function find(snapshot: UiSnapshot, locator: Locator): LocatorHit | null {
  if (locator.kind === 'path') {
    const path = Array.isArray(locator.value) ? locator.value : []
    const node = byPath(snapshot.root, path)
    if (!node) return null
    if (locator.requireClass && node.className !== locator.requireClass) return null
    return { node, matchedBy: 'path', fallback: true }
  }
  const hits = findAll(snapshot.root, (node) => matches(node, locator))
  const node = hits[0]
  if (!node) return null
  return { node, matchedBy: locator.kind, fallback: false }
}

/** 按「首策略 → fallbacks」顺序查找，返回第一个命中。 */
export function locate(snapshot: UiSnapshot, locator: Locator): LocatorHit | null {
  const first = find(snapshot, locator)
  if (first) return first
  for (const fallback of locator.fallbacks ?? []) {
    const hit = find(snapshot, fallback)
    if (hit) return { ...hit, fallback: true }
  }
  return null
}

/** 节点中心点，用于点击。 */
export function center(node: UiNode): { x: number; y: number } {
  const [x1, y1, x2, y2] = node.bounds
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) }
}

/** 节点的可读摘要，写入事件便于事后排查。 */
export function describe(node: UiNode): string {
  const text = node.text || node.contentDesc || ''
  return `<${node.className}>${text ? ` "${text}"` : ''}${node.resourceId ? ` #${node.resourceId}` : ''}`
}
