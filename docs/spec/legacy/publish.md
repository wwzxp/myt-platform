# 规格：笔记发布（WzDeviceTab）

- 旧实现：`auto_fb/wz_device_tab.py`（3,488 行，`WzDeviceTab`）
- 执行体：`auto_fb/auto_fb.py`（96KB / 2,621 行）里的 `fb_image` / `fb_wz` / `fb_long_wz` 三个巨型同步函数
- 调度：`wz_dispatcher.py`、`wz_worker.py`、`wz_models.py`
- 来源：只读测绘 2026-10-23

## 1. 页面结构

```
WzDeviceTab（embedded 精简版）
├─ 设备列表
│  ├─ 刷新列表 | [ ]坑位多容器运行 | 切换超时(10-600, 默认120) | 稳定等待(5-120, 默认20)
│  ├─ QTreeWidget 5 列：设备地址 | 登录源 | 状态 | 耗时 | 进度
│  └─ 任务配置 | 开始任务 | 查看日志 | 取消任务
└─ 笔记发布配置对话框（1000x620）
   ├─ 发布模式：保存草稿箱 / 直接发布（默认草稿箱）
   ├─ QTableWidget 9 列（只读，双击弹大编辑器）
   └─ 导入Excel | 保存 | 取消 | 确定
```

## 2. 按钮清单

| 控件 | 处理函数 | 行为 |
|---|---|---|
| 刷新列表 | `refresh_devices:2028` | 拉 ADB 设备 + 后台拉 MYT 容器 → 重建树 |
| 任务配置 | `_open_task_config:2922` | 打开配置对话框；确定后配置只存内存 |
| 导入 Excel | `_import_excel:1182` | `xlrd`(.xls)/`openpyxl`(.xlsx)，`min_row=2` 跳过表头，**按列序号**写表 |
| 保存 Excel | `_save_excel:1214` | 未导入过则拒绝；`.xls` 另存 `*.xlsx` |
| 开始任务 | `_start_throttle_task:3269` | 首次点击只弹配置窗并 return；再次点击才提交 |
| 开始任务(内层) | `_start_note_publish_task:2946` | 可选先提交 `CONTAINER_SWITCH`，再每设备一个 `NOTE_PUBLISH` |
| 取消任务 | `cancel_selected_jobs:3295` | 队列移除 / 进程 `terminate→kill`，回滚笔记状态 |
| 查看日志 | `open_log_viewer:1748` | 弹只读日志窗 |

## 3. 输入契约（9 列，顺序即契约）

`["笔记类型","标题","正文","话题","图片路径","文字笔记文字内容","是否音乐图集","魔云腾实例名称","发布状态"]`（`wz_device_tab.py:1127`）

| 列 | 解析规则 |
|---|---|
| 笔记类型 | `长文笔记`→`fb_long_wz`；`图文笔记/图文/图文/视频笔记`→`fb_image`；**其它任何值（含空）→`fb_wz`（静默兜底）** |
| 标题 | `strip()`；空则跳过标题输入 |
| 正文 | `strip()`；首行以 `@` 开头 → 走艾特模式 |
| 话题 | 删换行 → 按 `,` / `，` 切分 → 逐项 strip |
| 图片路径 | 同上切分；每项可为文件或目录 |
| 文字笔记文字内容 | 文字笔记的实际正文 |
| 是否音乐图集 | `是/1/true/True/yes` |
| 魔云腾实例名称 | `strip()`，匹配容器全名；不匹配则参与轮流分配 |
| 发布状态 | `成功`/`执行中` 会被跳过；其余参与本轮 |

**Excel 解析是列序号映射，不校验表头**——列错位不会报错。

## 4. 单设备状态机

与上号器同一套 `RowStatus`。差异：

- 提交前 `row.status=RUNNING` 预置；
- 容器级状态独立维护，父行显示「成功 x/失败 y/执行中 z/已取消 w」；
- 失败 `retryable=True` 但**无重试按钮**；
- 多容器时是「容器链」：一条发完 → 切容器 → 再发下一条。

## 5. 并发与超时

| 维度 | 事实 |
|---|---|
| 并发上限 | `JobRunner(max_concurrent=None)` → **无上限**，每设备一个子进程 |
| 同 IP 限流 | 存在 `submit_login_jobs_in_ip_batches`（3 台/批，10s 间隔），但**笔记发布完全不走它** |
| 单任务超时 | **没有超时**；`timeout_seconds` 只给 `CONTAINER_SWITCH` 用 |
| 容器切换 | 提交前一次性对所有非运行中首容器提交切换，随后停轮询 + 忙等，`deadline = 切换超时 + 15s` |
| 取消 | 队列项直接 CANCELLED；运行项 `terminate()` → 1s → `kill()` |
| 协议校验 | 非 JSON / job_id 不匹配 / 缺终态 → 强杀并报错；重复终态 → `duplicate_terminal_event` |

## 6. 发布流程（图文，20 步）

`fb_image(ip_param, img_paths, new_title, topic_text, new_body, music_img, fb_mode)`（`auto_fb.py:1198`）

| # | 步骤 | 等待/重试 | 失败分支 |
|---|---|---|---|
| 1 | 素材上传（一切 UI 动作之前） | `sleep 0.5-1.5s` | **返回值被丢弃**，失败不中断 |
| 2 | 路径展开（目录按文件名数字前缀升序） | — | 无数字前缀的文件被静默丢弃 |
| 3 | 输入法就绪（ADBKeyboard） | 安装 timeout 60s | APK 缺失 → 抛异常 |
| 4 | yadb 就绪 | — | 本地缺失则跳过 |
| 5 | 回主页 | 轮询 5 次 + `sleep 2-3s` | 找不到底栏继续 |
| 6 | 打开发布页 + 等相册 | 最多 5 轮 | 5 轮后 `return False` |
| 7 | 相册权限 | 最多 5 次 | 只在 `permissioncontroller` 包名下认 |
| 8 | 选图 | 最多 10 轮；点击间隔 0.3-0.5s；`max_visible=6→9`；固定 swipe 参数 | 选不够 → `return False` |
| 9 | 图库「下一步」 | 单次 | 找不到 → False |
| 10 | 「添加章节/我知道了」弹窗 | 5 次 | 不中断 |
| 11 | 账号静音弹窗 | 5 次 | 不中断 |
| 12 | 可选音乐图集 | 5 次，每次 2-3s | 全失败 → False |
| 13 | 编辑页「下一步」 | **19 次**轮询（无 sleep），用 yadb 而非 uiautomator | False |
| 14 | 取消「相册内容位置」弹窗 | 5 次 | 不中断 |
| 15 | 填标题 | 每轮 1-1.6s；输入后回读校验 3 次 | 3 次失败 → False |
| 16 | 点正文框 | 5 次 | False |
| 17 | 正文 + 话题 | 3 次校验；艾特模式每行 dump 3 次 | 失败打日志但**继续** |
| 18 | 键盘「完成」 | 单次 | 找不到则不下发 |
| 19 | 发布 / 存草稿 | `sleep 0.3-0.8s` 后进验证 | **找不到按钮不报错，直接进验证** |
| 20 | 成功验证 | 9 轮：回主页→下拉刷新→等 loading 60s→滚动 3 次→`has_public_notes_content` | 9 轮都无 → False |

文字笔记 `fb_wz` 与长文 `fb_long_wz` 结构相同，差异在入口与编辑页选择器；**`fb_long_wz` 完全不使用 `topic_text`（形参是死的）**。

## 7. 外部依赖

| 类别 | 内容 |
|---|---|
| MYT SDK | `get/{host}`、`run?force=1`；v3 `8000/android` start/stop |
| ADB | `shell`/`push`/`pull`/`ui_xml`；编辑页用 yadb `-layout` |
| 深链 | `xhsdiscover://post_note/<id>`、`xhsdiscover://post_new_note?page={"page_type":"now_portal_home_page"}`、`xhsdiscover://profile`；载体 `com.xingin.xhs/com.xingin.xhs.routers.RouterPageActivity` |
| 输入法 | `ADBKeyboard.apk` + 广播 `ADB_INPUT_TEXT --es msg` |
| 素材入库 | `content insert --uri content://media/external/{images|video}/media` + `touch` + `MEDIA_SCANNER_SCAN_FILE` |

## 8. 数据产物

| 产物 | 说明 |
|---|---|
| 执行日志 | `logs/{serial}_{YYYYmmdd_HHMMSS}.log`（worker stderr 全量） |
| Excel | 原地覆盖；`.xls` 另存 `*.xlsx` |
| 发布状态 | **只回写内存**，不点「保存」不落盘 |
| 设备端 | `/sdcard/Download` 优先，其次 DCIM/Camera、Pictures、DCIM |
| 笔记 URL | **不产生**（`note_by_url` 表格在本页是死代码） |

## 9. 已知缺陷（移植时必须修）

| # | 问题 | 证据 |
|---|---|---|
| 1 | **成功判定假阳性**：只判断主页公开区是否有任何内容，不比对笔记 ID | `auto_fb.py:800-838` |
| 2 | 素材上传失败被吞（返回值未使用） | `:1201-1204` |
| 3 | 两套目录展开规则不一致（上传用自然序+倒序，选图用数字前缀升序） | `:1178-1196` vs `upload_img.py:170-190` |
| 4 | 预占「执行中」状态中途失败不清，后续任务永久跳过该条 | `:3166-3169` |
| 5 | 直连 ADB（无容器）多笔记计划必失败（空 sdk_type 提交 CONTAINER_SWITCH） | `:3010-3027`、`:2708-2742` |
| 6 | `_continue_after_container_switch` 尾部引用不存在的枚举，死代码 | `:2889-2899` |
| 7 | 死代码：`_do_container_switch`、`_check_serials_available`、`ProgressDialog` 整类 | 多处 |
| 8 | 开始任务要点两次 | `:3270-3273` |
| 9 | 容器切换期间 UI 伪阻塞（停轮询 + processEvents 忙等） | `:3196-3233` |
| 10 | 正文 3 次失败置 is_return，随后又被清掉 → 正文可能为空仍继续 | `:1479-1494` |
| 11 | 选择器硬编码层级索引（「我」按钮 11 级），无 text 兜底 | `:281-798`、`:930-968` |
| 12 | 魔法数：5/10/19/20 次重试、`swipe 482 800 482 416 411`、`max_visible 6→9` | 多处 |
| 13 | `fb_long_wz` 话题丢失 | `:2227-2437` |
| 14 | 无 note_id / 无幂等，无法对账与安全重试 | 全程 |

## 10. 人工介入点

M1 首次点开始任务需二次点击 · M2 配置只在内存 · M3 提交前确认框 · M4 相册授权弹窗 · M5 设备被其他标签页占用 · M6 容器切换失败/超时 · M7 失败无重试按钮 · M8 Excel 状态需手动保存。

## 11. 不可重试点

| 点 | 原因 |
|---|---|
| 已点「发布」后失败 | 笔记可能已发出，重跑=发第二条 |
| 已点「存草稿」后失败 | 重跑=多一条重复草稿 |
| 进程被 kill | App 停在编辑页，状态未知 |
| 容器切换失败后 | 设备可能处于未知容器状态 |
| 素材已上传后中断 | 可重入（先删 MediaStore 记录），但时间戳变化影响选图顺序 |

## 12. 移植到 TS 的要点

1. 定位器抽象 `Locator{selectorKind, path|xpath|text, fallback[]}`，每条加 class 校验。
2. `fb_image` 拆成 `Step[]`，标 `idempotent/onceOnly`；「已点发布」为 `onceOnly`，重试时跳过并转「待人工核对」。
3. 引入发布前基线（笔记数/首条 id）→ 发布后比对增量，替换弱校验。
4. 保留五态事件协议与「重复终态=协议错误」语义；**补 NOTE_PUBLISH 超时**。
5. 拟人化参数抽成 `HumanPolicy`（可开关、可注入种子），不散落在步骤里。
6. Excel 改为按表头名映射 + 缺列显式报错。
7. 话题/图片分隔符解析统一为 `parseTemplates()`，覆盖半角/全角逗号与换行。
8. `note_type` 改为显式枚举校验，取消「空值静默兜底到文字笔记」。
