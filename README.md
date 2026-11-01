# myt-platform

**安卓自动化平台**：把「取界面 → 判断在哪一页 → 找到目标 → 执行 → 校验」这件事
做成一套可编排、可观测、换 App 只换配置的运行时。

> 状态：活跃开发中。核心引擎与小红书发布流程可用，UI 与文档仍在补齐。

---

## 这是什么

一个跑在你自己机器上的安卓自动化引擎，特点是：

| 特点 | 说明 |
|---|---|
| **引擎不认识具体 App** | 包名、页面表、定位器、恢复规则全由业务包注入；换抖音/快手只写业务包，引擎不动 |
| **页面前置检查** | 每一步动作前先确认「自己在哪个界面」，不在就等待或走恢复，而不是盲点 |
| **页面识别是多级判据** | Activity 名 → XML 属性 → 界面文字 → 关键词加权 → 跨语言对齐 → 截图读字，逐级降级 |
| **流程是图不是脚本** | 画布上编辑节点与连线，失败/重试/分支都是可见的边，不是函数里的 `for` 循环 |
| **动作原语化** | 没有「黑盒动作」；每个节点只做一件事，参数是界面上看得见的文字或坐标 |
| **本地模型可选** | 页面识别兜底、文字定位可接本地小模型；模型不可用时流程照常按确定性路径跑 |

---

## 快速开始

### 环境

| 项 | 版本 |
|---|---|
| Node.js | ≥ 22（用到 `Promise.withResolvers`、ESM `--import`） |
| pnpm | 9.x（仓库锁定 `pnpm@9.15.9`） |
| Android | 真机或魔云腾容器，开启 ADB 调试 |

```bash
pnpm install
```

### 起内核 + 画布

```bash
pnpm dev:canvas
```

它会同时启动：

- `http://127.0.0.1:7788` — 内核（流程执行、设备、页面表）
- `http://127.0.0.1:3000` — 画布前端（静态托管 + `/api` 反向代理）

浏览器打开 `http://127.0.0.1:3000/?flow=发布图文笔记.json` 即可编辑流程。

### 连设备

```bash
adb connect 127.0.0.1:5565      # 或你的容器端点
adb devices                      # 确认是 device 状态
```

内核通过 `MYT_HOSTS` 连魔云腾宿主；只想直连 ADB 时留空即可。

### 构建

```bash
pnpm typecheck        # tsc --noEmit
pnpm build:host       # tsc -b + tsdown，产物在 packages/*/lib
pnpm dev:desktop      # 构建并启动 Electron 壳
```

---

## 目录结构

```
packages/
  core/         推理与流程内核（flow 步骤模型、runs 运行记录、workflows 存储）
  device/       设备能力接缝：DeviceControl（抽象）+ device-adb（实现）
  automation/   安卓自动化引擎：页面表、定位、动作节点、图执行
  flow/         业务包（flow-xhs 上号 / flow-xhs-publish 发布）
  myt/          魔云腾宿主能力（api-v2 / api-v3 / host）
  client/       画布前端（React + Flowgram）
  app/          desktop-host（内核进程）与 desktop（Electron 壳）
apps/           cli / web
vendor/         cordis 等内联依赖
docs/           架构与实测文档
data/          运行时数据（不入库）：流程 JSON、设备表、对齐表缓存
```

**依赖方向**：`automation → flow → device`。
引擎与业务解耦，业务包之间也解耦——删掉任一业务包不影响其余。

---

## 核心概念

| 术语 | 含义 |
|---|---|
| **页面表** | 业务定义的「有哪些界面、各自怎么认」：Activity 特征 + 界面关键词 |
| **页面识别** | 多级判据逐层降级，认不出就报 `unknown`，绝不瞎猜 |
| **动作节点** | 图上的一个原子操作：点击/输入/滑动/等待/跳转/等页面/等元素/选图 |
| **条件节点** | 真/假分支：页面是、元素存在、参数非空、应用已装、文件存在 |
| **运行** | 一次流程在某一设备上的执行实例，可断点续跑 |
| **恢复规则** | 已知异常页面 → 预定义动作（如权限弹窗点「允许」） |

完整术语见 [`CONTEXT.md`](CONTEXT.md)。

---

## 页面识别怎么工作

```
Activity.markers 命中            → 毫秒级定案
    ↓ 认不出
XML 属性匹配（class/selected…）  → 同一份快照，零额外开销
    ↓ 认不出
contentMarkers（要求全中）
    ↓ 认不出
界面关键词加权（词长权重，须领先）
    ↓ 认不出
跨语言对齐表翻译后再匹配          → 英文/日文界面对中文词表
    ↓ 认不出
截图 → 视觉模型读字 → 同一套关键词
    ↓ 认不出
自动补对齐表（只补缺失词，落盘缓存）
    ↓
unknown（交等待 / 重试 / 人工补规则）
```

设计取舍与实测数据见 [`docs/spec/page-identify-design.md`](docs/spec/page-identify-design.md)。

### 关键词怎么选

| 规则 | 说明 |
|---|---|
| 选**独有**词 | 「实况图」>「照片」>「全部」 |
| 每页 ≥2 个 | 互相印证 |
| 容错 | 写「草稿箱」同时容忍 OCR 读成「算辑箱」 |
| 别填泛词 | 「确定」「下一步」几乎每页都有 |

页面表里有「采集」按钮：让设备停在目标页，点一下就能自动统计出该页独有词。

---

## 动作原语

图上每个节点只做一件事，参数是**界面上看得见的文字或坐标**——没有「自定义动作」这种黑盒。

| 类别 | 原语 |
|---|---|
| 定位动作 | 点击（按文字/比例/坐标）、输入文字 |
| 设备动作 | 滑动、按返回键、打开链接、设备命令 |
| 等待 | 等待、等页面出现、等元素出现 |
| 文件/应用 | 推送文件、推送到相册、安装应用、启用输入法 |
| 业务 | 按数量选图 |

**通用后置字段**（所有节点）：

| 字段 | 用途 |
|---|---|
| 前置页面 | 不在这些页面就走「页面不对」出口 |
| 执行后等待 | 完成后随机等待，避免操作过快 |
| 失败重试次数 / 重试间隔 | 失败自动重跑，实现只有一处 |

---

## 本地模型（可选）

页面识别兜底与文字定位可以接本地小模型，**不接也能跑**。

```bash
# 用 ollama 自带的 llama-server（主线 llama.cpp 未必支持某些投影层）
ollama/lib/ollama/llama-server.exe \
  -m <模型.gguf> --mmproj <投影层.gguf> \
  --load-mode mmap -nr -t 12 -ngl 0 -c 2048 -b 2048 -ub 1024 -fa on \
  --host 127.0.0.1 --port 8094
```

关键参数：

| 参数 | 为什么要 |
|---|---|
| `--load-mode mmap` | ollama 在纯 CPU 模式默认关 mmap，会让 20GB 模型要求 20GB 连续内存 |
| `-nr` | 关闭权重重排，省下约 18GB 的额外缓冲 |
| `-t 12` | 拉满逻辑核；实测比 `-t 8` 快一倍 |

实测数据与踩坑清单见 [`docs/reference/local-model-runbook.md`](docs/reference/local-model-runbook.md)。

---

## 开发

```bash
pnpm dev:canvas       # 内核 + 画布（开发最常用）
pnpm typecheck        # 全仓类型检查
npx vitest run        # 测试（自动化引擎 56 个用例）
```

**改完内核代码后**：内核跑的是 `packages/*/lib/index.js`（tsdown 产物），
只跑 `tsc -b` 不会更新它——需要 `pnpm build:host` 并重启 `dev:canvas`。

---

## 文档

| 文档 | 内容 |
|---|---|
| [`CONTEXT.md`](CONTEXT.md) | 术语表（唯一术语源） |
| [`INDEX.md`](INDEX.md) | 文件索引与变更记录 |
| [`docs/spec/page-identify-design.md`](docs/spec/page-identify-design.md) | 页面识别方案定稿 |
| [`docs/spec/page-identify-experiment.md`](docs/spec/page-identify-experiment.md) | 本地模型实测数据 |
| [`docs/reference/local-model-runbook.md`](docs/reference/local-model-runbook.md) | 本地模型启动手册 |
| [`docs/reference/deepseek-harness-architecture.md`](docs/reference/deepseek-harness-architecture.md) | 参考架构（dsh） |

---

## 参考与致谢

架构参考 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）：
插件化 Context、能力接缝、append-only 事件日志。
插件运行时基于 [Cordis](https://github.com/shigma/cordis)。

---

## 许可证

[Apache-2.0](LICENSE)
