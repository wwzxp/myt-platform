import type { Random } from '@myt/human'
import type { ActionContext } from '../steps/actions.ts'
import { sleep } from '@myt/human'
import {
  getBirthYearPosition,
  getBirthMonthPosition,
  getBirthDayPosition,
  type PickerColumn,
} from '../locators/guide-locators.ts'

/**
 * 生日滚轮与随机生日（**1:1 移植**自 auto_login.py）。
 *
 * 参数必须原样：单次滑动上限 250px、步长 80、时长 `max(120, dist*0.9) ±[−40,60]`
 * 再夹到 [100,800]、每次滑动后 sleep 0.3s。
 */

/**
 * 生成随机成年生日（24–36 岁）。
 * 移植自 `generate_random_adult_birthday`：按天数跨度均匀取值。
 */
export function generateRandomAdultBirthday(random: Random, minAge = 24, maxAge = 36): {
  year: number
  month: number
  day: number
} {
  const today = new Date()
  const latest = new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate())
  const earliest = new Date(today.getFullYear() - maxAge, today.getMonth(), today.getDate())
  const [from, to] = earliest > latest ? [latest, earliest] : [earliest, latest]
  const spanDays = Math.floor((to.getTime() - from.getTime()) / 86_400_000)
  const chosen = new Date(from.getTime() + random.int(0, spanDays) * 86_400_000)
  return { year: chosen.getFullYear(), month: chosen.getMonth() + 1, day: chosen.getDate() }
}

/**
 * 滚动单列。
 *
 * 移植自 `scroll_picker_column`：
 * - 起点用该列的 **top**（不是中心）；
 * - `up` 时交换起止；
 * - 时长按距离算，再夹到 [100,800]。
 */
export async function scrollPickerColumn(
  ctx: ActionContext,
  column: PickerColumn | null,
  direction: 'up' | 'down',
  distance = 120,
): Promise<void> {
  if (!column) return
  const px = Math.floor(column.x)
  const step = Math.max(Math.floor(distance), 1)
  const top = column.bounds[1]
  let startY = top
  let endY = top + step
  if (direction === 'up') {
    const swap = startY
    startY = endY
    endY = swap
  }
  let duration = Math.max(120, Math.floor(Math.abs(endY - startY) * 0.9)) + ctx.random.int(-40, 60)
  duration = Math.max(100, Math.min(800, duration))
  await ctx.device.swipe(
    ctx.serial,
    { x: px, y: startY },
    { x: px, y: endY },
    duration,
  )
  await sleep(ctx.random.int(200, 400))
}

/**
 * 把三列滚到目标生日。
 *
 * 移植自 `scroll_birthdate_to`：
 * - 差值以「今天」为基准；
 * - 每列按 `|delta| * 80` 的总距离，单次最多 250px，每次滑完 sleep 0.3s。
 */
export async function scrollBirthdateTo(
  ctx: ActionContext,
  root: Parameters<typeof getBirthYearPosition>[0],
  target: { year: number; month: number; day: number },
  stepDistance = 80,
): Promise<{ yearSteps: number; monthSteps: number; daySteps: number }> {
  const today = new Date()
  const yearDelta = target.year - today.getFullYear()
  const monthDelta = target.month - (today.getMonth() + 1)
  const dayDelta = target.day - today.getDate()

  const yearPos = getBirthYearPosition(root)
  const monthPos = getBirthMonthPosition(root)
  const dayPos = getBirthDayPosition(root)

  const scrollDelta = async (column: PickerColumn | null, delta: number): Promise<void> => {
    if (!column || delta === 0) return
    const direction = delta > 0 ? 'up' : 'down'
    let remaining = Math.abs(delta) * stepDistance
    while (remaining > 0) {
      const distance = Math.min(remaining, 250)
      await scrollPickerColumn(ctx, column, direction, distance)
      remaining -= distance
      await sleep(300)
    }
  }

  await scrollDelta(yearPos, yearDelta)
  await scrollDelta(monthPos, monthDelta)
  await scrollDelta(dayPos, dayDelta)

  return { yearSteps: yearDelta, monthSteps: monthDelta, daySteps: dayDelta }
}
