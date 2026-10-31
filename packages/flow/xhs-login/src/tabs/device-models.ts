/**
 * 机型库（迁移自 `auto_object/tools/myt_devices.py` + `static/devices.json`）。
 *
 * 旧版从本地 JSON 读品牌→型号映射，**不调 SDK**：
 * ```
 * { "HONOR": { "AKA-AL10": {...}, ... }, "HUAWEI": {...}, "global_id": 39 }
 * ```
 * 只保留「值是对象」的键作为品牌，像 `global_id` 这种标量字段自动跳过。
 */

import { readFile } from 'node:fs/promises'

/** 品牌 → 型号列表。 */
export type BrandModels = Record<string, string[]>

/**
 * 读取并规整机型库。
 *
 * 文件缺失或损坏时返回空对象（旧版会弹「加载品牌列表失败」，这里由调用方决定提示）。
 */
export async function loadBrandModels(file: string | undefined): Promise<BrandModels> {
  if (!file) return {}
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object') return {}

  const result: BrandModels = {}
  for (const [brand, value] of Object.entries(parsed as Record<string, unknown>)) {
    // 旧 `load_device_brand_model_map`：`if isinstance(model_data, dict)`
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    result[brand] = Object.keys(value as Record<string, unknown>).sort()
  }
  return result
}

/** 品牌列表（按名称排序，与旧版 `sorted(brand_list)` 一致）。 */
export function brandsOf(models: BrandModels): string[] {
  return Object.keys(models).sort()
}
