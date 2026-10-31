# 运行时与存储（提议）

- 状态：提案。以下为推荐默认值，标注「假设」的条目未经用户确认
- 依据：ADR-0001/0002、`docs/spec/shared-steps.md`、`docs/spec/ui-information-architecture.md`

## 1. 数据平面

| 平面 | 存什么 | 介质 | 生命周期 |
|---|---|---|---|
| 事件日志 | 每次运行的全部事实（步骤开始/结束、断言结果、重试、失败原因） | SQLite（WAL），表 `events` | 保留 N 天，可导出 JSONL |
| 业务表 | `hosts` / `slots` / `devices` / `accounts` / `bindings` / `runs` | SQLite，同一库 | 长期 |
| 产物 | 截图、UI dump、完整日志、备份包 | 文件系统（内容寻址） | 保留 M 天，DB 只存引用 |
| 配置 | 卡密、按主机的限流、拟人参数、HeroSMS、代理池 | SQLite / JSON | 长期 |

**假设**：单机部署，SQLite WAL 足够（200 台设备、50 并发写入量是「每步一条事件」，量级远低于 SQLite 上限）。将来多节点再换 PG，事件表结构不变。

## 2. 事件模型

```ts
type RunEvent = {
  runId: RunId
  seq: number              // 单 run 内单调递增
  ts: number
  type:
    | 'run/started' | 'run/finished' | 'run/interrupted'
    | 'step/started' | 'step/retried' | 'step/succeeded' | 'step/failed'
    | 'assert/passed' | 'assert/failed'
    | 'device/online' | 'device/offline'
    | 'container/started' | 'container/stopped' | 'container/switched'
    | 'human/review-required'
  payload: unknown         // 按 type 判别
}
```

规则：

1. **只追加**，不修改、不删除（保留期到才归档）。
2. 每个 step 至少两条事件（started + 终态），失败必须带 `errorKind`（见 shared-steps §9）。
3. 敏感字段（密码、SID、卡密、代理凭据）**写入前脱敏**，不进事件。
4. UI 只读投影，不维护自己的真相。

## 3. 投影

启动时：从业务表加载 → 用未归档事件补齐增量 → 得到内存读模型（设备列表、运行状态）。
运行中：事件写入后同步更新投影并向 UI 推增量（WebSocket）。

崩溃恢复：进程启动时把所有 `runs.status='running'` 标为 `interrupted`，并在 UI 标「需人工核对」——**不自动续跑**（不可重试点见各规格文档）。

## 4. 产物存储

```
data/
  artifacts/
    <sha256前2位>/<sha256>.<ext>     # 截图 / dump / 日志
  bundles/                           # 账号备份包（{sid----uid----did}.zip）
  db.sqlite
```

DB 只存 `{sha256, kind, runId, stepId, size}`。UI 通过本地 HTTP 路由取文件。

## 5. 保留与清理

| 对象 | 默认保留 |
|---|---|
| 事件 | 90 天（可配） |
| 截图 / dump | 30 天 |
| 备份包 | 不自动删（用户资产） |
| 运行日志文本 | 30 天 |

清理任务在空闲时跑，单条事务、可中断。

## 6. 分发与更新

| 项 | 默认 |
|---|---|
| 安装包 | NSIS（`oneClick=false`，可改安装目录），与 WDA 一致 |
| 安装体积 | Electron 壳 + 静态前端 + Node 内核，预计 150–250MB |
| 代码签名 | **必须**；未签名会被 SmartScreen 拦截 |
| 更新源 | 可配置：公网 HTTP / 内网文件服务器 / 关闭 |
| 更新策略 | 检查 → 提示 → 用户确认 → 下载（进度写任务栏）→ 重启安装 |
| 离线环境 | 更新关闭时只提示「有新版本」，不联网 |

**假设**：客户环境可能无外网 → 更新源必须可配、可关，且安装包本身不依赖联网安装。

## 7. 日志与诊断

| 文件 | 内容 |
|---|---|
| `desktop-main.log` | 壳：启动、端口、更新、崩溃 |
| `kernel.log` | 内核：SDK 调用摘要、调度决策 |
| `runs/<runId>.log` | 单次运行的人读日志 |
| `crashes/` | 未捕获异常 + 最近 100 行事件 |

UI 的「运行详情」直接读事件表；「导出诊断包」把上述文件打包下载。

## 8. 待确认

- SQLite 是否够用（按「200 设备 / 50 并发 / 每设备每天 ~2000 事件」估算约 2 万条/天，一年 700 万条，需加时间索引与归档）
- 是否需要多操作员（影响是否要做用户表与权限）
- 更新源的实际形态（公网 / 内网 / 无）

---

# 数据目录解析（不默认存 C 盘）

## 动机

Electron 的 `app.getPath('userData')` 默认落在 `C:\Users\<user>\AppData\Roaming\<app>`。
用户明确要求**不默认存 C 盘**——系统盘满了、重装系统会丢数据。

## 两层分离

| 目录 | 位置 | 存什么 | 为什么 |
|---|---|---|---|
| **配置目录** | `app.getPath('userData')`（系统盘） | `myt.config.json`、`desktop-main.log` | 它是指向数据目录的「指针」，本质是设置 |
| **数据目录** | 见下方优先级 | 流程、设备状态、日志 | 用户的实际资产 |

## 解析优先级

| # | 来源 | 场景 |
|---|---|---|
| 1 | 环境变量 `MYT_DATA_DIR` | 开发期 / 高级用户 |
| 2 | `myt.config.json` 的 `dataDir` | 打包后用户已选过 |
| 3 | 用户首次运行选择的路径 | 弹窗 |
| 4 | **安装目录下的 `data/`** | 便携版（目录可写时） |
| 5 | `userData` | 最后兜底，**界面显示橙色警告** |

## 首次运行弹窗

```
┌──────────────────────────────────────────────┐
│  选择数据存放位置                              │
│                                               │
│  流程、设备状态、日志会保存在这里                │
│  建议选择非系统盘，重装系统时数据不受影响        │
│                                               │
│  当前将使用：F:\MYT\data                       │
│  建议路径：D:\MYT                              │
│                                               │
│  [ 使用安装目录 ] [ 选择其它位置 ] [ 取消 ]     │
└──────────────────────────────────────────────┘
```

- **使用安装目录** → 便携模式，数据跟着程序走
- **选择其它位置** → 打开目录选择器，默认定位到第一个非系统盘
- **取消** → 记下 `skipped: true`，以后不再弹，可在设置里改

**默认预填第一个非系统盘**（`D:`/`E:`/`F:` 依次探测），没有非系统盘才回落到 `userData`。

## 系统盘警告

`/api/data-dir` 返回 `{ dir, onSystemDrive }`。为 `true` 时界面必须显示：

> ⚠ 数据当前存在系统盘（C:），重装系统会丢失。建议在设置里改到其它盘。

## 实现细节

`packages/app/desktop/src/data-dir.ts` 是纯函数式模块，所有外部依赖可注入（env、盘符探测、可写检测），因此可完整单测。

`main.cjs` 是 CommonJS、Electron 直接加载，无法 `require` TS；由 `scripts/build.mjs`
用 esbuild 打成 `data-dir.cjs`。构建命令：

```bash
pnpm --filter myt-desktop run build:data-dir
```

`dist` 脚本已包含这一步。

## 开发期覆盖

```bash
MYT_DATA_DIR=F:/ai/myt_tools/.tmp/dev-data pnpm dev
```

流程会落在 `F:/ai/myt_tools/.tmp/dev-data/workflows/`，可直接打开查看。

## 失效模式

| 现象 | 原因 |
|---|---|
| 数据仍在 C 盘 | 安装目录不可写 且 用户跳过了选择；界面应显示警告 |
| 改了 `MYT_DATA_DIR` 但没生效 | 配置文件里的 `dataDir` 优先级低于 env——应当生效；若未生效检查是否被 `MYT_STATE_FILE` 覆盖 |
| `data-dir.cjs` 与源码不一致 | 忘了跑 `build:data-dir` |
