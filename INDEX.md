# 项目索引：myt_tools

云手机（魔云腾 MYT）自动化平台。目标：集成 MYT SDK 全部能力，做成高并发、可扩展可插拔的程序；架构借鉴 DeepSeek Harness，业务与 UI 升级自旧项目 auto_object。

## 目录结构

| 路径 | 用途 |
|---|---|
| `INDEX.md` | 本文件，项目导航与变更记录 |
| `CONTEXT.md` | **唯一术语源**：领域实体、执行模型、架构名词、禁用同义词 |
| `STYLE.md` | 代码风格与工程约定：命名、注释、错误处理、生命周期、测试、Git |
| `COLLAB.md` | 协作约定：与用户协作时的工作方式硬规则（遇障碍报告、不许改写标准做法等） |
| `docs/plan/` | 实施计划与验收标准 |
| `docs/plan/slice-a-acceptance.md` | 切片 A 验收标准（草案，待确认） |
| `docs/spec/runtime-and-storage.md` | 数据平面、事件模型、投影、产物存储、保留策略、分发与更新 |
| `docs/spec/ui-information-architecture.md` | UI 信息架构提案：9 个路由、设备农场、任务中心、新建任务向导、旧控件对照表 |
| `docs/spec/shared-steps.md` | 三个标签页共用的步骤原语：设备就绪、定位器、动作、等待、断言、限流、错误分类 |
| `docs/spec/legacy/` | 旧项目三个标签页的逐按钮功能规格（复刻依据） |
| `docs/spec/legacy/login.md` | 上号器：22 步登录、5 种登录源、状态机、缺陷清单 |
| `docs/spec/legacy/publish.md` | 笔记发布：20 步发布流程、9 列契约、不可重试点 |
| `docs/spec/legacy/comment.md` | 评论/截流：17 步评论链路、风控参数表、新旧引擎差异 |
| `docs/reference/` | 外部与现状参考资料（只读事实，不含设计决策） |
| `docs/reference/myt-sdk-openapi.md` | 魔云腾 SDK OpenAPI 审计：端点、寻址、鉴权、错误码、并发分层 |
| `docs/reference/deepseek-harness-architecture.md` | dsh 架构事实 + 可移植/不可移植判断 |
| `docs/reference/auto-object-legacy.md` | 旧项目 auto_object 现状、体量、痛点、可复用资产 |
| `docs/reference/wechat-data-analysis-desktop.md` | WeChatDataAnalysis 的 Electron 交付工程与 UI 范式参考 |
| `docs/adr/` | 架构决策记录（ADR），每条决策含依据、备选与否决理由、后果 |
| `docs/adr/ADR-0001-architecture-baseline.md` | 架构基线：定位、基座、交付、插件模型、并发、v1 切片 |
| `docs/adr/ADR-0002-device-identity.md` | 设备身份与实体模型：平台 UUID 主键、重装/克隆/unreachable 语义 |
| `reference/` | 外部源码检出目录（只读参考，不参与构建） |
| `reference/deepseek-harness-master/` | dsh 源码（master tarball 解压，只读参考；软链接文件在 Windows 下未展开） |
| `resources/sdk/` | SDK 原始资源快照 |
| `resources/sdk/openapi_20261023_141219.json` | MYT OpenAPI 3.0.2 原始快照（195 操作） |
| `package.json` / `pnpm-workspace.yaml` / `tsconfig.json` | pnpm workspace 根配置，Node 22 + tsx 直跑 TS |
| `packages/myt/myt-host/` | 宿主能力接缝的**服务定义**（`MytHost` 抽象类 + 类型 + Context 声明合并） |
| `packages/myt/myt-api-v2/` | v2 SDK（7878）Provider：协议适配与字段收敛 |
| `packages/core/devices/` | 设备登记与对账：`ctx.devices`，容器 id → 平台 `DeviceId`，墓碑与状态文件 |
| `packages/core/runs/` | `ctx.runs` 运行事件流：追加事件、错误分类、checkpoint、中断标记 |
| `packages/core/webserver/` | **HTTP 路由插件**（`@myt/webserver`，服务键 `ctx.http`）：只做监听/分发/CORS/JSON/错误收敛，**不认识任何业务**；精确路由优先于前缀路由；插件在 `[Service.init]` 里自己注册 |
| `packages/core/workflows/` | **流程持久化插件**：`WorkflowStore` 一图一文件，文件名=流程名、id 在内容里；支持列表/读/存/新建/改名/复制/删除；用户可在资源管理器直接操作文件 |
| `packages/core/flow/` | `ctx.flows` 流程注册表 + `FlowRunner`：步骤跳过/重试/分类/断点续跑 |
| `packages/device/device/` | 设备能力接缝定义（dump/tap/swipe/text/back/screenshot/深链/forceStop/connect） |
| `packages/device/device-adb/` | ADB 直连 Provider：uiautomator 解析、ADBKeyboard 输入、connect |
| `packages/device/locator/` | 定位器：id/text/desc/class/path 多策略 + fallback 记录 |
| `packages/device/human/` | 拟人化原语：高斯偏移、按压时长分布、burst 打字、点击节奏（可注入种子） |
| `packages/flow/flow-xhs/src/paths.ts` | 层级路径工具：`nodeAtPath` / `Point` / `BoundedPoint` |
| `packages/flow/flow-xhs/src/locators.ts` | **1:1 移植**的定位函数（12 个，路径数组与旧实现逐条一致） |
| `packages/flow/flow-xhs/src/state-locators.ts` | 需读状态的定位：区号列表、重发按钮、聚焦输入、账号下线、加载转圈、安全验证 6 宫格 |
| `packages/flow/flow-xhs/src/dialogs.ts` | 弹窗定位：生日 Next、Skip、风险插件、See original、Later |
| `packages/flow/flow-xhs/src/actions.ts` | 动作原语：清空输入、拟人输入（5 次重试+回读）、等转圈、连点 |
| `packages/flow/flow-xhs/` | 小红书流程包：包名、深链常量、探测流程、手机号登录准备流程 |
| `packages/app/desktop-host/` | **宿主入口**：`src/host.ts` 读 `MYT_*` 环境变量、装配 `profile/myt`、向 Electron 父端口上报；`src/startup.ts` 是 utilityProcess 执行入口；不含业务逻辑 |
| `profile/myt/cordis.patch.yml` | **装配清单**：YAML 声明式列出全部插件与配置；加功能是加一行条目，不改启动器 |
| `packages/core/system-api/` | 系统类 HTTP（`@myt/system-api`）：`/api/health`、`/api/data-dir`、`/api/hosts`、`/api/containers`、`/api/flows` |
| `packages/device/device-api/` | 设备类 HTTP（`@myt/device-api`）：`/api/devices`、`/api/actions/{start,stop}`、`/api/device/{connect,dump,tap}` |
| `packages/flow/xhs-api/` | 短信平台 HTTP（`@myt/xhs-api`）：`/api/herosms/{balance,countries,prices,activations,cancel}`；API Key 由请求体传入不落盘 |
| `packages/flow/xhs-pack/` | 业务包装配（`@myt/xhs-pack`，服务 `ctx.xhsPack`）：注册 `xhsDevicePack`/`xhsPack`/`xhsPublishPack` 三个流程包到 `ctx.flows`；暴露 15 个 UI 动作与链配方；提供识图（LLM）与 S5 代理两个宿主能力 |
| `packages/flow/xhs-login/src/chain-runner.ts` | 链执行器：`runChain` 递归跑完整条链（登录 → 改资料 → 绑定 → 关注 → 收尾），成功按配方推进、失败终止；`buildParams` 拼参数、`loginParamsOf` 处理 HeroSMS 分支 |
| `packages/flow/xhs-login/` | 登录域（`@myt/xhs-login`）：11 个 `/api/tabs/login/*` + `/api/devices/models` + `/api/accounts/import`；`src/tabs/` 是 11 个纯函数模块，`src/batch-login.ts` 是编排层，`src/pre-step.ts` 是前置动作 |
| `packages/core/task-api/` | flowgram 运行时（`@myt/task-api`）：`/api/task/{validate,run,report,result,cancel}` + `/api/accounts/parse-sms` |
| `packages/core/runs-api/` | 运行记录（`@myt/runs-api`）：`/api/runs`（GET 列表/POST 创建）、`/api/runs/<id>` |
| `packages/app/desktop/` | Electron 壳：单实例、端口协商、健康检查、托盘、窗口生命周期；`build/icon.ico` |
| `packages/client/ui/` | **旧 UI（保留但隐藏）**：设备农场页面（单文件 HTML，无构建步骤）；不再挂路由 |
| `packages/client/app/` | **新 UI**（`@myt/ui-app`）：基于 `bytedance/flowgram.ai` 完整 demo 改造的流程画布；rsbuild 构建 |

## 模块说明

### 已实现（骨架）

| 包 | 职责 | 对外接口 |
|---|---|---|
| `@myt/myt-host` | 能力接缝定义：`ContainerInfo` / `HostSystemInfo` / `MytHost` 抽象类；`declare module '@deepseek-ai/cordis'` 注入 `ctx.mytHost` | `listContainers`、`hostVersion`、`systemInfo`、`startContainer(host,name,{force})`、`stopContainer(host,name)` |
| `@myt/myt-api-v2` | v2 方言 Provider：`GET /dc_api/v1/get/{ip}`、`/get_host_ver/{ip}`、`/host_api/v1/get_systeminfo/{ip}`、`/dc_api/v1/run/{ip}/{name}?force=1`、`/dc_api/v1/stop/{ip}/{name}`；把 `state` 收敛为 `created/running/exited/unknown`；系统信息兼容 snake_case | 注册 `ctx.mytHost` |
| `@myt/devices` | 设备登记与对账（ADR-0002）：按 Docker 容器 `id` 匹配生成 `DeviceId`（UUID，永不回收）；未出现的容器打墓碑；状态落 `data/devices.json` | `ctx.devices.reconcile(hostIp, containers)`、`ctx.devices.list()` |
| `@myt/device` | 设备能力接缝：`UiNode`/`UiSnapshot`/`DeviceControl`；`ctx.deviceControl` | `connect`、`dumpUi`、`tap`、`swipe`、`typeText`、`back`、`screenshot`、`openUri`、`forceStop` |
| `@myt/device-adb` | ADB 直连 Provider；uiautomator XML 自解析；`dumpUi` 空内容重试 3 次后抛错 | 注册 `ctx.deviceControl` |
| `@myt/locator` | 定位器：`id > text > desc > class > path`，支持 fallbacks，返回命中策略用于记录兜底 | `locate()`、`find()`、`center()`、`describe()` |
| `@myt/runs` | 运行事件流：8 类事件、5 类错误、checkpoint 推导、中断标记、内存保留上限 | `ctx.runs.start/step*/finish/completedSteps/markInterrupted` |
| `@myt/flow` | 流程引擎：步骤可跳过/重试/分类；`transient`+`wrong-page` 才重试；记录 locator 兜底 | `ctx.flows.register/list`、`FlowRunner.run` |
| `@myt/human` | 拟人化：`humanClickPoint`（高斯偏移+边界约束）、`pressDuration`（70/20/10 加权）、`nextTapGap`、`splitBursts`、可复现 `Random`（xorshift32） | 供设备层与流程复用 |
| `@myt/flow-xhs` | 小红书流程与定位：`locators`（12 个定位函数）、`state-locators`（区号列表/重发/聚焦/转圈/安全验证）、`dialogs`（5 个弹窗）、`actions`（输入/清空/等转圈/连点）；流程 `xhs.probe`、`xhs.login.phone-prep`（11 步） | 注册到 `ctx.flows` |
| `@myt/model` | 本地模型能力接缝：`ModelControl.complete(prompt)`；`ctx.modelControl` | `complete(prompt, {json,maxTokens,temperature})` |
| `@myt/model-openai` | OpenAI 兼容 Provider（Ollama / vLLM / 远端）；默认 `http://127.0.0.1:11434/v1/chat/completions` + `minicpm46` | 注册 `ctx.modelControl` |
| `@myt/ui-perception` | UI 感知（纯函数）：从 UI 树提取可点目标、视觉列举、PNG 裁剪；零外部依赖 | `collectActionTargets`、`renderTargets`、`cropOfRegion`、`cropPng` |
| `@myt/ui-decide` | UI 决策：意图 → 坐标（只要求序号，位置推理交给代码） | `locate()`、`createModelLocate(modelControl)` |
| `@myt/automation` | 安卓自动化引擎：五步循环、页面注册表、三层异常恢复、三级定位 | `runAction`、`PageRegistry`、`recoverTo`、`locateByModel` |
| `@myt/flow-xhs-publish` | 小红书**发布**流程（与上号流程完全解耦，只依赖 `@myt/device`）：`publish-locators`（图文发布全量定位器 + Android 14 Photo Picker 候选）、`publish-actions`（粘贴/清空/回读校验）；流程 `xhs.publish.image`（16 步） | `createPublishImageFlow(input)` |
| `@myt/desktop-host` | Electron utilityProcess 入口：读 `MYT_*` 环境变量 → `runProfile` 装配 → 上报端口。业务逻辑为零 | `MYT_PORT` / `MYT_SDK_BASE` / `MYT_HOSTS` / `MYT_STATE_FILE` / `MYT_PROFILE_DIR` |
| `@myt/system-api` | 平台自身信息，不认识业务 | 见目录结构 |
| `@myt/device-api` | 设备清单与容器生命周期；`defaultHost` 由配置注入，不猜宿主 | 见目录结构 |
| `@myt/xhs-api` | 短信平台查询；凭据不落盘 | 见目录结构 |
| `@myt/xhs-login` | 登录域四层：`tabs/`（纯函数）、`chain-runner.ts`（链执行）、`batch-login.ts`（批调度）、`index.ts`（HTTP 薄封装） | 见目录结构 |
| `@myt/xhs-pack` | 流程注册与业务数据聚合；不认识 HTTP，不执行流程 | `ctx.xhsPack.actions` / `.chain` / `.packs` |
| `@myt/task-api` | flowgram 5 个运行时端点 + 账号文本解析 | 见目录结构 |
| `@myt/runs-api` | 运行记录读写；同设备并发创建返回 409 | 见目录结构 |
| `@myt/ui`（html） | 设备农场：宿主下拉、统计卡、状态筛选、搜索、容器表、启动/停止、跑探测流程 | 调 `/api/*` |
| `@myt/ui-app` | **新 UI**（流程画布）：完整引入 `bytedance/flowgram.ai` demo（241 文件）+ 三个自定义业务节点；画布、插件、表单、工具栏、缩略图、Test Run 全部来自上游 | `mtaction` / `mt-condition` / `mt-loop` 三个节点；`initial-data.ts` 为流程数据 |
| `myt-desktop` | Electron 壳（ADR-0003）：单实例锁、端口协商、`utilityProcess` 起内核、`/api/health` 轮询 40s、托盘、关闭即隐藏、外部链接走系统浏览器、NSIS 打包 | `MYT-<ver>-Setup.exe`；日志 `%APPDATA%/myt-desktop/desktop-main.log` |

### 尚未实现

业务流程：登录 22 步、评论 17 步（发布图文已实现）、`ctx.accounts`、代理池、持久化落库（当前事件流在内存）、托盘图标、自动更新、代码签名、打包产物冒烟脚本。

## 变更记录

| 时间 | 类型 | 文件/模块 | 说明 |
|------|------|-----------|------|
| 2026-11-01 07:00:00 | 新增 | `packages/flow/xhs-login/src/chain-runner.ts` | 链执行器：补回迁移遗漏的 `runChainStep`，登录后能按配方推进改资料→绑定→关注→收尾 |
| 2026-11-01 07:00:00 | 新增 | `packages/flow/xhs-pack/` | 业务包装配：补回迁移遗漏的流程注册（此前 `ctx.flows` 为空，批量登录静默失败） |
| 2026-11-01 07:00:00 | bug修复 | `packages/core/system-api/` | `hosts` 读 `MYT_HOSTS`；此前 `/api/hosts` 恒返回空数组 |
| 2026-11-01 07:00:00 | bug修复 | `packages/device/device-adb/` `packages/core/workflows/` | 配置回落环境变量（`MYT_ADB_PATH` / `MYT_ADB_KEYBOARD_APK` / `MYT_DATA_DIR`） |
| 2026-11-01 01:10:00 | 删除 | `packages/app/kernel/` | **删除 1652 行单体内核**：40 个路由全部迁到 6 个领域插件包，`main.cjs` 改指 `desktop-host` |
| 2026-11-01 01:10:00 | 新增 | `packages/app/desktop-host/` | 宿主入口：读 `MYT_*` env → `runProfile` 装配 profile → 上报端口；业务逻辑为零 |
| 2026-11-01 01:00:00 | 新增 | `packages/core/runs-api/` | 运行记录 3 条路由；修 dsh prefix 路由不能带尾部斜杠的坑 |
| 2026-11-01 00:30:00 | 新增 | `packages/core/task-api/` | flowgram 5 个运行时端点 + `/api/accounts/parse-sms`；解析函数从 `@myt/xhs-login` 导入而非重写 |
| 2026-11-01 00:00:00 | 新增 | `packages/flow/xhs-login/` | 登录域 13 条路由：`tabs/`（11 个纯函数模块 1920 行）+ `batch-login.ts`（编排）+ `pre-step.ts`（前置动作）+ `index.ts`（HTTP） |
| 2026-10-31 23:30:00 | 新增 | `packages/flow/xhs-api/` | HeroSMS 5 条路由；API Key 由请求体传入不落盘 |
| 2026-10-31 23:00:00 | 新增 | `packages/device/device-api/` | 设备 7 条路由；`defaultHost` 由配置注入，请求没带 host 时返回 400 而不是猜 |
| 2026-10-31 22:00:00 | 新增 | `packages/core/system-api/` | 系统类 5 条路由：health / data-dir / hosts / containers / flows |
| 2026-10-31 21:00:00 | 新增 | `profile/myt/cordis.patch.yml` | **YAML 声明式装配**：14 个插件在此登记；认证链路 token → cookie → API 跑通 |
| 2026-10-31 12:20:00 | 修改 | `packages/client/app/package.json` | TypeScript 升级到 `^6.0.3`，**全项目 TS 版本统一**（此前前端 5.9 / 其余 6.0 不兼容） |
| 2026-10-31 12:20:00 | 修改 | `packages/client/app/tsconfig.json` | 恢复 `ignoreDeprecations: "6.0"`（TS 6 才识别，5.9 会报 TS5103） |
| 2026-10-31 12:20:00 | 修改 | `tsconfig.host.json` | `client/app` 重新纳入聚合，references 352 个；全量 `tsc -b` 0 错误 |
| 2026-10-31 12:00:00 | 新增 | `packages/client/app/src/services/workflow-api.ts` | 前端流程图 API 客户端：list/create/load/save/delete/rename/duplicate + data-dir，统一错误处理 |
| 2026-10-31 12:00:00 | 新增 | `packages/client/app/src/context/workflow-context.ts` | 当前流程上下文（fileName/name/saveState/save），供工具栏与自动保存使用 |
| 2026-10-31 12:00:00 | 修改 | `packages/client/app/src/editor.tsx` | 支持 `?flow=` 从内核加载；自动保存接上；**修数据覆盖 bug**：加载后 2s 抑制 + 内容指纹比对，避免初始化覆盖磁盘 |
| 2026-10-31 12:00:00 | 修改 | `packages/client/app/src/hooks/use-editor-props.tsx` | `onContentChange` 从 `console.log` 改为调用 `onSave` 回调（防抖 1s） |
| 2026-10-31 12:00:00 | 修改 | `packages/client/app/src/components/tools/save.tsx` | Save 按钮改为真实保存 |
| 2026-10-31 12:00:00 | 修改 | `packages/client/app/src/components/testrun/testrun-button/index.tsx` | Test Run 前先保存（不能跑旧图） |
| 2026-10-31 12:00:00 | 修改 | `packages/client/app/tsconfig.json` | 移除 `ignoreDeprecations: 6.0`（前端用 TS 5.9 不认识） |
| 2026-10-31 12:00:00 | 修改 | `tsconfig.host.json` | 排除 `client/app`（rsbuild 独立构建，不参与 tsc -b 聚合） |
| 2026-10-31 11:40:00 | 新增 | `packages/app/desktop/src/data-dir.ts` | **数据目录解析**：env → 配置 → 用户选择 → 安装目录 → userData 五级优先级；`isSystemDrive` 识别 C 盘；`writeConfig` 原子写；15 个测试通过 |
| 2026-10-31 11:40:00 | 新增 | `packages/app/desktop/scripts/build.mjs` | esbuild 把 `data-dir.ts` 打成 `data-dir.cjs`（`main.cjs` 无法 require TS） |
| 2026-10-31 11:40:00 | 修改 | `packages/app/desktop/src/main.cjs` | `getUserDataDir` 拆为 `getConfigDir`/`getDataDir`；首次运行弹窗（默认预填第一个非系统盘）；`MYT_STATE_FILE` 跟随数据目录 |
| 2026-10-31 11:40:00 | 修改 | `packages/app/kernel/src/main.ts` | `stateFile` 支持 `MYT_STATE_FILE` → `MYT_DATA_DIR/devices.json` → 项目 `data/` 三级回落 |
| 2026-10-31 11:40:00 | 修改 | `packages/app/kernel/src/kernel.ts` | 新增 `GET /api/data-dir`，返回当前数据目录与是否在系统盘 |
| 2026-10-31 11:20:00 | 新增 | `packages/core/webserver/` | **WebServer 插件**（`@myt/webserver`，`ctx.http`）：HTTP 路由服务，只做监听/分发/CORS/JSON/错误收敛；精确路由优先于前缀路由；12 个测试通过 |
| 2026-10-31 11:20:00 | 新增 | `packages/core/workflows/src/api.ts` | **WorkflowApi 插件**：流程图 7 个路由由插件自己注册，kernel 不再硬编码 `/api/workflows`；作为「插件自挂路由」范例 |
| 2026-10-31 11:20:00 | 修改 | `packages/app/kernel/src/kernel.ts` | 用 `ctx.http` 替代 `createServer`；旧 47 个路由整体挂在 `setFallback` 上（零风险渐进迁移）；删除已迁走的 workflows 路由块 |
| 2026-10-31 11:00:00 | 新增 | `packages/core/workflows/` | **WorkflowStore 插件**（`@myt/workflows`）：流程持久化。文件名=流程名（用户可读/改名/复制），身份是内容里的 uuid；重复 id 自动重分配、坏文件隔离、原子写（tmp+rename）。13 个测试全通过 |
| 2026-10-31 11:00:00 | 修改 | `packages/app/kernel/src/kernel.ts` | 装配 `WorkflowStore`；新增 6 个 `/api/workflows*` 路由（列表/新建/读/存/删/改名/复制），精确路由置于 startsWith 分支之前 |
| 2026-10-31 11:00:00 | 修改 | `tsconfig.base.json` | 补 20 条 `@myt/*` paths（**typert 必需**：缺映射会让同一包解析出两份 Symbol，导致 `not exported` 报错） |
| 2026-10-31 11:00:00 | 修改 | `tsconfig.host.json` | references 增至 351 个，指向各包 `tsconfig.host.json`（**不能指向包目录**，否则解析到 files:[] 的聚合配置） |
| 2026-10-31 11:00:00 | 新增目录 | `vendor/`、`apps/`、`native/`、`scripts/` | 全量复制 dsh 源码：9 个核心底层包 + 278 个 dsh 包 + 5 个应用 + 6 个原生包 + 336 个构建脚本；**344 个包全部构建成功（lib/index.js 零缺失）** |
| 2026-10-31 02:35:00 | 修改 | `docs/spec/界面设计规范.md` | 补「节点与端口」：五种节点、端口中文释义、表单字段表、FormItem 坑 |
| 2026-10-31 00:35:00 | 修改 | `docs/spec/流程图引擎与可视化编排.md` | 补「Test Run 接入」：5 个端点契约、三个坑（errors 必须是 string[]/跨域静默失败/画布 schema 无 data）、前端配置、上下文共用 |
| 2026-10-31 00:35:00 | 新增 | `packages/app/kernel/src/flow-task.ts` | **flowgram 运行时接口**：`FlowTaskRunner` 实现 `TaskValidate`/`TaskRun`/`TaskReport`/`TaskResult`/`TaskCancel`，内部调 `runXhsGraph` 驱动 ADB；按节点 id 反查图配置（画布不带 `app`/`maxSteps`） |
| 2026-10-31 00:35:00 | 修改 | `packages/app/kernel/src/kernel.ts` | 新增 5 个 `/api/task/*` 路由 + **CORS 支持**（缺预检时前端只显示 Internal Server Error，内核日志看不到请求）+ 启动预加载 `data/flows/*.json` 业务配置 |
| 2026-10-31 00:35:00 | 修改 | `packages/core/flow/src/index.ts` | 抽出 `createStepContext`：步骤引擎与图引擎共用上下文构造，避免 snapshot 缓存/取消语义漂移；`StepContext` 新增 `invalidateSnapshot()` |
| 2026-10-31 00:35:00 | 修改 | `packages/client/app/src/hooks/use-editor-props.tsx` | `runtime-plugin` 切到 `mode:'server'`，指向内核 `127.0.0.1:7788` |
| 2026-10-31 00:35:00 | 修改 | `packages/automation/automation/src/graph/load.ts` | 顶层 `id`/`title` 改为可省略（画布 schema 只有 `{nodes, edges}`） |
| 2026-10-31 00:35:00 | 修改 | `packages/flow/flow-xhs-publish/package.json` | 新增 `./runtime` 导出（`graph-runtime.ts`） |
| 2026-10-31 00:15:00 | 修改 | `packages/automation/automation/src/graph/types.ts` | **彻底统一为画布 JSON 格式**：`kind`→`type`、`label`→`data.title`、`config`→`data.*`、`position`→`meta.position`、边改 `sourceNodeID/sourcePortID/targetNodeID`；图级 `app`/`maxSteps` 移入 `data`；`entry` 可省略（自动取唯一 start） |
| 2026-10-31 00:15:00 | 修改 | `packages/automation/automation/src/graph/load.ts` | 校验按画布格式读取：`type` 白名单、`meta.position`、`data` 必填、`data.app`/`data.maxSteps` |
| 2026-10-31 00:15:00 | 修改 | `packages/automation/automation/src/graph/run.ts` | 字段访问改画布格式；新增 `act` 缺失守卫（返回 failure 而非崩溃）；循环配置读 `data.loopFor` |
| 2026-10-31 00:15:00 | 修改 | `data/flows/xhs.publish.{article,image,text}.json` | 三张图转成画布格式（18/25/19 节点，46/65/49 边），校验全通过 |
| 2026-10-31 00:15:00 | 修改 | `packages/automation/automation/src/graph/graph.test.ts` | 22 个用例适配画布格式，全部通过 |
| 2026-10-31 00:15:00 | 修改 | `packages/client/app/src/initial-data.ts` | 改为直接由 `data/flows/xhs.publish.article.json` 生成，画布与引擎共用同一份数据 |
| 2026-10-31 00:15:00 | 删除 | `scripts/flow-to-flowgram.mjs` | 格式统一后转换器不再需要 |
| 2026-10-31 02:30:00 | 新增目录 | `packages/client/app/` | 新 UI 包 `@myt/ui-app`：完整复制 flowgram demo 241 文件 + rsbuild 构建 |
| 2026-10-31 02:30:00 | 新增 | `client/app/src/nodes/mt-action/` | 动作节点：三出口（success/failure/mismatch）+ 中文表单（找什么/做什么/输入内容） |
| 2026-10-31 02:30:00 | 新增 | `client/app/src/nodes/mt-condition/` | 条件节点：两出口（true/false）+ 中文表单（判断方式/页面·参数） |
| 2026-10-31 02:30:00 | 新增 | `client/app/src/nodes/mt-loop/` | 循环节点：**容器式**（`isContainer` + blocks 子画布），与 demo 一致 |
| 2026-10-31 02:30:00 | 修改 | `client/app/src/nodes/{start,end,condition,loop}/index.ts` | 节点描述改中文 |
| 2026-10-31 02:30:00 | 修改 | `client/app/src/nodes/constants.ts` | 加 `MTAction` / `MTCondition` / `MTLoop` 三种类型 |
| 2026-10-31 02:30:00 | 修改 | `automation/.../graph/types.ts` | `FlowNode` 加 `blocks`（容器子节点）；循环改容器式语义 |
| 2026-10-31 02:30:00 | 修改 | `automation/.../graph/run.ts` | 新增 `runLoopContainer`（递归执行循环体）；`executeNode` 去掉 loopCounters 参数 |
| 2026-10-31 02:30:00 | 修改 | `automation/.../graph/graph.test.ts` | 循环测试改容器式；22 个测试全绿 |
| 2026-10-31 02:30:00 | 修改 | `tsconfig.json`（根） | 排除 `packages/client/app`（demo 的导入风格与根配置不兼容） |
| 2026-10-31 02:30:00 | 修改 | `COLLAB.md` | 补第 5.1 条「实现任何东西前先确认有没有现成的」+ 第 5 条第二次同类错误 |
| 2026-10-31 01:00:00 | 新增 | `COLLAB.md` | 协作约定：9 条工作方式硬规则（遇障碍报告、不许改写标准做法、先查证不下判断等） |
| 2026-10-31 00:10:00 | 新增 | `docs/spec/界面设计规范.md` | 方向 A「无彩账簿」完整规格：token / 字体 / 7 条硬规则 / 画布蓝图 / 四页面 |
| 2026-10-31 00:30:00 | 修改 | `docs/spec/界面设计规范.md` | 补「画布交互（无限画布）」：平移/缩放 25-150%/fit/缩略图/分级可读性 |
| 2026-10-30 23:40:00 | 新增 | `data/flows/xhs.publish.image.json` | 图文流程图：25 节点 / 65 边（18 动作 + 5 条件） |
| 2026-10-30 23:40:00 | 新增 | `data/flows/xhs.publish.text.json` | 文字流程图：19 节点 / 49 边 |
| 2026-10-30 23:40:00 | 新增 | `data/flows/xhs.publish.article.json` | 长文流程图：18 节点 / 46 边 |
| 2026-10-30 23:40:00 | 新增 | `flow-xhs-publish/src/graph-runtime.ts` | 图运行时：注入小红书定位器表 + 自定义动作表 |
| 2026-10-30 23:40:00 | bug修复 | `automation/automation/src/graph/run.ts` | 经 failure/mismatch 到 end 不再算成功（此前静默成功） |
| 2026-10-30 23:40:00 | 修改 | `data/flows/*.json` | 补 `video-editor` / `note-preview` 页面；加「继续编辑」弹窗处理 |
| 2026-10-30 23:00:00 | 新增 | `automation/automation/src/graph/types.ts` | 图数据结构：`FlowGraph` / `FlowNode` / `FlowEdge` / 5 种节点 / 8 种端口 |
| 2026-10-30 23:00:00 | 新增 | `automation/automation/src/graph/load.ts` | 图加载与校验：id 唯一、entry 是 start、边两端存在、端口匹配、可达 end |
| 2026-10-30 23:00:00 | 新增 | `automation/automation/src/graph/run.ts` | 图引擎：`runGraph` 按端口路由、`executeNode` 单节点执行 |
| 2026-10-30 23:00:00 | 新增 | `automation/automation/src/graph/graph.test.ts` | 20 个测试：7 个端到端路由 + 5 个节点内部 + 8 个加载校验 |
| 2026-10-30 22:10:00 | 新增 | `docs/spec/流程图引擎与可视化编排.md` | 流程图引擎与可视化编排 spec（33 条用户故事，含界面文案规范与 UI 重做） |
| 2026-10-30 22:35:00 | 修改 | `docs/spec/流程图引擎与可视化编排.md` | 文件名改中文；旧 UI 策略由「整体重做」改为「保留但隐藏，新 UI 作唯一入口」 |
| 2026-10-30 21:30:00 | 新增目录 | `packages/automation/ui-perception/` | UI 感知：`ui-action-targets` / `ui-vision-listing` / `png-crop`（纯函数，零依赖） |
| 2026-10-30 21:30:00 | 新增目录 | `packages/automation/ui-decide/` | UI 决策：`ui-locate`（意图→坐标）+ `createModelLocate` 适配器 |
| 2026-10-30 21:30:00 | 新增目录 | `packages/automation/automation/` | 动作引擎：五步循环、`PageRegistry`、`recoverTo`、`locateByModel`、`actions` |
| 2026-10-30 21:30:00 | 重构 | `packages/device/device/` | 移除 UI 相关模块，回归纯 ADB 操作 |
| 2026-10-30 21:30:00 | 重构 | `flow-xhs-publish/src/` | 删除本地 engine/steps 副本；新增 `pages.ts`（页面表+恢复规则）、`shared.ts`（小红书共用动作） |
| 2026-10-30 21:30:00 | 修改 | `packages/core/flow/src/index.ts` | `FlowDefinition.app` 与 `StepContext.app`（包名/首页深链/页面表/恢复规则） |
| 2026-10-30 20:20:00 | 修改 | `flow-xhs-publish/src/engine/types.ts` | 删除 `tapAt`（未使用的固定坐标能力） |
| 2026-10-30 20:20:00 | 修改 | `flow-xhs-publish/src/steps/recovery.ts` | 删除 `tap` 动作与失效的「素材预览页」规则 |
| 2026-10-30 20:20:00 | 修改 | `flow-xhs-publish/src/engine/shared-actions.ts` | 滑动/下拉刷新改为按屏幕比例计算，移除硬编码坐标 |
| 2026-10-30 19:50:00 | 新增 | `flow-xhs-publish/src/engine/` | 动作引擎：`runAction` 统一五步（取界面→判页面→找坐标→执行→校验），5 种内置校验 |
| 2026-10-30 19:50:00 | 新增 | `flow-xhs-publish/src/engine/shared-actions.ts` | 三流程共用：prepare / submit / verify / 下拉刷新 / 滚动 / 选图 |
| 2026-10-30 19:50:00 | 重构 | `flow-xhs-publish/src/flows/*.ts` | 三个流程改为动作声明（循环 41→约 10）；图文 15 步 / 文字 12 步 / 长文 11 步 |
| 2026-10-30 19:50:00 | 新增 | `flow-xhs-publish/src/steps/recovery.ts` | 异常恢复三层：循环等待 → 规则表 → 深链兜底 |
| 2026-10-30 19:50:00 | bug修复 | `packages/device/device/src/ui-locate.ts` | `parseLocateIndex` 兼容字符串形式的 index |
| 2026-10-30 18:30:00 | 新增 | `flow-xhs-publish/src/steps/recovery.ts` | 异常恢复三层：循环等待 → 规则表 → 深链兜底+逐级返回 |
| 2026-10-30 18:30:00 | 修改 | `flow-xhs-publish/src/steps/page-guard.ts` | `assertPage` 接入恢复层；新增 `recoverable` 参数 |
| 2026-10-30 18:30:00 | 修改 | `flow-xhs-publish/src/flows/publish-image.ts` | `skip-image-editor` 改用恢复层（34.6s → 8.2s）；填写类步骤禁恢复 |
| 2026-10-30 17:40:00 | 新增 | `flow-xhs-publish/src/flows/publish-text.ts` | 文字笔记流程 `xhs.publish.text`（13 步，移植 `fb_wz`） |
| 2026-10-30 17:40:00 | 新增 | `flow-xhs-publish/src/flows/publish-article.ts` | 长文笔记流程 `xhs.publish.article`（12 步，移植 `fb_long_wz`） |
| 2026-10-30 17:40:00 | 新增 | `flow-xhs-publish/src/pack.ts` | `xhsPublishPack` 注册三个发布流程到 FlowRegistry |
| 2026-10-30 17:40:00 | 修改 | `flow-xhs-publish/src/locators/publish-locators.ts` | 补文字/长文笔记定位器；长文输入框加当前版本路径；补占位符 |
| 2026-10-30 17:40:00 | 修改 | `flow-xhs-publish/src/steps/page-guard.ts` | 新增 `text-note` / `review` / `article-editor` 页面类型 |
| 2026-10-30 17:40:00 | 修改 | `packages/app/kernel/src/kernel.ts` | 注册 `xhsPublishPack` |
| 2026-10-30 16:20:00 | 新增 | `flow-xhs-publish/src/steps/page-guard.ts` | 页面护栏：`currentPublishPage` / `assertPage` / `ensurePage` / `waitForPage` |
| 2026-10-30 16:20:00 | 新增 | `packages/device/device/src/png-crop.ts` | 纯 JS PNG 裁剪（只用 Node zlib，不引入 sharp/jimp） |
| 2026-10-30 16:20:00 | 修改 | `flow-xhs-publish/src/steps/model-locate.ts` | 改为 L1 文本 → L2 视觉兜底 → L3 路径 三级链路 |
| 2026-10-30 16:20:00 | 修改 | `flow-xhs-publish/src/locators/publish-locators.ts` | 图库网格改几何识别（不依赖层级路径）；加最小边长约束；改点右上角角标 |
| 2026-10-30 16:20:00 | bug修复 | `packages/device/device-adb/src/index.ts` | `openUri` 去掉硬编码 `-n RouterPageActivity`（导致 post_note 深链不跳转） |
| 2026-10-30 16:20:00 | 修改 | `flow-xhs-publish/src/flows/publish-image.ts` | 9 处页面护栏；`skip-image-editor` 覆盖预览→编辑→发布 |
| 2026-10-30 15:40:00 | 新增 | `packages/ai/model/` | 模型能力接缝 `ModelControl`（`complete(prompt)`） |
| 2026-10-30 15:40:00 | 新增 | `packages/ai/model-openai/` | OpenAI 兼容 Provider，默认 Ollama `minicpm46` |
| 2026-10-30 15:40:00 | 新增 | `flow-xhs-publish/src/steps/model-locate.ts` | `locateByModel`（模型定位 + 路径兜底）、`askYesNo`（布尔判定） |
| 2026-10-30 15:40:00 | 修改 | `packages/core/flow/src/index.ts` | `StepContext` / `RunOptions` 增加可选 `model` 字段 |
| 2026-10-30 15:40:00 | 修改 | `packages/device/device/src/index.ts` | 导出 `collectActionTargets` / `locate` / `Browser` 等 |
| 2026-10-30 15:40:00 | 修改 | `flow-xhs-publish/src/flows/publish-image.ts` | 12 处定位改为模型优先；新增 `skip-image-editor` 步骤（共 17 步） |
| 2026-10-30 14:23:00 | 新增 | `packages/flow/flow-xhs-publish/` | 新增发布功能包 `@myt/flow-xhs-publish`，与上号包完全解耦 |
| 2026-10-30 14:23:00 | 新增 | `flow-xhs-publish/src/flows/publish-image.ts` | 图文发布流程 `xhs.publish.image`（16 步，1:1 移植 `fb_image`） |
| 2026-10-30 14:23:00 | 新增 | `flow-xhs-publish/src/locators/publish-locators.ts` | 发布定位器；含 Android 14 Photo Picker / 权限弹窗候选路径 |
| 2026-10-30 14:23:00 | 新增 | `flow-xhs-publish/src/steps/publish-actions.ts` | 粘贴、清空、回读校验（CRLF 归一化） |
| 2026-10-30 14:23:00 | 修改 | `packages/device/device/src/index.ts` | `UiNode` 增加 `attrs`（保留 `NAF` 等小红书自用属性） |
| 2026-10-30 14:23:00 | 修改 | `packages/device/device-adb/src/index.ts` | 解析器填充 `attrs` |
| 2026-10-30 19:30:00 | 重构 | `packages/device/device/src/browse.ts` | 改为依赖 `DeviceControl` 契约，新增 `Browser` 类；不再直接调 adb |
| 2026-10-30 19:30:00 | 修改 | `packages/device/device/src/index.ts` | `UiNode` 补 `scrollable` / `longClickable` / `isPassword` 三字段 |
| 2026-10-30 19:30:00 | 修改 | `packages/device/device-adb/src/index.ts` | 解析器补齐上述三字段 |
| 2026-10-30 19:30:00 | 修改 | `docs/spec/local-model-ui-locate.md` | 补充十：ADB 操作抽成通用模块 |
| 2026-10-30 18:30:00 | 修改 | `packages/device/device/src/browse.ts` | dump 改用 yadb（0.29s vs uiautomator 2.24s，快 7.6 倍），失败退回 uiautomator |
| 2026-10-30 17:30:00 | 新增 | `packages/device/device/src/browse.ts` | 自动化浏览：观察→操作→确认→继续四拍流程 + 主页/搜索两个场景 |
| 2026-10-30 17:30:00 | 修改 | `docs/spec/local-model-ui-locate.md` | 补充九：自动化浏览实测与三个踩坑 |
| 2026-10-30 16:00:00 | 新增 | `packages/device/device/src/ui-locate.ts` | 定位服务：`locate()` 把意图转坐标（索引契约 + 代码算坐标 + 预筛 + 校验） |
| 2026-10-30 16:00:00 | 新增 | `packages/device/device/src/ui-locate.test.ts` | 17 个测试 |
| 2026-10-30 16:00:00 | bug修复 | `packages/device/device/src/ui-action-targets.ts` | 位置标注加「正中间」+ 行容差收紧到 4px + 无名节点继承祖先语义 |
| 2026-10-30 16:00:00 | 修改 | `docs/spec/local-model-ui-locate.md` | 补充八：定位服务封装 |
| 2026-10-30 15:00:00 | bug修复 | `packages/device/device/src/ui-action-targets.ts` | `excludeUnnamed` 只排「无名且不可点」，准确率 70%→80%、延迟 1573→1121ms |
| 2026-10-30 15:00:00 | 修改 | `packages/device/device/src/ui-action-targets.ts` | `inferRegion` 多语言词表（中/英/日/韩） |
| 2026-10-30 15:00:00 | 修改 | `docs/spec/local-model-ui-locate.md` | 补充六（多语言）+ 补充七（最终策略） |
| 2026-10-30 14:30:00 | 修改 | `packages/device/device/src/ui-action-targets.ts` | `inferRegion` 多语言词表（中/英/日/韩），15 用例全通过 |
| 2026-10-30 14:30:00 | 修改 | `docs/spec/local-model-ui-locate.md` | 补充六：多语言支持（三组合均 100%） |
| 2026-10-30 13:30:00 | bug修复 | `packages/device/device/src/ui-action-targets.ts` | `inferRegion` 识别「导航项」+ 规则4 去重优先保留可点节点 |
| 2026-10-30 13:30:00 | 修改 | `packages/device/device/src/ui-action-targets.test.ts` | +8 个测试（inferRegion / narrowTargets） |
| 2026-10-30 13:30:00 | 修改 | `docs/spec/local-model-ui-locate.md` | 补充五：minicpm46 纯文本 100% |
| 2026-10-30 12:30:00 | bug修复 | `packages/device/device/src/ui-vision-listing.ts` | 解析器三处修复：图标符号白名单、剔除纯数字、支持空格分隔 |
| 2026-10-30 12:30:00 | 修改 | `docs/spec/local-model-ui-locate.md` | 补充四：文本+视觉兜底完整链路（两模型均 6/6） |
| 2026-10-30 11:00:00 | 新增 | `packages/device/device/src/ui-vision-listing.ts` | 视觉列举：提示词构建 + 列表解析 + 名字映射 + 位置推理 + 区域裁剪 |
| 2026-10-30 11:00:00 | 新增 | `packages/device/device/src/ui-vision-listing.test.ts` | 21 个测试 |
| 2026-10-30 11:00:00 | 修改 | `docs/spec/local-model-ui-locate.md` | 补充三：提示词与意图优化（强调完整/禁计数/位置交给代码） |
| 2026-10-30 05:00:00 | 修改 | `docs/spec/local-model-ui-locate.md` | 补充各模型详细失败模式：minicpmv 相邻混淆、关键词预筛不可用 |
| 2026-10-30 04:30:00 | 修改 | `packages/device/device/src/ui-action-targets.ts` | 新增位置标注（最左/最右）+ `narrowTargets` 区域预筛 + `inferRegion` 意图推断 |
| 2026-10-30 04:30:00 | 修改 | `docs/spec/local-model-ui-locate.md` | 补充二：预筛比视觉有效 10 倍 + 8 模型横评 |
| 2026-10-30 03:00:00 | 修改 | `docs/spec/local-model-ui-locate.md` | 补充 11 个新模型横评：lfm3-vl 单模型最优，bonsai-2/35B-A3B 达 100% |
| 2026-10-30 01:30:00 | 新增 | `packages/device/device/src/ui-action-targets.ts` | 语义化解析：合并同义节点 / 祖先代理 / 语义命名 / 区域分组 / 边界去重，43→19 目标 |
| 2026-10-30 01:30:00 | 新增 | `packages/device/device/src/ui-action-targets.test.ts` | 12 个测试 |
| 2026-10-30 01:30:00 | 修改 | `packages/device/device/src/ui-locate-prompt.ts` | 输出契约改为 `{"index":N}`，移除 reason（实测 0%→100%） |
| 2026-10-30 01:30:00 | 新增 | `docs/spec/local-model-ui-locate.md` | 本地模型对比：MiniCPM5-2B / V4.6 / V4.7 实测 |
| 2026-10-29 20:31:10 | 新增 | `packages/device/device/src/ui-compact.ts` | 紧凑 UI 树压缩 + `hitTest`（含 Android 事件冒泡优先可点节点） |
| 2026-10-29 20:31:10 | 新增 | `packages/device/device/src/ui-compact.test.ts` | 11 个测试 |
| 2026-10-29 20:31:10 | 新增 | `packages/device/device/src/ui-locate-prompt.ts` | LLM 定位提示词（fewshot 含事件冒泡规则）+ 容错解析 |
| 2026-10-29 20:31:10 | 新增 | `packages/device/device/src/ui-locate-prompt.test.ts` | 12 个测试 |
| 2026-10-29 20:31:10 | 新增 | `docs/spec/llm-ui-locate-experiment.md` | LLM 页面定位实验报告（9 个模型 × 2 页面 × 字段消融 × 提示词变体） |
| 2026-10-29 15:23:57 | bug修复 | `packages/app/kernel/src/kernel.ts` | `setAdbIme`/`ensureYadb` 从未被调用 → 新增 `prepareYadbAndIme`，两处接入 |
| 2026-10-29 15:23:57 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.35：yadb/IME 悬空问题的定位与修复 |
| 2026-10-29 14:36:30 | 修改 | `packages/core/flow/src/index.ts` | 新增 `ChainRecipe` / `ChainStepSpec` / `ChainCondition`，`FlowPack.chain` |
| 2026-10-29 14:36:30 | 修改 | `packages/flow/flow-xhs/src/pack.ts` | 声明 `xhsChain` 配方（对齐旧版真实顺序） |
| 2026-10-29 14:36:30 | 修改 | `packages/app/kernel/src/tabs/login-chain.ts` | 291 行 → 249 行纯解释器；删除 `ChainConfig`/`ACTION_LABEL`/`EMPTY_CHAIN_FLOWS` |
| 2026-10-29 14:36:30 | 修改 | `packages/app/kernel/src/kernel.ts` | `ChainConfig` → `ChainRun{flags,data}`；链由配方驱动 |
| 2026-10-29 14:36:30 | bug修复 | `packages/app/kernel/src/kernel.ts` | 绑定手机号时机：改资料前 → 改资料后（对齐旧版） |
| 2026-10-29 14:36:30 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.34：配方化全过程 + 3 处旧版不一致分析 |
| 2026-10-29 14:00:00 | 修改 | `packages/core/flow/src/index.ts` | 新增 `ActionParam` / `ActionDefinition`，`FlowPack.actions` |
| 2026-10-29 14:00:00 | 修改 | `packages/flow/flow-xhs/src/pack.ts` | 声明 13 个动作（含参数表单） |
| 2026-10-29 14:00:00 | 修改 | `packages/flow/flow-xhs-device/src/pack.ts` | 声明 2 个动作 |
| 2026-10-29 14:00:00 | 修改 | `packages/app/kernel/src/tabs/login-tab.ts` | `ACTION_FLOWS`/`SINGLE_TASKS` 改为 `buildActionFlows`/`buildChainFlows`/`buildSingleTasks` 派生 |
| 2026-10-29 14:00:00 | 修改 | `packages/app/kernel/src/tabs/login-chain.ts` | `ACTION_FLOW_ID` → `EMPTY_CHAIN_FLOWS` 占位 |
| 2026-10-29 14:00:00 | 修改 | `packages/app/kernel/src/kernel.ts` | 动作表由包汇总；`/batch` 不再枚举动作；`/tasks` 返回 `actions` |
| 2026-10-29 14:00:00 | 修改 | `packages/client/ui/login.html` | 12 个 prompt 分支 → 通用表单渲染器 + 两步对话框 |
| 2026-10-29 14:00:00 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.33：动作配置化全过程 |
| 2026-10-29 13:46:59 | 修改 | `packages/core/flow/src/index.ts` | 新增 `FlowPack` / `FlowPackCapabilities` 契约，`FlowDefinition` 加 `uiChannel` |
| 2026-10-29 13:46:59 | 新增 | `packages/flow/flow-xhs/src/pack.ts` | `xhsPack`：15 个 xhs 流程注册逻辑从 kernel 迁入 |
| 2026-10-29 13:46:59 | 新增 | `packages/flow/flow-xhs-device/src/pack.ts` | `xhsDevicePack`：清数据 + 备份 |
| 2026-10-29 13:46:59 | 修改 | `packages/flow/flow-xhs{,-device}/package.json` | 加 `./pack` subpath 导出 |
| 2026-10-29 13:46:59 | 修改 | `packages/app/kernel/src/kernel.ts` | 12 处 xhs 硬编码清零，净减 166 行 |
| 2026-10-29 13:46:59 | 修改 | `packages/flow/flow-xhs/src/{index,flows/alt-login-flows}.ts` | 3 个登录流程声明 `uiChannel: 'yadb'` |
| 2026-10-29 13:46:59 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.32：插拔改造全过程 |
| 2026-10-29 13:38:51 | 新增目录 | `packages/flow/flow-xhs/src/{flows,locators,steps,data}/` | 24 个平铺文件归入 4 个子目录 |
| 2026-10-29 13:38:51 | 修改 | `packages/flow/flow-xhs/src/**/*.ts` | 全部 import 路径重写（根 `./x/`，子目录 `../x/`） |
| 2026-10-29 13:38:51 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.31：分目录结果 + 插拔性评估（12 处硬编码 + 三步改造方案） |
| 2026-10-24 20:57:39 | 新增 | `packages/app/kernel/src/tabs/import-config.ts` | `pickUnusedBindAccount` / `updateBindAccountStatus`（分配 + 状态回写） |
| 2026-10-24 20:57:39 | 新增 | `packages/app/kernel/src/kernel.ts` | `GET /bind-account/next` + `POST /bind-account/result` |
| 2026-10-24 20:57:39 | 修改 | `packages/app/kernel/src/kernel.ts` | 链内 `bind-phone` 自动从绑定账号池取号；任务结束回写状态 |
| 2026-10-24 20:57:39 | 修改 | `packages/app/kernel/src/tabs/login-chain.ts` | `ChainState` 加 `bindAccountIndex` / `bindAccountSerial` |
| 2026-10-24 20:57:39 | 验证 | 绑定账号链路 | 分配→成功回写→排除已用→已绑定清空，源 txt 正确 |
| 2026-10-24 20:57:39 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.30 |
| 2026-10-24 17:06:26 | 新增 | `packages/app/kernel/src/tabs/import-config.ts` | 5 个回写函数：账号行格式化/单账号回写（含 bundle 重命名 zip）/批量回写/昵称前缀/代理前缀 |
| 2026-10-24 17:06:26 | 修改 | `packages/app/kernel/src/kernel.ts` | 保存接口执行三个 sync 副作用，返回 `synced` 结果 |
| 2026-10-24 17:06:26 | 修改 | `packages/client/ui/login.html` | 四个页签各加「源文件路径」输入框（否则回写不触发） |
| 2026-10-24 17:06:26 | 验证 | 源文件回写 | 三项均与旧版逐字节一致（账号 ----status / 昵称加去前缀 / 代理前缀） |
| 2026-10-24 17:06:26 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.29 |
| 2026-10-24 16:58:37 | 新增 | `packages/app/kernel/src/tabs/import-config.ts` | 批导入配置模型与落盘（20 字段 + 默认值 + 校验 + 原子写） |
| 2026-10-24 16:58:37 | 新增 | `packages/app/kernel/src/kernel.ts` | `GET/POST /api/tabs/login/import-config` |
| 2026-10-24 16:58:37 | 修改 | `packages/app/kernel/src/kernel.ts` | `/batch-login` 从持久化配置回落取 heroSms 等字段 |
| 2026-10-24 16:58:37 | 修改 | `packages/client/ui/login.html` | 打开弹窗 `loadImportConfig()` 回填；保存 `collectImportConfig()` 落盘 |
| 2026-10-24 16:58:37 | 验证 | 持久化 | 保存后 json 1227 字节；刷新页面后 20 字段完整回填（含账号状态） |
| 2026-10-24 16:58:37 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.28 |
| 2026-10-24 16:47:14 | 新增 | `packages/client/ui/login.html` | `impExportFailed` 导出失败账号（旧 `export_failed_accounts`）+ `downloadText` 工具 |
| 2026-10-24 16:47:14 | 新增 | `packages/client/ui/login.html` | `impBindExport` 导出未成功绑定账号（旧 `export_bind_accounts`） |
| 2026-10-24 16:47:14 | bug修复 | `packages/client/ui/login.html` | 账号导入没拆 phone/url（导出拿不到字段），补 `parseAccountLine` 支持 `成功--`/`失败--` 前缀 |
| 2026-10-24 16:47:14 | bug修复 | `packages/client/ui/login.html` | 账号信息列显示格式错误（应为 `phone--url` 双横线，旧 `account_info`） |
| 2026-10-24 16:47:14 | 验证 | UI 全量扫描 | 35 个按钮全部接线（原 2 个未绑定） |
| 2026-10-24 16:47:14 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.27 |
| 2026-10-24 16:38:54 | 新增 | `packages/app/kernel/src/kernel.ts` | `xhs.device.set-proxy` 工厂（代理六参数 + 默认 apiPort 10008） |
| 2026-10-24 16:38:54 | 修改 | `packages/app/kernel/src/tabs/login-tab.ts` | `ACTION_FLOWS` 补 `set-proxy` / `reset-device` 映射 |
| 2026-10-24 16:38:54 | 修改 | `packages/client/ui/login.html` | 单项任务补 set-proxy / reset-device 参数收集；restore-state 改 `source` |
| 2026-10-24 16:38:54 | 验证 | `set-proxy` | 缺参数正确报「代理参数不完整」 |
| 2026-10-24 16:38:54 | 验证 | `reset-device` | 正确路由到 one-click-new（失败因设备未装小红书，与旧代码前提一致） |
| 2026-10-24 16:38:54 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.26 |
| 2026-10-24 16:27:55 | 新增 | `packages/app/kernel/src/tabs/login-tab.ts` | 单项任务新增 `probe`（设备就绪探测）+ `ACTION_FLOWS` 映射 |
| 2026-10-24 16:27:55 | 修改 | `packages/app/kernel/src/kernel.ts` | batch 动作联合类型加 `probe` |
| 2026-10-24 16:27:55 | 修改 | `packages/client/ui/login.html` | `SINGLE_ACTION` 加 `probe` 映射 |
| 2026-10-24 16:27:55 | 验证 | `xhs.probe` | 真机 3 步全过（抓UI → 回主页 → 断言） |
| 2026-10-24 16:27:55 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.25：probe 补入口 + 单项任务 10 项清单 |
| 2026-10-24 16:21:25 | 新增 | `packages/flow/flow-xhs/src/index.ts` | `uiDumpFlow`（`xhs.ui.dump`）：抓 UI → 落盘 → 报前台包名 |
| 2026-10-24 16:21:25 | bug修复 | `packages/device/{device,device-adb}/src/index.ts` | `UiNode` 缺 `packageName` 字段（`_first_package_name` 依赖），补解析 |
| 2026-10-24 16:21:25 | 修改 | `packages/flow/flow-xhs/src/state-restore.ts` | 恢复支持任意格式：zip 解压、MIUI .bak / WeShare .tar.bak 自动转换 |
| 2026-10-24 16:21:25 | 修改 | `packages/client/ui/login.html` | 恢复弹窗文案改为「备份源」+ 三种格式说明 |
| 2026-10-24 16:21:25 | 修改 | `packages/app/kernel/src/tabs/login-tab.ts` | `ui-dump` 映射从 `xhs.probe` 改为 `xhs.ui.dump` |
| 2026-10-24 16:21:25 | 验证 | `xhs.ui.dump` | 真机通过：文件 9210 字节、前台包名 `com.blue.backup` |
| 2026-10-24 16:21:25 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.24：补 UI 接线 |
| 2026-10-24 16:07:36 | 新增 | `packages/flow/flow-xhs/src/bundle.ts` | bundle 读写（436 行）：FILE_GROUPS/MODE_GROUPS/静态动态条目/manifest/手写 ZIP 写入（Python zipfile 校验通过） |
| 2026-10-24 16:07:36 | 新增 | `packages/flow/flow-xhs/src/bundle-convert.ts` | WeShare/MIUI 备份转 bundle（500 行）：tar 读取、MIUI 内嵌 tar 偏移定位、成员搬迁 |
| 2026-10-24 16:07:36 | 新增 | `packages/flow/flow-xhs/src/device-context.ts` | 设备上下文提取（300 行）：sid/userId/token/did/loc_device_id，5 项正则与旧 Python 对拍一致 |
| 2026-10-24 16:07:36 | 新增 | `packages/app/kernel/src/tabs/ui-dump.ts` | UI XML 落盘（57 行） |
| 2026-10-24 16:07:36 | 修改 | `packages/flow/flow-xhs/package.json` | 新增 `tar@^7.4.3` 依赖 |
| 2026-10-24 16:07:36 | 验证 | `xhs.device.following-comments` | 新增 1289 行后真机回归通过 |
| 2026-10-24 16:07:36 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.23：三个丢失业务模块补齐 + 对拍证据 |
| 2026-10-24 15:39:23 | bug修复 | `packages/client/ui/login.html` | UI 从未传 `smsProvider`/`heroSms` 配置（后端能收但前端不生成），端到端链路断开 |
| 2026-10-24 15:39:23 | 新增 | `packages/client/ui/login.html` | 价格行点击选中 → `state.heroMaxPrice` + 高亮 + 详情标签（旧 `_on_herosms_price_changed`） |
| 2026-10-24 15:39:23 | bug修复 | `packages/client/ui/login.html` | 区号错用 `country.dialCode`（HeroSMS 国家结构无此字段），改为独立输入框（旧版是用户手填） |
| 2026-10-24 15:39:23 | bug修复 | `packages/flow/flow-xhs/src/herosms-login.ts` | 前置校验 2 项 → 3 项，文案精确到缺哪项 |
| 2026-10-24 15:39:23 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.22：HeroSMS 端到端补齐（逐层核对 + 四处修复） |
| 2026-10-24 15:19:31 | 新增 | `packages/device/device/src/index.ts` | `disconnect()` 能力（旧 `adb_disconnect`，4 处调用） |
| 2026-10-24 15:19:31 | 修改 | `packages/device/device-adb/src/index.ts` | `connect()` 改为「先 disconnect 再 connect + 延迟 1-2s」，与旧 `adb_connect` 一致 |
| 2026-10-24 15:19:31 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.21：282 个旧函数全量审计（A 架构差异 120 / B 名字不同 18 / C 真缺口 1 / D 死代码 8） |
| 2026-10-24 15:19:31 | 验证 | `xhs.device.following-comments` | disconnect 改动后真机回归通过 |
| 2026-10-24 15:07:23 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.20：纠正「只差 UA/重试」的错误结论——`fetch_url_content`（DrissionPage）是死代码不移植；`_new` 版已逐项对齐 |
| 2026-10-24 14:40:40 | 删除 | `packages/app/kernel/src/kernel.ts` | 移除 `/api/devices/reset-capability`、`trySwitchModelV3`、`setPhoneModel` 回落（旧代码不用 oem_data） |
| 2026-10-24 14:40:40 | 删除 | `packages/myt/{myt-host,myt-api-v2}/src/index.ts` | 移除 `probeOemData` / `setPhoneModel` |
| 2026-10-24 14:40:40 | 删除 | `packages/client/ui/login.html` | 移除能力探测与「指定机型」禁用逻辑 |
| 2026-10-24 14:40:40 | 修改 | `packages/app/kernel/src/kernel.ts` | reset-device 分支按旧 `_run_device_reset` 重写：android 14/16 走 V3，其余走 App UI |
| 2026-10-24 14:40:40 | 验证 | `xhs.device.one-click-new` | 清理后真机通过：`CPH2009` → `SM-F711N` |
| 2026-10-24 14:40:40 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.19：oem_data 核实结论 + 移除清单 + 重写说明 |
| 2026-10-24 14:33:04 | 新增 | `packages/app/kernel/src/kernel.ts` | `POST /api/herosms/cancel`（取消购买 = setStatus 6） |
| 2026-10-24 14:33:04 | 新增 | `packages/client/ui/login.html` | 活动号码「取消」按钮接线 + 确认框 + 刷新 |
| 2026-10-24 14:33:04 | 新增 | `packages/client/ui/login.html` | HeroSMS 启用互斥（禁用文件/区号/登录模式/清除按钮） |
| 2026-10-24 14:33:04 | 新增 | `packages/client/ui/login.html` | 代理池「N机/Nip」联动（设备数÷每IP机数，实测 71÷3=24） |
| 2026-10-24 14:33:04 | 新增 | `packages/client/ui/login.html` | 清除已导入账号确认框 + 互斥状态刷新 |
| 2026-10-24 14:33:04 | 修改 | `packages/client/ui/login.html` | 登录提交传 `proxies` / `proxyMachinesPerIp` |
| 2026-10-24 14:33:04 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.18：全面盘点结论 + 四项补齐 + 实测 |
| 2026-10-24 12:06:21 | 新增 | `packages/app/kernel/src/kernel.ts` | HeroSMS 接入 `/batch-login` 链：provider=herosms 走 `loginWithHeroSms`（不叠加外层重试） |
| 2026-10-24 12:06:21 | bug修复 | `packages/app/kernel/src/kernel.ts` | 登录 flow 工厂只认启动注入的 client，改为按 `heroSmsApiKey` 现建客户端（一单一号） |
| 2026-10-24 12:06:21 | bug修复 | `packages/app/kernel/src/kernel.ts` | 编排层异常无 run 记录，UI 看不出失败；catch 补 `pre:login-chain` run + step/failed |
| 2026-10-24 12:06:21 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.17 |
| 2026-10-24 11:17:42 | 新增 | `packages/myt/myt-api-v2/src/index.ts` | `getApiInfo` / `queryS5Proxy` / `stopS5Proxy` / `setDeviceLanguageCountry`（后三个直连容器） |
| 2026-10-24 11:17:42 | 新增 | `packages/myt/myt-host/src/index.ts` | 上述 4 个方法进契约 |
| 2026-10-24 11:17:42 | 新增 | `packages/device/{device,device-adb}/src/index.ts` | `pushImagesToGallery`（批量上传，失败跳过） |
| 2026-10-24 11:17:42 | 新增 | `packages/flow/flow-xhs/src/mmkv.ts` | MMKV 解析器：`decodeVarint` / `parseMmkvRaw` / `describeMmkvValue`（与旧 Python 逐项对拍一致） |
| 2026-10-24 11:17:42 | 新增 | `packages/app/kernel/src/tabs/update-checker.ts` | 版本检查 `checkUpdates`（含 4 类异常文案映射） |
| 2026-10-24 11:17:42 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.16：tools/ 收尾清单 + 解析器对拍 + 旧代码 bool 缺陷留档 |
| 2026-10-24 10:32:48 | 新增 | `packages/flow/flow-xhs/src/herosms-login.ts` | HeroSMS 登录编排：取号 → 最多 2 次登录 → 成功置 3 / 失败置 6（finally 保证），6 组桩测试通过 |
| 2026-10-24 10:32:48 | 删除 | `packages/flow/flow-xhs/src/safety-verification.ts` | 重复实现（`verification.ts` 已有更完整版本），删除避免分叉 |
| 2026-10-24 10:32:48 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.15：覆盖率复核（6 项误报已存在）+ 路径约定说明 + HeroSMS 编排 |
| 2026-10-24 09:55:09 | 验证 | `xhs.device.one-click-new` | 指定机型模式真机通过：`Pixel 3` → `CPH2009`/OPPO（旧 docstring 示例参数），品牌/型号层级路径成立 |
| 2026-10-24 09:55:09 | 修改 | `docs/spec/login-tab-implementation.md` | §11.14 补指定机型验证 + 版本沿革对照 + 清理残留的旧记录 |
| 2026-10-24 09:51:32 | bug修复 | `docs/spec/login-tab-implementation.md` | 修正错误结论「当前 App 无 textView1/set_card_property」——实为 dump 抓到了流程终点页；改为三段页面序列 + 两设备对照实测 |
| 2026-10-24 09:51:32 | 验证 | `xhs.device.one-click-new` | 5001（装小红书）真机跑通：`SM-G986N` → `Pixel 3`；5002（未装）失败，确认为旧代码固有前提 |
| 2026-10-24 09:35:24 | 修改 | `packages/flow/flow-xhs/src/one-click-new.ts` | 回退主动改动，按旧 `One_click_new_device.py` 逐函数一比一复刻（8 个函数 + 原样路径 + 原样失败行为） |
| 2026-10-24 09:35:24 | 修改 | `docs/spec/login-tab-implementation.md` | §11.14 补充：严格复刻实现对照表 + 实测失败原因（当前 App 已无 textView1/set_card_property/random_btn） |
| 2026-10-24 09:21:41 | 新增 | `packages/flow/flow-xhs/src/one-click-new.ts` | 一键新机流程：操作容器内 `com.blue.backup` 的 UI（非 SDK），移植自 `One_click_new_device.py` 255 行 |
| 2026-10-24 09:21:41 | 修改 | `packages/app/kernel/src/kernel.ts` | 注册 `xhs.device.one-click-new` 工厂（brand/model/overseasRandom） |
| 2026-10-24 09:21:41 | 修改 | `packages/app/kernel/src/tabs/login-tab.ts` | 新增 `one-click-new` 动作映射 |
| 2026-10-24 09:21:41 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.14：一键新机真相（UI 自动化）+ 指纹来源查证 + 路径偏移修正 + 真机验证 |
| 2026-10-24 08:59:17 | bug修复 | `packages/flow/flow-xhs/src/herosms.ts` | `getCountries` 解析字段错（读 `name`/`dialCode`），实际是三语言名 `rus`/`eng`/`chn` + `visible`/`retry`/`rent` |
| 2026-10-24 08:59:17 | 修改 | `packages/client/ui/login.html` | 国家下拉显示中文名 + ID，搜索支持三语言名 |
| 2026-10-24 08:59:17 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.13：国家字段映射 + 4 按钮实测 |
| 2026-10-24 08:52:30 | 新增目录 | `packages/myt/myt-api-v3/` | v3 SDK 客户端独立包（`@myt/myt-api-v3`） |
| 2026-10-24 08:52:30 | 新增 | `packages/myt/myt-api-v3/src/index.ts` | 1:1 移植 `MYT_V3_SDK.py` 12 个函数：listAndroids/hostInfo/adbAddrs/phoneModelList/switchModel/randomSwitchModel/parseAndroidVersion 等 |
| 2026-10-24 08:52:30 | 修改 | `packages/app/kernel/src/kernel.ts` | 注册 `MytApiV3` 插件；换机型优先走 v3 `switchModel`，不可达回落 v2 |
| 2026-10-24 08:52:30 | 修改 | `packages/app/kernel/src/kernel.ts` | 能力探测扩展：返回 `via`（v3 / v2-oem / none）并聚合两条路径的失败原因 |
| 2026-10-24 08:52:30 | 修改 | `packages/client/ui/login.html` | 提示文案显示指定机型的能力来源 |
| 2026-10-24 08:52:30 | 修改 | `packages/app/kernel/package.json` | 新增 `@myt/myt-api-v3` 依赖 |
| 2026-10-24 08:52:30 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.12：v3 协议差异 + 12 函数移植清单 + 桩单测 + 两级回落 |
| 2026-10-24 08:44:20 | 新增 | `packages/myt/myt-api-v2/src/index.ts` | `probeOemData`：用假路径调 `generate_device_config` 判定 oem_data 是否预置 |
| 2026-10-24 08:44:20 | 新增 | `packages/myt/myt-host/src/index.ts` | 契约新增 `probeOemData` |
| 2026-10-24 08:44:20 | 新增 | `packages/app/kernel/src/kernel.ts` | `GET /api/devices/reset-capability`（random/specified + 原因） |
| 2026-10-24 08:44:20 | 修改 | `packages/client/ui/login.html` | 打开批导入时探测能力：指定机型不可用时禁用 radio + 提示原因 |
| 2026-10-24 08:44:20 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.11：oem_data 溯源结论 + V3 8000 端口发现 + 能力探测 |
| 2026-10-24 08:36:32 | bug修复 | `packages/myt/myt-api-v2/src/index.ts` | `set_custom_devinfo` 参数名错（`modelid` → `set_custom_devinfo`），且漏了必填 `userip` |
| 2026-10-24 08:36:32 | bug修复 | `packages/myt/myt-api-v2/src/index.ts` | `resetDeviceInfoAsync` 的 `modelId` 被实测证明无效（传 54 实际换 SM-A705F），移除该参数避免误导 |
| 2026-10-24 08:36:32 | 修改 | `packages/myt/myt-host/src/index.ts` | 契约标注三条路径的能力边界（random 系不支持指定机型；指定需 oem_data） |
| 2026-10-24 08:36:32 | 修改 | `packages/app/kernel/src/kernel.ts` | 换机型分两路：指定走 `setPhoneModel`（失败不降级）、随机走异步版 |
| 2026-10-24 08:36:32 | 新增 | `packages/app/kernel/src/kernel.ts` | 前置动作可观测：每步开 run（`pre:reset-device` 等），失败原因进事件流 |
| 2026-10-24 08:36:32 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.10：三条路径能力差异 + 静默忽略证据 + 代码决策 |
| 2026-10-24 08:22:20 | bug修复 | `packages/myt/myt-api-v2/src/index.ts` | `setPhoneModel` 端点写错（`get_phone_model_list`/`switch_phone_model` 不存在），改用 `random_devinfo` / `set_custom_devinfo`；新增 `listDeviceModels` |
| 2026-10-24 08:22:20 | 新增 | `packages/myt/myt-api-v2/src/index.ts` | `resetDeviceInfoAsync`：`random_devinfo_async2` 的 request/query 两段式 + 完整状态码处理 |
| 2026-10-24 08:22:20 | 新增 | `packages/myt/myt-host/src/index.ts` | 契约新增 `listDeviceModels` / `resetDeviceInfoAsync` |
| 2026-10-24 08:22:20 | 修改 | `packages/app/kernel/src/kernel.ts` | `/api/devices/models` 优先 SDK（带 modelId）、过滤 `global_id`、返回 `modelIds` |
| 2026-10-24 08:22:20 | 修改 | `packages/app/kernel/src/kernel.ts` | `reset-device` 改用异步版 + `waitForStableAdb` 等待恢复（替代固定 sleep） |
| 2026-10-24 08:22:20 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.9：端点核实、异步时序、真机前后对比 |
| 2026-10-24 03:33:27 | 新增 | `packages/app/kernel/src/tabs/job-scheduler.ts` | 同 IP 批调度（每组首块立即、后续延迟）+ `waitForStableAdb`（稳定 20s/重连 10s/超时 120s） |
| 2026-10-24 03:33:27 | 新增 | `packages/app/kernel/src/tabs/proxy-pool.ts` | S5 代理池（轮转分配/按设备回收/`requiredProxyCount`）+ `parseProxyText` |
| 2026-10-24 03:33:27 | 新增 | `packages/myt/myt-host/src/index.ts` | 契约新增 `setS5Proxy` / `setPhoneModel` |
| 2026-10-24 03:33:27 | 新增 | `packages/myt/myt-api-v2/src/index.ts` | 实现上述两项（代理直连容器 `/proxy`；机型走 SDK） |
| 2026-10-24 03:33:27 | 修改 | `packages/app/kernel/src/tabs/login-chain.ts` | 新增前置动作 `switch-container`/`set-proxy`/`reset-device` + `beginChain` |
| 2026-10-24 03:33:27 | 修改 | `packages/app/kernel/src/kernel.ts` | `/batch-login` 接入批调度/代理池/前置动作/失败重试 + 4 条校验 |
| 2026-10-24 03:33:27 | bug修复 | `packages/app/kernel/src/kernel.ts` | 行号区间替换误删 `/batch` 尾部，导致 config/opts 丢失、两路由混淆；已重建 |
| 2026-10-24 03:33:27 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.8 |
| 2026-10-24 03:20:55 | 新增 | `packages/app/kernel/src/tabs/login-chain.ts` | 登录后置链状态机：9 个开关 + 动作队列 + 循环/重试余量 + `advanceChain` |
| 2026-10-24 03:20:55 | 新增 | `packages/app/kernel/src/kernel.ts` | `POST /api/tabs/login/batch-login` 链式登录（含 3 条前置校验） |
| 2026-10-24 03:20:55 | 新增 | `packages/flow/flow-xhs/src/device-flows.ts` | `setFollowingCommentsFlow`（仅关注可评论，3 轮幂等点击） |
| 2026-10-24 03:20:55 | 修改 | `packages/app/kernel/src/tabs/login-tab.ts` | 新增 `following-comments` 动作映射 |
| 2026-10-24 03:20:55 | 修改 | `packages/client/ui/login.html` | 登录模式弹窗补齐 4 数值字段 + 6 复选框；「立即登录」改走 batch-login |
| 2026-10-24 03:20:55 | bug修复 | `packages/app/kernel/src/tabs/login-chain.ts` | 后置动作顺序错（绑定被放到改资料之前），按旧版 6060-6175 纠正 |
| 2026-10-24 03:20:55 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.7：链路顺序/状态机/接口/7 组单测/真机验证 |
| 2026-10-24 03:07:25 | 新增 | `packages/app/kernel/src/tabs/device-models.ts` | 机型库解析（15 品牌 / 291 机型），跳过非对象键 |
| 2026-10-24 03:07:25 | 新增 | `packages/app/desktop/resources/tools/devices.json` | 机型库数据（移植自旧 `static/devices.json`） |
| 2026-10-24 03:07:25 | 修改 | `packages/app/desktop/src/main.cjs` | 新增 `MYT_DEVICES_JSON` 环境变量 |
| 2026-10-24 03:07:25 | 修改 | `packages/app/kernel/src/kernel.ts` | 新增 `GET /api/devices/models` 与 `POST /api/herosms/{balance,countries,prices,activations}` |
| 2026-10-24 03:07:25 | 修改 | `packages/flow/flow-xhs/src/herosms.ts` | 新增 `getCountries` / `getPrices`（OFFERS_URL）/ `getActiveActivations` |
| 2026-10-24 03:07:25 | 修改 | `packages/client/ui/login.html` | 新机配置页签（模式/品牌/型号多选/已选表） |
| 2026-10-24 03:07:25 | 修改 | `packages/client/ui/login.html` | HeroSMS 页签（API Key/国家搜索/价格表/11 列活动号码表） |
| 2026-10-24 03:07:25 | bug修复 | `packages/client/ui/login.html` | 批量替换覆盖了新机配置 JS，导致指定机型面板不显示 |
| 2026-10-24 03:07:25 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11.6 |
| 2026-10-24 02:51:01 | 修改 | `packages/client/ui/login.html` | 设备列表按 `xhs_device_tab/device_tab.py` 重做：5 列 + 设置按钮 + 三层树 + 行底色 + 折叠/展开全部/右键/双击复制 |
| 2026-10-24 02:51:01 | 修改 | `packages/client/ui/login.html` | 选中模型对齐 `on_tree_item_changed`：取消重置容器、组头三态、容器互斥、刷新保留 |
| 2026-10-24 02:51:01 | 修改 | `packages/client/ui/login.html` | 登录模式弹窗重写为旧 `LoginModeDialog` 形态（竖排三字段 + 两按钮） |
| 2026-10-24 02:51:01 | 修改 | `packages/client/ui/login.html` | 设置登录源弹窗重写为旧 `DeviceSourceDialog`（3 型横排 + 区号 + 浏览） |
| 2026-10-24 02:51:01 | 新增 | `packages/client/ui/login.html` | 批导入账号 8 页签对话框（账号/头像/昵称/代理/新机配置/关注/绑定/HeroSMS） |
| 2026-10-24 02:51:01 | 修改 | `packages/app/kernel/src/tabs/device-source.ts` | 验证码登录源格式改为旧版 `区号-值` |
| 2026-10-24 02:51:01 | 修改 | `docs/spec/login-tab-implementation.md` | 新增 §11：参考文件修正 + 设备列表/选中模型/批导入逐项对照 + 实测 |
| 2026-10-24 00:41:32 | 新增 | `packages/app/kernel/src/tabs/device-source.ts` | 登录源模型与落盘存储：`bundle`/`sid`/`sms` 三型 + 格式校验 + 原子写 `device-sources.json` |
| 2026-10-24 00:41:32 | 新增 | `packages/app/kernel/src/kernel.ts` | `/api/tabs/login/source` 接口（409 拦截运行中设备） |
| 2026-10-24 00:41:32 | 修改 | `packages/app/kernel/src/kernel.ts` | 设备行读真实登录源（原写死 `none`） |
| 2026-10-24 00:41:32 | 修改 | `packages/client/ui/login.html` | 6 处交互对齐：登录源可编辑、IP 分组+半选、只挑空闲设备、双击复制、全选文案、弹窗互斥 |
| 2026-10-24 00:41:32 | bug修复 | `packages/client/ui/login.html` | 弹窗叠层（SID 上号盖住单项任务）；旧版靠 Qt setModal 避开的，HTML 版必须显式关闭 |
| 2026-10-24 00:41:32 | 新增 | `docs/spec/login-tab-implementation.md` §10 | 交互对齐清单（6 项）+ 本版新增 3 项 + 实测记录 |
| 2026-10-24 00:10:00 | 新增 | `packages/client/ui/login.html` | 工具栏新增「SID 上号」「恢复备份包」两个入口 + 两个弹窗（SID 批量输入框 / 备份目录+模式选择） |
| 2026-10-24 00:10:00 | 修改 | `packages/app/kernel/src/tabs/login-tab.ts` | `SINGLE_TASKS` 新增 3 项：提取 SID / SID 上号 / 恢复备份包 |
| 2026-10-23 23:57:42 | 新增 | `packages/flow/flow-xhs/src/mmkv.ts` | MMKV 生成器（主文件+CRC+login_user_info+login_activate），6 个文件 SHA-256 与 Python 参考实现逐字节一致 |
| 2026-10-23 23:57:42 | 新增 | `packages/flow/flow-xhs/src/sid-flows.ts` | 三条流程：SID 提取（三级兜底）/ 上号（写 6 文件+restorecon+回读校验）/ 清数据 |
| 2026-10-23 23:57:42 | 新增 | `packages/flow/flow-xhs/src/state-restore.ts` | 备份包恢复：4 分组 × 2 模式，跨 3 目录，权限推断 + SELinux 重打标签 |
| 2026-10-23 23:57:42 | 新增 | `packages/flow/flow-xhs/src/herosms.ts` | HeroSMS 客户端（SMS-Activate 协议），含 API key 脱敏与 verify 轮询 |
| 2026-10-23 23:57:42 | 修改 | `packages/device/device/src/index.ts` | 新增 `pushPrivateFile` / `readRemoteFile` / `appUid` 三个能力 |
| 2026-10-23 23:57:42 | 修改 | `packages/device/device-adb/src/index.ts` | 实现上述三个能力（base64 传二进制、POSIX 引号转义） |
| 2026-10-23 23:57:42 | 修改 | `packages/core/flow/src/index.ts` | `StepDefinition.run` 返回 `void \| string`，字符串写为 step note |
| 2026-10-23 23:57:42 | 修改 | `packages/app/kernel/src/tabs/login-tab.ts` | 新增 `ACTION_FLOWS` 查表，替代 8 层三元表达式 |
| 2026-10-23 23:57:42 | 修改 | `packages/app/kernel/src/kernel.ts` | 注册 4 个新流程；batch 动作 +2（sid-extract / restore-state） |
| 2026-10-23 23:57:42 | 新增 | `docs/spec/login-tab-implementation.md` §9 | 第四批记录：字节布局、对拍哈希、两个必做步骤、安全要求 |
| 2026-10-23 22:43:19 | 新增 | `packages/flow/flow-xhs/src/device-flows.ts` | 三条流程：改资料（改名+头像，各 2 次重试）、关注（关键词+9 轮+复查）、绑定手机号（3 轮找页/29 轮区号/5 次重试输入/3 轮取码） |
| 2026-10-23 22:43:19 | 新增 | `packages/flow/flow-xhs/src/{profile,follow,bind-phone}-locators.ts` | 定位函数逐位搬运：profile 9 个、follow 3 个、bind-phone 4 个（含五语言手机号标签） |
| 2026-10-23 22:43:19 | 修改 | `packages/device/{device,device-adb}/src/index.ts` | 新增 `pushToGallery`（目录优先级 + MediaStore 注册 + 广播回落） |
| 2026-10-23 22:43:19 | 修改 | `packages/app/kernel/src/kernel.ts` | 注册 3 个参数化工厂；batch 动作支持 modify-profile/follow-user/bind-phone；统一 `resolveParams` |
| 2026-10-23 22:43:19 | 修改 | `packages/client/ui/login.html` | 单项任务 6 项接真实流程（改资料/关注/绑定手机号收集参数） |
| 2026-10-23 22:43:19 | bug修复 | `packages/flow/flow-xhs/src/follow-locators.ts` | 关注/已关注按**文本精确匹配**（原用 includes 会把「已关注」误判为「关注」） |
| 2026-10-23 22:43:19 | 新增 | `docs/spec/login-tab-implementation.md` §8 | 第三批翻译记录 + 实测两个业务前提（个人信息保护弹窗、未登录页面退回） |
| 2026-10-23 22:15:18 | 新增 | `packages/app/kernel/src/tabs/{llm-config,account-import}.ts` | LLM 配置读写 + 安全验证识图（移植 check_safety_verification）；5 模式账号解析（移植 device_tab 解析函数） |
| 2026-10-23 22:15:18 | 新增 | `packages/flow/flow-xhs-device/src/index.ts` | `xhs.device.clear`（5 步）+ `xhs.device.backup`（5 步），含 FILE_GROUPS/MODE_GROUPS |
| 2026-10-23 22:15:18 | 修改 | `packages/app/kernel/src/kernel.ts` | 注册清除/备份流程；`/api/tabs/login/llm` 读写；`/api/accounts/import`；LLM 识图注入登录流程 |
| 2026-10-23 22:15:18 | 修改 | `packages/device/{device,device-adb}/src/index.ts` | 新增 `shell(command,{root,check})` 与 `pullPrivateFile`；root 命令整体加引号（修复 su 分词 bug） |
| 2026-10-23 22:15:18 | 修改 | `packages/client/ui/login.html` | 大模型配置弹窗、批导入账号弹窗（5 模式）；清除/备份按钮接真实流程 |
| 2026-10-23 22:15:18 | bug修复 | `packages/app/kernel/src/tabs/llm-config.ts` | LLM 配置独立为 `llm-config.json`，避免与 devices.json（数组）混写破坏设备身份 |
| 2026-10-23 20:07:09 | 新增 | `packages/client/ui/login.html` | 上号标签页：4 区布局、17 控件、单项任务弹窗、登录设置弹窗、日志弹窗 |
| 2026-10-23 20:07:09 | 新增 | `packages/app/kernel/src/tabs/login-tab.ts` | 上号契约：DeviceRow/SourceKind/RowStatus、checkBatchAction、parseSmsCodeLogin、SINGLE_TASKS |
| 2026-10-23 20:07:09 | 新增 | `docs/spec/login-tab-implementation.md` | 上号标签页控件对照表、按钮链路、已实现/未实现清单、真机验证证据 |
| 2026-10-23 20:07:09 | 修改 | `packages/app/kernel/src/kernel.ts` | 新增 `/api/tabs/login/{rows,tasks,check,batch,cancel}`、`/api/accounts/parse-sms`、`/login` 页面路由 |
| 2026-10-23 20:07:09 | 修改 | `packages/core/flow/src/index.ts` | `FlowRunner` 支持 `abortSignal`（协作式取消）+ `RunCancelled` + `StepContext.throwIfCancelled` |
| 2026-10-23 20:07:09 | 修改 | `packages/app/kernel/src/{main,host}.ts` | 透传 `MYT_SEED` 与工具链路径 |
| 2026-10-23 20:07:09 | 修改 | `packages/app/desktop/{package.json,src/main.cjs}` | 内置 adb/yadb/ADBKeyboard 到 `resources/tools` 并传给内核 |
| 2026-10-23 19:22:01 | bug修复 | `packages/flow/flow-xhs/src/{state-locators,guide-locators,verification,index}.ts` | 修完 6 个 P1：网格 `sleep(10)`、转圈计数含根节点、服务器出错不要求 clickable、安全验证超时连点参数、取码直连禁代理、区号列表「不了」兜底 |
| 2026-10-23 19:07:03 | 新增 | `docs/spec/legacy/port-mapping-login.md` | auto_login.py 全量移植对照表：文件映射、3 个致命细节、关键数值、审核记录、未修 P1 |
| 2026-10-23 19:07:03 | bug修复 | `packages/device/device-adb/src/index.ts` | P0：`tapLikeHuman` 重写为高斯偏移 + 三档间隔 + 70/20/10 按压加权 + rightBoundary-20；`ensureIme` 补 root 强切 |
| 2026-10-23 19:07:03 | bug修复 | `packages/flow/flow-xhs/src/locators.ts` | P0：手机号路径补至 10 条 + QQ/微博排除；区号补第 6 条路径 + 子节点文本回落；同意并继续只留生效路径 |
| 2026-10-23 19:07:03 | bug修复 | `packages/flow/flow-xhs/src/dialogs.ts` | P0：`getLaterButtonPosition` 改用运行时生效的「稍后再说」路径 |
| 2026-10-23 19:07:03 | 新增 | `packages/flow/flow-xhs/src/login-steps.ts` | 发码判定（2 轮 + 5×3 连点 + k/j 循环）、验证码 6 轮重发（含 `CodeRejected` 回环）、引导页循环、`loginWithRetry` |
| 2026-10-23 19:07:03 | 修改 | `packages/flow/flow-xhs/src/index.ts` | 步骤顺序修正为「发码 → 取码循环」；引导页移入循环内部 |
| 2026-10-23 18:01:03 | 新增 | `packages/device/human/src/index.ts` | 拟人化原语 1:1 移植（高斯偏移、按压加权、burst、可复现 Random） |
| 2026-10-23 18:01:03 | 新增 | `packages/flow/flow-xhs/src/{locators,state-locators,dialogs,actions,paths}.ts` | 定位函数与动作原语按 auto_login.py 完整移植（路径数组逐条一致） |
| 2026-10-23 18:01:03 | 修改 | `packages/flow/flow-xhs/src/index.ts` | 登录流程按 main() 顺序重写为 11 步（含弹窗、29 轮区号、列表切换、清除、5 次重试输入、发码） |
| 2026-10-23 18:01:03 | 修改 | `packages/device/{device,device-adb}/src/index.ts` | 新增 `tapLikeHuman`（swipe 式按压）、`pressKey`、`ensureIme`、`ensureYadb`、yadb 通道、`focused` 属性 |
| 2026-10-23 18:01:03 | bug修复 | `packages/device/device-adb/src/index.ts` | 纯 ASCII 输入改走 `input text`：ADBKeyboard 广播异步，连续 burst 会乱序（实测号码变成 `180 3000 8013`） |
| 2026-10-23 16:31:56 | 新增目录 | `packages/core/{runs,flow}`、`packages/device/{device,device-adb,locator}`、`packages/flow/flow-xhs` | 运行事件流、流程引擎、设备接缝与 ADB Provider、定位器、小红书流程包 |
| 2026-10-23 16:31:56 | 新增 | `packages/core/runs/src/index.ts` | `ctx.runs`：8 类事件、5 类错误、checkpoint、中断标记、保留上限 |
| 2026-10-23 16:31:56 | 新增 | `packages/core/flow/src/index.ts` | `FlowRunner` + `ctx.flows`：步骤跳过/重试/分类，只在 transient+wrong-page 重试 |
| 2026-10-23 16:31:56 | 新增 | `packages/device/{device,device-adb,locator}/src/index.ts` | 设备接缝、ADB Provider（uiautomator 自解析）、多策略定位器 |
| 2026-10-23 16:31:56 | 新增 | `packages/flow/flow-xhs/src/index.ts` | 深链常量 + `xhs.probe` 三步探测流程 |
| 2026-10-23 16:31:56 | 修改 | `packages/app/kernel/src/{kernel,main,host}.ts` | 装载设备/流程插件；新增 `/api/{flows,runs}`、`/api/device/{connect,dump,tap}`；`MYT_ADB_PATH` |
| 2026-10-23 16:31:56 | 修改 | `packages/client/ui/index.html` | 工具栏新增「跑探测流程」 |
| 2026-10-23 16:31:56 | bug修复 | `packages/core/flow/src/index.ts` | 错误分类顺序错误：`device not found` 被误判为 wrong-page，改为先判 precondition |
| 2026-10-23 16:19:49 | 新增 | `docs/adr/ADR-0003-desktop-delivery.md` | 桌面交付决策：Electron 壳 + Node 内核跑 utilityProcess + esbuild 单文件 + NSIS；含构建环境坑 |
| 2026-10-23 16:19:49 | 新增 | `packages/app/desktop/src/main.cjs`、`preload.cjs` | Electron 壳：单实例、端口协商、健康检查、托盘、窗口生命周期、崩溃上报 |
| 2026-10-23 16:19:49 | 新增 | `packages/app/kernel/src/{kernel,host,parent-port}.ts`、`scripts/build.mjs` | 内核拆为可嵌入启动器 + utilityProcess 入口 + esbuild 打包（77KB 单文件） |
| 2026-10-23 16:19:49 | 新增 | `packages/app/desktop/build/icon.ico`、`src/icon.png` | 应用图标（脚本生成，7 种尺寸） |
| 2026-10-23 16:19:49 | 新增 | `packages/app/desktop/dist/MYT-0.0.1-Setup.exe` | NSIS 安装包（81.8MB，未签名） |
| 2026-10-23 15:14:56 | 新增 | `packages/core/devices/src/index.ts` | `ctx.devices`：按容器 id 对账生成 DeviceId、墓碑、状态落盘 |
| 2026-10-23 15:14:56 | 修改 | `packages/myt/myt-host/src/index.ts` | 接缝新增 `startContainer` / `stopContainer`（变更类，不重试） |
| 2026-10-23 15:14:56 | 修改 | `packages/myt/myt-api-v2/src/index.ts` | 实现启动/停止，`force` 走 query |
| 2026-10-23 15:14:56 | 修改 | `packages/app/kernel/src/main.ts` | 装载 Registry；新增 `/api/devices`、`POST /api/actions/{start,stop}`（调一次 + 回查状态） |
| 2026-10-23 15:14:56 | 修改 | `packages/client/ui/index.html` | 操作列：启动/停止，坑位被占用时提示强制接管 |
| 2026-10-23 15:11:30 | 新增目录 | `packages/` | pnpm workspace：`myt/myt-host`、`myt/myt-api-v2`、`app/kernel`、`client/ui` |
| 2026-10-23 15:11:30 | 新增 | `packages/myt/myt-host/src/index.ts` | 宿主能力接缝定义：`MytHost` 抽象类、`ContainerInfo`、`HostSystemInfo`、`ctx.mytHost` 声明合并 |
| 2026-10-23 15:11:30 | 新增 | `packages/myt/myt-api-v2/src/index.ts` | v2 Provider：三个只读接口，state 收敛，系统信息兼容 snake_case |
| 2026-10-23 15:11:30 | 新增 | `packages/app/kernel/src/main.ts` | 内核入口：Cordis 装配 + HTTP 路由 + 优雅退出 |
| 2026-10-23 15:11:30 | 新增 | `packages/client/ui/index.html` | 设备农场页面：宿主切换、统计卡、状态筛选、搜索、容器表 |
| 2026-10-23 15:11:30 | 新增 | `package.json`、`pnpm-workspace.yaml`、`tsconfig.json`、`.gitignore` | 工程根配置 |
| 2026-10-23 15:01:13 | 新增 | `docs/spec/runtime-and-storage.md` | 数据平面、事件模型、投影与崩溃恢复、产物存储、保留策略、NSIS 分发与可配置更新源 |
| 2026-10-23 15:00:43 | 新增 | `docs/spec/ui-information-architecture.md` | UI 信息架构提案：9 路由、设备农场、任务中心、三步任务向导、旧控件迁移对照 |
| 2026-10-23 15:00:13 | 新增 | `docs/spec/shared-steps.md` | 共享步骤库：设备就绪、定位器抽象、动作、等待、断言、HumanPolicy、错误分类、三标签页覆盖矩阵 |
| 2026-10-23 14:59:34 | 新增 | `docs/spec/legacy/login.md` | 上号器规格：22 步登录、5 种登录源、链式任务、14 项缺陷、移植要点 |
| 2026-10-23 14:59:34 | 新增 | `docs/spec/legacy/publish.md` | 笔记发布规格：20 步发布、9 列契约、8 个人工介入点、5 个不可重试点 |
| 2026-10-23 14:59:34 | 新增 | `docs/spec/legacy/comment.md` | 评论规格：17 步链路、风控参数全表、新旧引擎差异、16 项缺陷 |
| 2026-10-23 14:59:34 | 修改 | `docs/reference/auto-object-legacy.md` | 新增「三标签页功能规格」章节：规模表、8 项共有问题、复刻约束 |
| 2026-10-23 14:59:34 | 新增目录 | `docs/spec/legacy/` | 旧项目标签页逐按钮规格目录 |
| 2026-10-23 14:56:00 | 新增 | `STYLE.md` | 代码风格：TS/ESM、包命名、branded ID、错误处理、生命周期、事件、测试、Git |
| 2026-10-23 14:56:00 | 新增目录 | `docs/plan/` | 实施计划与验收标准目录 |
| 2026-10-23 14:56:00 | 新增 | `docs/plan/slice-a-acceptance.md` | 切片 A 验收标准草案（A1–A10 场景 + 证据要求 + DoD） |
| 2026-10-23 14:52:00 | 新增 | `CONTEXT.md` | 唯一术语源：实体/执行模型/架构名词 + 禁用同义词 + 使用规则 |
| 2026-10-23 14:52:00 | 新增 | `resources/sdk/probe_host_info_20261023_145200.json` | 宿主版本与系统信息探测（33GB 内存 / 491GB 磁盘 / 63.2% 占用） |
| 2026-10-23 14:47:52 | 修改 | `docs/adr/ADR-0002-device-identity.md` | 加入实测数据：6 坑位、adb=5000+index、响应 20 字段、匹配改用容器 id |
| 2026-10-23 14:47:30 | 新增 | `resources/sdk/probe_get_192_168_0_113_20261023_144730.json` | 只读探测宿主容器列表（71 容器 / 6 坑位） |
| 2026-10-23 14:47:10 | 修改 | `docs/adr/ADR-0002-device-identity.md` | 修订：引入 Slot 实体（坑位 1–12）、ADB 端点归属坑位、删除=墓碑、指纹校验；补充 get 响应契约 |
| 2026-10-23 14:42:54 | 新增 | `docs/adr/ADR-0002-device-identity.md` | 设备身份：平台 UUID 主键，重装=同设备、克隆=新设备、不可达≠删除 |
| 2026-10-23 14:42:54 | 修改 | `INDEX.md` | 修正 dsh 源码路径为 `reference/deepseek-harness-master/` |
| 2026-10-23 14:42:54 | 新增 | `reference/deepseek-harness-master/` | dsh master 源码解压（128MB / 16,283 文件，只读参考） |
| 2026-10-23 14:41:18 | 新增 | `docs/adr/ADR-0001-architecture-baseline.md` | 架构基线 ADR：D1 定位、D2 TS+Cordis、D3 Electron、D4 插件模型、D5 并发、D6 v1 切片 |
| 2026-10-23 14:41:18 | 新增目录 | `docs/adr/` | 架构决策记录目录 |
| 2026-10-23 14:27:52 | 新增 | `docs/reference/wechat-data-analysis-desktop.md` | WeChatDataAnalysis 桌面交付工程与 UI 范式审计 |
| 2026-10-23 14:20:00 | 新增目录 | `reference/` | dsh 源码检出目录（只读参考） |
| 2026-10-23 14:13:09 | 新增 | `INDEX.md` | 初始化项目索引 |
| 2026-10-23 14:13:09 | 新增 | `docs/reference/auto-object-legacy.md` | 旧项目现状勘察与痛点清单 |
| 2026-10-23 14:13:09 | 新增 | `docs/reference/deepseek-harness-architecture.md` | dsh 架构事实与移植判断 |
| 2026-10-23 14:13:09 | 新增 | `docs/reference/myt-sdk-openapi.md` | MYT SDK 规范审计 |
| 2026-10-23 14:12:19 | 新增目录 | `docs/reference/`、`resources/sdk/` | 参考资料与原始资源目录 |
| 2026-10-23 14:12:19 | 新增 | `resources/sdk/openapi_20261023_141219.json` | 存档 http://127.0.0.1:7878/openapi.json 快照 |
