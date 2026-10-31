import type { Random } from '@myt/human';
import type { ActionContext } from '../steps/actions.ts';
import { getBirthYearPosition, type PickerColumn } from '../locators/guide-locators.ts';
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
export declare function generateRandomAdultBirthday(random: Random, minAge?: number, maxAge?: number): {
    year: number;
    month: number;
    day: number;
};
/**
 * 滚动单列。
 *
 * 移植自 `scroll_picker_column`：
 * - 起点用该列的 **top**（不是中心）；
 * - `up` 时交换起止；
 * - 时长按距离算，再夹到 [100,800]。
 */
export declare function scrollPickerColumn(ctx: ActionContext, column: PickerColumn | null, direction: 'up' | 'down', distance?: number): Promise<void>;
/**
 * 把三列滚到目标生日。
 *
 * 移植自 `scroll_birthdate_to`：
 * - 差值以「今天」为基准；
 * - 每列按 `|delta| * 80` 的总距离，单次最多 250px，每次滑完 sleep 0.3s。
 */
export declare function scrollBirthdateTo(ctx: ActionContext, root: Parameters<typeof getBirthYearPosition>[0], target: {
    year: number;
    month: number;
    day: number;
}, stepDistance?: number): Promise<{
    yearSteps: number;
    monthSteps: number;
    daySteps: number;
}>;
//# sourceMappingURL=birthday.d.ts.map