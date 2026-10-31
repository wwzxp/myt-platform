# LLM 页面定位实验报告

实验目标：验证「步骤意图由人写、坐标由模型现算」这条路线的可行性，并选出最优模型。

数据：真实抓取的两页
- `data/yadb-layout.xml` — 小红书手机号登录页，27 节点 / 12 有用
- `data/dump-setting.xml` — 小红书首页，83 节点 / 36 有用

用例：每页 20 个意图，人工标注期望节点（含 `alsoOk` 备选，语义模糊时两者都算对）。
判定：坐标 `hitTest` 命中期望节点才算对；命中时优先返回**可点击**节点（Android 事件冒泡）。

---

## 1. 压缩树 vs 完整 XML

| 模式 | 登录页 tokens | 首页 tokens | deepseek 准确率 |
|---|---|---|---|
| 压缩树 | ~354 | ~1100 | 100% / 95% |
| 完整 XML | ~3500 | ~9950 | 95% / 未测 |

**结论**：完整 XML 对云端无损但也无增益；对小模型显著变差（1.7B：75% → 60%/35%）。
**压缩是必需的，不是妥协**——它去掉了 90% 的噪声属性。

## 2. 字段消融（deepseek-flash，首页 36 节点）

| 字段组合 | 准确率 | 输入字符 |
|---|---|---|
| base（text/desc/bounds/clickable/class） | **95%** | 1884 |
| +resource-id | 95% | 2727 |
| +scrollable | 95% | 1884 |
| +long-clickable | 95% | 1938 |
| +selected/checked/focused | 95% | 1908 |
| **-class** | **90%** | 1435 |
| 全开 | 95% | 2805 |

**结论**：`class` 是唯一必需字段；其余全部可丢。`resource-id` 无价值
（小红书全混淆成 `0_resource_name_obfuscated`）。

## 3. 提示词变体

| 变体 | deepseek | qwen3:1.7b | MiniCPM 1B |
|---|---|---|---|
| plain | 95% | 75% | 75% |
| role（角色设定） | 95% | — | — |
| rules（规则清单） | 95% | 75% | — |
| **fewshot** | 95% | 80% | **90%** |
| textonly（只答文字） | — | 85% | — |
| hybrid（index+text+坐标） | — | **35%** | — |

**结论**：
- 云端已饱和，提示词零增益
- 小模型靠 fewshot 提升 5-15pt
- **绝不能让小模型同时输出三类信息**（1.7B 崩到 35%）
- fewshot 里最关键的一句：「不可点文字被可点节点包住时，选可点的那个」

## 4. 模型对比（全部实测）

| 模型 | 体积 | 登录页 | 首页 | 延迟 | JSON 合法率 |
|---|---|---|---|---|---|
| **deepseek-flash（云）** | — | **100%** | **95%** | **160ms** | 100% |
| **d1（决策模型）** | 3.7GB | **85%** | 70% | 9s / 21.6s | 100%（无生成） |
| **MiniCPM-V 4.7 1B** | 0.67GB | 75% | **90%** | 2.5s | 100% |
| gemma4:e2b | 4.6GB | 80% | 80% | 3.1s | 100% |
| qwen3:1.7b | 1.4GB | 85% | 75-80% | 2.9s | 100% |
| lfm3-omni | 2.1GB | 70% | 65% | 5.5s | — |
| lfm3 | 1.1GB | 65% | — | 8.2s | 90% |
| qwen3:0.6b | 0.5GB | 70% | 40% | 2.3s | 100% |
| gemma3:1b | 0.8GB | 35% | — | 2.4s | — |

## 5. d1 决策模型的特殊性

`d1`（Liquid AI，3B，基于 LFM2.5-VL）**不是聊天模型**：

```json
// 请求 /v1/systemone
{"model":"d1","state":"<UI 树 + 意图>",
 "questions":{"target":{"type":"choice","criteria":{"1":"...","2":"..."}}}}

// 返回
{"answers":{"target":{"choice":"2","confidence":0.97,
  "probabilities":{"1":0.009,"2":0.981,"3":0.010}}},
 "usage":{"input_tokens":119,"output_tokens":0}}
```

| 特性 | 价值 |
|---|---|
| `output_tokens: 0` | **不可能 JSON 崩溃**（这是小模型最大痛点） |
| 输出概率分布 | **能识别自己的不确定** |
| 单次前向 | 无 thinking 开销 |
| 支持 text+image 混合 state | 可同时喂 UI 树和截图 |

**置信度门控实测（首页 36 节点）**：

| 策略 | 覆盖 | 准确率 |
|---|---|---|
| 全部接受 | 20/20 | 70% |
| conf ≥ 0.5 | 13/20 | **100%** |

**6 个失败用例全部 conf < 0.5** —— 模型知道自己在猜。

代价：延迟 21.6s（36 候选逐项打分）。登录页 12 候选时 9s。

## 6. 环境踩坑记录

| 坑 | 现象 | 解法 |
|---|---|---|
| **qwen3/lfm3 默认开思考** | content 为空（全在 `reasoning` 字段），延迟 24s | `reasoning_effort: 'none'` → 1.1s（22 倍） |
| **ModelScope 单连接限速** | 100KB/s，19.9GB 要 55 小时 | 32 路并行 → **11MB/s**（110 倍），28 分钟完成 |
| **registry.ollama.ai 单连接** | 16KB/s | 同上并行下载 |
| **ollama blob 被污染** | 测速时用 `-o` 写了 1MB 到 blob 路径，pull 以为续传完成 | 用完整文件覆盖同路径 |
| **35B-A3B Q4 跑不动** | 19.9GB 模型 vs 10GB 物理可用 + 5.9GB commit 可用 | 需扩页面文件（管理员+重启），暂搁置 |
| **`ollama create` 模型名不能带 `.`** | `minicpm-v4.7:1b` 报 invalid model name | 用 `minicpm47:1b` |

## 7. 推荐架构

```
固定定位器命中  → 直接执行（0 成本，覆盖 90%+）
        ↓ miss
deepseek-flash  → 定位（95-100%，160ms，成本 ~¥0.0001/步）
        ↓ 网络不可用
MiniCPM-V 1B    → 本地兜底（75-90%，2.5s，0 成本）
        ↓ 置信度 < 0.5 或需要看截图
d1 决策模型     → 打分（conf ≥ 0.5 时 100% 准确，可拒判）
        ↓ 仍不确定
视觉模型看截图  → 人工规则最后兜底
```

**核心设计**：`d1` 的价值不是准确率，而是**知道自己不知道**。
conf < 0.5 时转下一级，避免「自信地点错按钮」。

## 8. 复现方式

```bash
# 实验脚本
npx tsx .tmp/llm-locate-experiment.mts <model> <login|home> <compact|raw> <base|rid|all|...> <plain|fewshot|textonly|hybrid>
npx tsx .tmp/d1exp.mts <login|home>

# 正式模块
packages/device/device/src/ui-compact.ts        # 压缩 + hitTest
packages/device/device/src/ui-locate-prompt.ts  # 提示词 + 解析
```
