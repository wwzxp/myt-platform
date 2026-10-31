/**
 * 拟人化操作（移植自 auto_login.py::HumanLikeOperator，行为参数原样保留）。
 *
 * 为什么必须用它而不是 `input tap`：旧项目在真机上验证过——小红的自定义控件
 * 对 `input tap`（瞬间按下抬起）不响应，必须用同点位的 `swipe`（按住 40–350ms）。
 * 见 shared-steps §5。
 */

/** 拟人化参数；默认值取自旧实现，可通过配置调整。 */
export interface HumanPolicy {
  /** 高斯偏移：均值与标准差（像素）。默认 1.5/4.0。 */
  offsetMeanX: number
  offsetMeanY: number
  offsetStdDev: number
  /** 偏移硬上限。默认 ±12。 */
  offsetClamp: number
  /** 按压时长分布（毫秒）。 */
  pressNormal: [number, number]
  pressQuick: [number, number]
  pressLong: [number, number]
  /** 打字 burst 长度与组间停顿。 */
  burstLength: [number, number]
  burstPauseMs: [number, number]
  /** 相邻点击的最小间隔与随机区间（毫秒）。 */
  tapGapFast: [number, number]
  tapGapNormal: [number, number]
  tapGapThink: [number, number]
  thinkChance: number
  /** 可注入种子，便于测试复现。 */
  seed?: number
}

export const DEFAULT_HUMAN_POLICY: HumanPolicy = {
  offsetMeanX: 1.5,
  offsetMeanY: 2.0,
  offsetStdDev: 4.0,
  offsetClamp: 12,
  pressNormal: [80, 150],
  pressQuick: [40, 80],
  pressLong: [250, 350],
  burstLength: [2, 5],
  burstPauseMs: [200, 500],
  tapGapFast: [80, 250],
  tapGapNormal: [300, 800],
  tapGapThink: [1000, 2500],
  thinkChance: 0.1,
}

/** 可复现的伪随机（xorshift32）；未给种子时用 Math.random。 */
export class Random {
  private state: number
  private readonly deterministic: boolean

  constructor(seed?: number) {
    this.deterministic = typeof seed === 'number'
    this.state = (seed ?? 0) | 0 || 0x9e3779b9
  }

  next(): number {
    if (!this.deterministic) return Math.random()
    let x = this.state
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.state = x | 0
    return (x >>> 0) / 0x100000000
  }

  uniform(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  int(min: number, max: number): number {
    return Math.floor(this.uniform(min, max + 1))
  }

  gauss(mean: number, stdDev: number): number {
    // Box–Muller
    const u1 = Math.max(this.next(), Number.EPSILON)
    const u2 = this.next()
    return mean + stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  }
}

export interface ClickPoint {
  x: number
  y: number
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/**
 * 计算拟人点击坐标（偏右下，模拟右手拇指），可被元素边界约束。
 * 移植自 `HumanLikeOperator.get_human_click_position`。
 */
export function humanClickPoint(
  random: Random,
  policy: HumanPolicy,
  point: ClickPoint,
  bounds?: [number, number, number, number],
): ClickPoint {
  const clamp = policy.offsetClamp
  const offsetX = Math.max(-clamp, Math.min(clamp, Math.round(random.gauss(policy.offsetMeanX, policy.offsetStdDev))))
  const offsetY = Math.max(-clamp, Math.min(clamp, Math.round(random.gauss(policy.offsetMeanY, policy.offsetStdDev))))
  let x = point.x + offsetX
  let y = point.y + offsetY
  if (bounds) {
    const [minX, minY, maxX, maxY] = bounds
    x = Math.max(minX + 3, Math.min(maxX - 3, x))
    y = Math.max(minY + 3, Math.min(maxY - 3, y))
  }
  return { x, y }
}

/** 按压时长加权：70% 正常、20% 快速、10% 长按。 */
export function pressDuration(random: Random, policy: HumanPolicy): number {
  const roll = random.next()
  if (roll < 0.7) return random.int(policy.pressNormal[0], policy.pressNormal[1])
  if (roll < 0.9) return random.int(policy.pressQuick[0], policy.pressQuick[1])
  return random.int(policy.pressLong[0], policy.pressLong[1])
}

/**
 * 相邻点击间隔：刚点过（<1s）就快速，小概率长停顿模拟思考。
 * 移植自 `tap_with_human_like` 的节奏控制。
 */
export function nextTapGap(random: Random, policy: HumanPolicy, sinceLastTapMs: number): number {
  if (sinceLastTapMs > 0 && sinceLastTapMs < 1000) {
    return random.int(policy.tapGapFast[0], policy.tapGapFast[1])
  }
  if (random.next() < policy.thinkChance) {
    return random.int(policy.tapGapThink[0], policy.tapGapThink[1])
  }
  return random.int(policy.tapGapNormal[0], policy.tapGapNormal[1])
}

/** 打字分组：把文本切成 2–5 字符的 burst。 */
export function splitBursts(random: Random, policy: HumanPolicy, text: string): string[] {
  const bursts: string[] = []
  let index = 0
  while (index < text.length) {
    const size = random.int(policy.burstLength[0], policy.burstLength[1])
    bursts.push(text.slice(index, index + size))
    index += size
  }
  return bursts
}

export { sleep }
