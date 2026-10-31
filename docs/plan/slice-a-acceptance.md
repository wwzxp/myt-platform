# 切片 A 验收标准（草案）

- 状态：**待确认**（用户未拍板，先作为可执行草案）
- 对应 ADR：ADR-0001 D6
- 目的：用最小闭环验证「插件装配 → SDK 适配 → 设备列表 UI → 打包成 exe」四段链路各自成立

## 范围

### 做

1. pnpm workspace 骨架 + `@myt` 包分组（core/device/myt/app/client/desktop）。
2. Cordis 装配：`bundle-myt` + `profile-desktop`，启动时只挂我们的插件行。
3. `ctx.mytHost` 与 `ctx.myt-api-v2`：实现 4 个只读/低频接口
   - `GET /dc_api/v1/get/{host}`（容器列表）
   - `GET /dc_api/v1/get_host_ver/{host}`
   - `GET /host_api/v1/get_systeminfo/{host}`
   - `POST /dc_api/v1/run/{ip}/{name}?force=1`（启动容器）
   - `GET /dc_api/v1/stop/{ip}/{name}`（停止容器）
4. `ctx.devices` 设备登记与对账（按容器 `id` 匹配，生成 `DeviceId`）。
5. `ctx.runs` 事件流（最小：`host/observed`、`device/registered`、`container/started`、`container/stopped`、`request/failed`）。
6. Electron 壳：单实例、端口协商、`/api/health`、日志、托盘、关闭行为。
7. UI：宿主分组 + 容器列表（虚拟滚动）、状态徽标、单条/批量 启动/停止、截图。
8. NSIS 安装包 + 打包产物冒烟脚本。

### 不做

业务流程（登录/发布/采集）、账号体系、代理池、多节点、插件运行时安装、自动更新。

## 验收场景

| # | 场景 | 通过标准 |
|---|---|---|
| A1 | 冷启动 | 双击安装产物 → **≤15s** 出现界面；宿主 1 台上的容器全部列出；条目数与 `GET get/{host}` 的 `data` 长度一致 |
| A2 | 对账 | 连续刷新 3 次，`DeviceId` 不漂移；`index`、`state`、`adb` 与接口返回值一致；坑位数取自观测最大值而非硬编码 12 |
| A3 | 状态语义 | `running` / `created` / `exited` 在 UI 上可区分；`stopped` 与「未运行」不混用；不可达宿主单列显示，不清空设备 |
| A4 | 强制启动 | 对已占用坑位执行「启动目标容器」→ 平台先停占用者再启动目标；事件流能还原「谁被停、谁被启、耗时」；最终状态与再次 `get` 一致 |
| A5 | 批量启动 | 选中 3 个不同坑位的容器批量启动 → 三台都进入 running；失败项单独标记并给出原因，不阻塞其余 |
| A6 | 截图 | 对 running 设备截图 → 图片成功返回并在界面显示；对非 running 设备给出明确提示而非报错堆栈 |
| A7 | 内核崩溃恢复 | 任务管理器杀掉内核进程 → 壳检测到并重启内核，界面自动恢复连接，托盘菜单可用 |
| A8 | 日志与脱敏 | 每次 SDK 调用有 request/response 摘要；账号/密码/代理密码/SID 不出现在日志与事件中（用关键字扫描验证） |
| A9 | 打包产物 | 在**干净目录**安装 `Setup.exe` → A1–A8 全部通过；卸载后无残留进程 |
| A10 | 冒烟脚本 | `smoke-windows-package.cjs` 对 `dist/win-unpacked` 运行即通过，失败返回非零退出码 |

## 证据要求

- 每个场景留：事件日志片段（JSONL）、界面截图、冒烟脚本输出。
- A2 需附一次「宿主状态变化前后」的对账对比（例如期间在 SDK 侧停掉某个容器）。
- A9 需在未装 Node 的机器或干净用户目录下验证。

## 已知风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| SDK 无响应 schema，字段随版本变化 | 解析失败 | 按实测快照解析 + 缺字段显式降级事件 |
| 变更接口走 GET，可能被中间层重放 | 误停/误启容器 | 变更请求不自动重试；超时后回查 `get` 确认 |
| 强制启动会打断别人正在跑的容器 | 生产事故 | UI 二次确认 + 事件记录被抢占者 |
| Electron 包体与签名 | 交付被 SmartScreen 拦 | 尽早采购签名证书；先出未签名内部版 |

## 完成定义（Definition of Done）

- A1–A10 全部通过，且证据入库（`docs/evidence/slice-a/`）。
- `CONTEXT.md` / `STYLE.md` / `INDEX.md` 与实际结构一致。
- 至少一条行为测试覆盖对账逻辑（`DeviceId` 不漂移、克隆生成新设备）。
