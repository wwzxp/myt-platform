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
