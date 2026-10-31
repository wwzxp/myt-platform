# ADR-0002 设备身份与实体模型

- 状态：已接受（2026-10-23）；同日修订：引入 `Slot` 实体，ADB 端点归属坑位而非设备。账号/代理实体待 ADR-0003
- 影响范围：数据模型、事件日志、UI 列表、任务归属

## 背景

旧项目把 `device_serial`（`ip:port`）同时当作 ADB 目标、SDK 宿主标识（`rsplit(':')[0]`）和任务主键。SDK 存在会破坏这个身份的操作：

| 操作 | 端点 | 对身份的破坏 |
|---|---|---|
| 容器改名 | `GET /dc_api/v1/rename/{ip}/{old_name}/{new_name}` | 名称变了 → 复合键断裂 |
| 克隆容器 | `GET /dc_api/v1/copy_android/{ip}/{src}/{dst}/{index}/{model}` | 出现同名同指纹的第二台 |
| 容器重启 | `GET /dc_api/v1/run` / `stop` | v3 的 ADB 端口来自 `portBindings["5555/tcp"][0].HostPort`，可能变化 |
| **坑位复用** | `run` 的 `force` / `CONTAINER_SWITCH` | 同一 `ip:port` 先后跑不同容器：**端点绑定坑位，不绑定设备** |
| 重装/重置 | `GET /dc_api/v1/reset/{ip}/{name}` | 系统数据清空，但物理容器还是同一台 |

## 决策

### 实体

| 实体 | 主键 | 说明 |
|---|---|---|
| `Host` | `HostId`（branded，登记时生成） | 一台魔云腾宿主：`host_ip` + SDK 方言（v2/v3） |
| `Slot` | `(HostId, index)` | **坑位**。同一坑位同时只能运行一个容器；ADB 端点属于坑位的一次运行会话 |
| `Device` | `DeviceId`（branded UUID） | 容器实体，与端点解耦；历史、任务、账号绑定都挂它 |
| `Container` | 宿主内 `container_name` | SDK 侧对象，作为 `Device` 的可变属性 + 观测快照 |
| `AdbEndpoint` | — | `ip:port`，属于 `Slot` 的运行时属性，**不承担任何身份** |

关系：

```
Host 1 ── N Slot
Slot 1 ── 0..1 运行中的 Device      （同一时刻最多一个）
Device N ── M Slot                  （历史占用关系，带时间区间）
```

### 身份规则

1. **生成时机**：设备首次被登记时生成 `DeviceId`，此后永不变更。
2. **重装 / 重置 / 重启 / 改 ADB 端口 / 换坑位 → 同一设备**，`DeviceId` 不变。
3. **`copy_android` 克隆 → 新设备**，新 `DeviceId`，历史从零。
4. **ADB 连不上 ≠ 设备消失**：`unreachable`，实体保留。
5. **关闭容器（stop）≠ 删除**：设备进入 `stopped`，坑位空出，可被其他设备占用。
6. **删除容器（`/remove`）= 墓碑**：`deleted`，历史保留、不再调度，**UUID 永不回收**。
7. **删除后重建同名容器 = 新设备**（新 UUID），避免旧历史污染新容器。
8. **匹配优先用容器 `id`**（Docker 容器 id，64 位十六进制）：rename 后 `id` 不变，重建后 `id` 变。`id` 未知时才退回「`name` + 设备内指纹」判定；指纹与历史不一致即新设备。

### 实测（2026-10-23，host `192.168.0.113`，`GET /dc_api/v1/get/{host}` 只读）

| 观测 | 值 |
|---|---|
| 容器总数 | **71** |
| 坑位数 | **6**（index 1–6），文档写 1–12，与实测不符 |
| 每坑位容器数 | 最多 15 个（index 1） |
| 运行中 | 2（index 1、2） |
| 状态分布 | exited 64 / created 5 / running 2 |
| ADB 端口 | **`5000 + index`**（5001–5006），确定性映射 |
| 其它端口 | `api_port = 10005 + 3×(index-1)`，`ctr_port = api_port - 1`，`webrtc = 11013 + 10×(index-1)` |
| 响应字段 | `adb, api_port, cpuset, ctr_port, data, dns, dpi, fps, height, id, image, index, ip, memory, name, short_id, state, status, webrtc, width` |
| `ip` | 等于宿主 IP，不是容器 IP（文档描述有误） |
| `id` | 64 位十六进制（Docker 容器 id），71 个互不重复 |

结论：
1. **ADB 端点是坑位的纯函数**（`host:5000+index`），与设备无关 —— 实测确认。
2. **坑位容量必须逐主机探测**（取观测到的最大 index），不能硬编码 12。
3. `id` 是比 `name` 更好的外部匹配键：**rename 不改 `id`**，重建则 `id` 变化。

### 可变属性与归属

```
Device
  id: DeviceId
  externalId: string | null      # Docker 容器 id（64 hex），rename 不变，重建变化
  containerName: string          # rename 时更新
  currentSlot: SlotId | null     # 运行中才非空
  observedAt: timestamp
  status: running | stopped | unreachable | deleted
  facts: { model?, android?, fingerprintId? }   # 登记时采集

Slot
  id: SlotId (= HostId + index)
  hostId: HostId
  index: int
  adbEndpoint: string | null     # 仅运行中有值；= host:5000+index
  occupant: DeviceId | null      # 当前运行设备
  capacityObserved: int          # 该宿主已观测到的最大 index
  observedAt: timestamp
```

- 观测来源：`GET /dc_api/v1/get/{host}`，文档给出的响应：

```json
{"code":200,"message":"success","data":[
  {"Names":"<容器名>","State":"created|running|exited",
   "data":"/mmc/data/data3_...","index":3,"ip":"<容器IP>"}
]}
```

  注意：`Names`/`State` 是 v3 文档写法，v2 实测字段为小写 `name`/`state`；实测响应远大于文档（20 个字段，含 `adb`、`id`、`short_id`、`image`、`status` 等）。**客户端必须按实测字段解析并对缺字段容错。**
- `POST /dc_api/v1/batch_create/{ip}/{num}/{pre_name}/{force}` **没有 index 参数**，坑位由服务端分配，登录后必须再 `get` 一次才能知道落在哪个坑位。
- 所有历史事件引用 `DeviceId`；**任何模块都不得把 `ip:port` 当设备句柄长期持有**——它随时可能被换人。

### 不透明 ID 用 branded 类型

照 dsh 的做法（`Branded<B>`），`DeviceId` / `HostId` / `RunId` 不与裸 `string` 互换，防止把 ADB 地址误传成设备 ID。

## 后果

- 表：`hosts`、`slots`、`devices`、`slot_occupancy`（历史占用区间）、`container_snapshots`（观测快照，用于对账）。
- 每次容器列表刷新是一次「对账」：按 `(host, containerName)` 匹配已有 `DeviceId` → 更新可变属性；匹配不到 → 登记新设备；坑位占用者变化 → 写一条 `slot_occupancy` 关闭/开启记录。
- **调度器以 `Slot` 为并发单位**：抢占坑位前必须先确认占用者已停止，否则会打断别的设备任务。
- `copy_android` 无法从 SDK 侧区分「克隆」与「新建设备」：平台内发起的克隆由 Worker 记录因果关系；外部创建的只能按新设备登记，靠指纹校验兜底。
- UI 列表主键必须是 `DeviceId`；展示名取 `containerName`；坑位与端点在详情里展示，不作为行标识。
- ADB 会话（连接、长连接、截图流）必须与 `Slot` 的运行会话绑定：坑位换人时要主动断开旧会话，否则会对着新设备发旧命令。

## 关联决策

- 账号：`Account` 为一等实体，与 `Device` 为 N:M 绑定（带时间区间），设备同时最多一个活动账号（ADR-0003）。

## 待定

- **已定**：坑位容量逐主机探测（`capacityObserved`），不硬编码文档里的 12；当前环境 1 台宿主 = 6 坑位。可运行池 = Σ(每主机探测坑位)，与「已注册容器总数」分开统计。客户环境宿主更多，容量模型不得写死。
- 代理（S5/VPC）是否作为独立实体
- `DeviceId` 持久化介质（SQLite 表 vs 事件日志投影）
