# 术语表（CONTEXT）

本文件是**唯一术语源**。代码标识符、注释、文档、UI 文案必须使用这里的名称；不得引入同义词。
对不上的地方以此为准；需要新增术语时先改本文件再改代码。

## 领域实体

| 术语 | 标识符 | 定义 | 反例（禁止） |
|---|---|---|---|
| 宿主 | `HostId` | 一台魔云腾宿主机（跑安卓容器的物理机），经 SDK HTTP 访问；有 `v2`(7878) / `v3`(8000) 两种方言 | 云机、服务器、节点 |
| 坑位 | `SlotId`（= `HostId` + `index`） | 宿主上的固定运行位，同一时刻只运行一个容器；ADB 端点是它的函数：`host:5000+index`（实测） | 槽位、位置、端口 |
| 容器 | `containerName` / `externalId` | SDK/Docker 侧对象，状态 `created/running/exited`；一个坑位可注册多个容器 | 实例、机器、设备 |
| 设备 | `DeviceId`（UUID） | 平台一等实体，对应一个容器；历史、任务、账号绑定都挂它 | device_serial、序列号 |
| 设备事实 | `DeviceFacts` | 从设备内观测的只读事实：机型、Android 版本、指纹（`ro.serialno` 等） | 属性、配置 |
| 账号 | `AccountId` | 业务账号（如小红书），可跨设备迁移 | 号、用户、账号=设备 |
| 绑定 | `Binding` | 账号在设备上的一段占用区间 `(AccountId, DeviceId, [from, to))` | 登录记录 |
| 代理 | `ProxyId` | S5 / VPC 接入配置 | 线路、IP |

## 执行模型

| 术语 | 标识符 | 定义 | 反例（禁止） |
|---|---|---|---|
| 动作 | `ActionId` | 设备上的一次原子操作（dump / tap / text / shell / install …） | 指令、操作步骤 |
| 流程 | `FlowId` | 有序步骤的业务编排，是产品的业务单元 | 脚本、任务、工作流 |
| 运行 | `RunId` | 一次流程在某一设备上的执行实例 | 作业、任务实例 |
| 步骤 | `Step` | 运行内的最小单元，可断言、可重试、可断点续跑 | 子任务 |
| 作业 | `JobId` | 后台长任务（导出、镜像拉取、APK 安装），有 owner 与输出 | 任务、流程 |
| 事件 | `Event` | 追加日志中的不可变事实，是历史唯一事实源 | 日志、记录 |
| 投影 | `Projection` | 从事件增量推导出的读模型 | 缓存、视图 |

## 架构名词（沿用 dsh）

| 术语 | 标识符 | 定义 |
|---|---|---|
| 上下文 | `Context`（`ctx.*`） | 服务注册表 + 依赖注入 + 类型化事件 + 可撤销 effect |
| 能力 / 接缝 | `Capability` / `Seam` | 可替换能力，由「服务定义 + Provider + Consumer」三角色构成，缺一不可 |
| 服务定义 | `Service Definition` | 声明接口的包，消费方只依赖它 |
| 提供方 | `Provider` | 能力的实现（如 `myt-api-v2`、`device-adb`） |
| 消费方 | `Consumer` | 能力的使用者（流程步骤、API、UI） |
| 插件 | `Plugin` | 向 Context 注册服务/事件/effect 的单元；注册即 effect，卸载时回滚 |
| 分发包 | `Bundle` | 插件行的分发格式（`package.json` 的 `dsh.bundle`） |
| 部署组合 | `Profile` | 一套部署形态的插件组合（`dsh.profile`）+ patch 覆盖 |
| 内核 | `Kernel` | Context + Loader + 事件总线 + 生命周期；不含任何业务 |
| 前端壳 | `Shell` | Electron 主进程：单实例、端口、健康检查、托盘、更新 |
| 业务前端 | `Client` | 浏览器/渲染进程中的页面与插件面板 |

## 使用规则

1. **`ip:port` 不是设备标识**。它是坑位端点的运行时值，可能被别的容器接管。只有 `DeviceId` 能标识设备。
2. **「在线」必须说清是 `running` 还是「已注册」**。两者差一个数量级（实测单宿主 71 注册 / 6 坑位 / 2 运行）。
3. **账号 ≠ 设备**。账号是资产，设备是耗材。
4. 代码中所有不透明 ID 使用 branded 类型（`DeviceId` / `HostId` / `RunId` / `JobId`），不接受裸 `string`。
5. UI 文案使用本表第一列的中文术语；内部标识使用第二列。

## 待补

- `Proxy` 是否独立成实体
- `Flow` 的粒度与组合方式（一个 Flow 一个包？还是可组合的步骤库？）
