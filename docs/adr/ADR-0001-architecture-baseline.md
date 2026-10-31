# ADR-0001 架构基线

- 状态：已接受（2026-10-23）
- 决策者：用户 + 架构质询
- 影响范围：全项目

## 背景

要做魔云腾（MYT）云手机集群自动化平台：集成 SDK 全部能力、高并发、可扩展可插拔、以双击即用 exe 交付给客户。旧项目 `auto_object` 功能可用但架构失效（`main.py` 15,452 行、`MainWindow` 单类约 1.1 万行、每 job 一个子进程且并发上限 2、状态只在 GUI 内存、四份同构复制）。架构基座定为 DeepSeek Harness（dsh）。

## 决策

### D1 产品是确定性自动化平台，不是 LLM agent

业务流程由确定性步骤组成（选择器、动作、断言、重试），不引入模型决策链。

- 依据：用户明确「旧项目里的 AI 功能是废弃的」，且核心流程已在真机上验证可用。
- 后果：不挂载 dsh 的 `agent-loop` / `llm` / `system-prompt` / `tools` / `compaction`；「step」的语义是设备动作而非模型请求。

### D2 基座 = TypeScript + Cordis，只取装配层

直接依赖 dsh 的插件运行时与装配机制，业务全部写成插件：

| 依赖 | 版本 | 用途 |
|---|---|---|
| `@deepseek-ai/cordis` | `~4.0.5` | Context / Service / effect / 事件 |
| `cordis-plugin-loader` / `cordis-plugin-include` | 同代 | 按 yml 装配插件树 |
| `@deepseek-ai/dsh-app-boot` | `0.2.1-rc.2` | profile / bundle / patch 分层 |
| `@deepseek-ai/dsh-plugin-manager` | 同代 | 可选；v1 不挂 |

不依赖 `@deepseek-ai/dsh` 聚合包（86 个依赖，含全部 agent 能力）。

- 依据：dsh 拆分为 80+ 独立 npm 包，`dsh-sdk-minimal` 已验证「一个 bundle 自带完整显式依赖树、不挂 dsh-base」的模式可行。
- 风险：`0.2.1-rc.2` 为 RC，仓库声明 *Public APIs are pre-stable*。应对：锁定精确版本、封装单一薄适配层、不追 master。
- 后果：不 fork 源码；如需改 dsh 行为，优先走其扩展点。

### D3 交付形态 = Electron 桌面壳 + 静态前端

- Electron 主进程 = 启动器 + Host；打包后的前端静态资源走 `extraResources`；内核如需崩溃隔离跑 `utilityProcess`。
- 工程范式照 `WeChatDataAnalysis`：单实例锁、端口协商、`/api/health` 轮询、stdio 日志、托盘、关闭行为可配、开机自启、`electron-updater`、NSIS。
- 验收对象是**打包产物**（冒烟脚本直接起 `dist/win-unpacked`）。
- 依据：客户机需双击即用；国内浏览器内核老旧，Electron 自带 Chromium 是稳定性优势。
- 代价：包体 150–250MB；必须代码签名，否则 SmartScreen 拦截。

### D4 插件模型 = A′ 编译期烘焙（保留 dsh 装配机制）

- v1 插件随 exe 发布（monorepo workspace 包），通过自己的 bundle + profile 在启动时装配；不接插件市场、不开运行时安装。
- 「按客户裁剪功能」用 profile + 能力门控解决。
- 将来若开放第三方插件，唯一可接受形态是**独立进程 + seam 白名单 RPC**；不采用 dsh「同进程 npm 包」模型。
- 依据：dsh 插件是具备 Host 全权限的 npm 包（`plugin-manager` 通过 pnpm 安装，无沙箱）。在设备农场场景，一个恶意插件等于交出全部设备、账号与代理凭据。

### D5 并发基线

| 维度 | 目标 |
|---|---|
| 主机 | 1–10 台魔云腾宿主，每主机独立连接池与限流器 |
| 在线容器 | 200（UI 需虚拟滚动 + 增量状态推送） |
| 同时执行 | 50（受主机磁盘/网络与 ADB 并发限制） |
| 水平扩展 | 预留：调度器与设备连接分离，将来可多节点 |

- 依据：用户确认；旧项目 `max_concurrent=2` + 进程级并发是硬天花板。
- 后果：设备内动作串行（每设备 actor），设备间并发；限流分三层（主机重型作业 / 每容器状态变更 / 文件 I/O 池）。

### D6 v1 第一个切片 = 全链路最小闭环（Slice A）

范围：内核骨架 → MYT 主机/容器接入 → 设备列表 UI → 批量启动/停止容器 + 截图 → 打成 exe。

- 依据：让「装配机制、SDK 适配、UI、打包签名」四个未知量在同一切片各验证一次。
- 明确不做：业务 flow、账号体系、代理池、多节点。

### D7 v1 功能范围 = 复刻三个标签页

产品只交付旧 `auto_object` 中已验证可用的三个标签页，其余标签页不在范围内。

| 标签页 | 旧实现落点 | 说明 |
|---|---|---|
| 上号器 | `xhs_device_tab/device_tab.py` + worker/dispatcher/models + `auto_login.py` | 设备连接、账号导入、批量登录、新机、代理、绑定 |
| 笔记发布 | `auto_fb/wz_device_tab.py` + `wz_worker/dispatcher/models` + `auto_fb.py` | 素材 + 文案 → 发布 → 验证 |
| 评论（截流） | `main.py::_create_throttle_tab` + `auto_jl_new/throttle_*` | 关键词选笔记 → 发评论，含频率与去重 |

**不在范围**：数据采集/爬虫、AI 分析、私信获客、批量 @、制图、养号、卡密以外的商业化。

- 依据：用户明确「目前开放的就只有这三个」，且这三条流程在真机上验证可用。
- 后果：业务插件的划分按标签页聚合，不做通用流程市场；旧代码里其他标签页仅在需要复用时参考。

## 备选方案与否决理由

| 方案 | 否决理由 |
|---|---|
| Python 复刻 dsh 架构 | Cordis 的依赖追踪、可撤销 effect、waterfall、HMR 需自研，产出「形似」内核 |
| TS 内核 + Python 设备 sidecar | 多一条进程边界与协议；旧 Python 资产按能力切片移植更可控 |
| Node SEA + 系统浏览器 | UI 依赖客户浏览器内核，国内环境风险高 |
| 直接 fork dsh 全仓 | 上游 RC 快速迭代，merge 成本持续存在；且大部分包（agent/llm/tools）与我们无关 |
| dsh 原样运行时插件 + 市场 | 插件拥有完整权限，设备农场场景不可接受 |

## 待定（后续 ADR）

- **工作假设（未确认，可推翻）**：发布/评论的「成功」改为可验证断言——发布前后比对笔记增量，评论后回查列表；默认开启，可配置关闭。若否决，改为保留旧行为（面板消失即成功）。
- 领域模型：主机 / 容器 / 设备 / 账号 / 代理 的实体与归属关系（设备与账号已定，代理待定）
- 持久化：事件日志存储（SQLite WAL vs 单写）、保留期、投影
- UI 信息架构：页面清单与交互
- 业务插件边界：一个 flow 包的粒度与复用方式
- 分发：离线/内网安装与更新源

## 参考

- `docs/reference/deepseek-harness-architecture.md`
- `docs/reference/myt-sdk-openapi.md`
- `docs/reference/auto-object-legacy.md`
- `docs/reference/wechat-data-analysis-desktop.md`
