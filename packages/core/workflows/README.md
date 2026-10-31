# @myt/workflows

流程图持久化（`WorkflowStore`）+ HTTP 接口（`WorkflowApi`）。

## 磁盘布局

```
<dataRoot>/workflows/
├── 小红书发布图文.json
└── 小红书发布视频.json
```

**文件名就是用户可见的流程名**，一个流程一个文件。

## 身份设计（关键）

| | 用什么 | 为什么 |
|---|---|---|
| **文件名** | 用户可见的流程名 | 用户在资源管理器里要能分辨 |
| **身份标识** | 内容里的 `id`（uuid） | 改文件名不会让流程「消失」 |

## 用户可直接操作文件

| 操作 | 程序行为 |
|---|---|
| 改名 | 按文件名识别，`id` 不变，仍能按 id 找到 |
| 复制（重复 id） | `list()` 时给后出现者重新分配 id 并写回 |
| 删除 | 扫盘自然消失 |
| 文件损坏 | 跳过，不影响其它流程 |

## 接口

`WorkflowApi` 自己注册路由，**kernel 不认识 `/api/workflows`**：

| 方法 | 路径 |
|---|---|
| GET | `/api/workflows` |
| POST | `/api/workflows` `{name}` |
| GET | `/api/workflows/:file` |
| PUT | `/api/workflows/:file` |
| DELETE | `/api/workflows/:file` |
| POST | `/api/workflows/rename` `{fileName,name}` |
| POST | `/api/workflows/duplicate` `{fileName}` |

## 失效模式

| 现象 | 原因 |
|---|---|
| `rename` 被当成文件名 | 精确路由注册在前缀路由之后 |
| 保存后列表看不到 | 写盘失败（检查 `<dataRoot>` 可写） |
