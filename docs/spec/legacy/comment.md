# 规格：评论 / 截流（Throttle）

- 旧实现（两套并存）：
  - **截流（旧）**：`main.py::_create_throttle_tab`（内联，约 3308 起）→ `TaskProcessWorker` → `task_runner.py` → `auto_jl.py`
  - **截流（新）**：`auto_jl_new/throttle_device_tab.py`（4,312）→ `JobRunner` 子进程 → `throttle_worker.py` → `auto_jl_new.py`（6,458）
- 来源：只读测绘 2026-10-23

## 1. 页面结构

### 1.1 截流（旧）：单设备 IP 输入 + 参数面板

```
任务参数设置
├─ 设备IP | 关键词 | 搜索查询 | 排序依据 | 发布时间 | 笔记类型 | 搜索范围
├─ 点赞笔记数量(1-1000, 默认200) | 点赞间隔(10-100s) | 关注上限(0-9999, 默认190)
├─ 用户性别（复选）
├─ 评论文案（每行一条或 | 分隔）
├─ 连续评论笔记数(1-999, 默认20) | 评论间隔(s, 默认300) | 评论模式(随机/顺序)
├─ 评论时间筛选（不筛选/分钟/小时/天 + N）
└─ 任务动作：☑点赞 ☐关注 ☐评论
右侧按钮：设备管理 | 截图 | 多笔记任务 | 单笔记任务 | 指定笔记任务 | 导入笔记 | 笔记表格
          指定评论点赞 | 导入评论 | 评论表格 | 停止任务 | 恢复默认参数
```

### 1.2 截流（新）：设备树 + 任务配置对话框

```
设备列表
├─ 刷新列表 | [ ]坑位多容器运行 | 切换超时(120) | 稳定等待(20)
├─ QTreeWidget 5 列：设备地址 | 登录源 | 状态 | 耗时 | 进度
└─ 任务配置 | 开始任务 | 查看日志 | 取消任务

任务配置（750x580）
├─ 模式：(•)指定笔记任务 ( )指定评论点赞
├─ 笔记面板：表格(序号/状态/笔记URL/主评论文案/子评论文案) + 导入笔记 + 新增一行
│  ├─ 主评论文案（每行一条） | 子评论文案（每行一条，留空不执行）
│  ├─ 评论间隔(0.5-600, 默认300) | 评论模式(随机/顺序) | 输入模式(5 种，默认纯文字)
│  └─ 分配模式(全部分配/均分，默认均分) | 子评论间隔(默认2.0) | ☑评论 ☐笔记点赞 ☐笔记收藏
└─ 评论面板：表格(序号/状态/笔记ID/评论ID/昵称) + 导入评论 + 点赞间隔(默认5.0) + 分配模式
```

## 2. 按钮清单

### 旧

| 控件 | 链路 |
|---|---|
| 多笔记任务 | `run_multi_note_task` → `TaskProcessWorker` → `task_runner.py` → `auto_jl.main` → `open_xhs_search` → `collect_notes_and_operate` |
| 单笔记任务 | → `auto_jl.one_note` → `like_comments_for_single_note` |
| 指定笔记任务 | → `one_note_by_url`（URL→note_id→打开→评论） |
| 指定评论点赞 | → `one_comment_by_id`（深链打开→找评论→点赞→校验） |
| 停止任务 | `task_worker.stop()`：`terminate()`，3s 后 `kill()` |
| 导入笔记 | Excel 优先列 `笔记URL`/`笔记url`，否则第一列；CSV/TXT 每行；只取第一个 URL；去重 |
| 导入评论 | **仅 Excel**，四列 `note_id/comment_id/nickname/content` |

失败语义：**业务失败仍算 `success=True`**，只有子进程崩溃/非 0 退出/JSON 解析失败才算失败。

### 新

| 控件 | 链路 |
|---|---|
| 任务配置 | `TaskConfigDialog` → 「分配任务」按模式切分到每设备/容器 |
| 开始任务 | `create_job(action=THROTTLE_NOTE_BY_URL/THROTTLE_COMMENT_BY_ID)` → 同 IP 批次提交 |
| 取消任务 | 队列项 CANCELLED；运行项 `terminate→1s→kill` |
| 多容器 | 按容器切分进度，每容器独立进度表 |

## 3. 输入与校验

| 输入 | 规则 |
|---|---|
| 设备 IP | 旧：必填；新：至少勾选 1 个设备/容器 |
| 搜索查询 | 旧：`require_search=True` 时必填（指定笔记任务传 False） |
| 评论文案 | 勾选「评论」时必须非空；`|` 先替换为换行再逐行 strip；新模式 `emoji` 豁免 |
| 点赞笔记数量 | 1..1000，默认 200；`enable_comment && !enable_like` 时被评论数覆盖 |
| 关注上限 | 0..9999，默认 190；未勾关注强制 0 |
| 评论时间筛选 | 仅当勾选点赞或关注时生效 |
| 笔记 URL（新） | 正则 `https?://[^\s<>"'(){}\[\]]+`，去尾标点，完全相同的去重 |
| 评论行 | `note_id`/`comment_id` 任一为空 → worker 直接计失败跳过 |
| 分配模式 | 全部分配 / 均分（默认） |

## 4. 评论链路（选中笔记 → 评论成功，新引擎 S0–S16）

| # | 步骤 | 细节 |
|---|---|---|
| S0 | 设备就绪 | `adb connect` + 检测/安装/启用 ADBKeyboard（中文评论依赖广播） |
| S1 | URL 规范化 | 含 `xiaohongshu.com`/`rednote.com` 直接用；否则设备端 `curl -s -L -w %{url_effective}` |
| S2 | 提取 note_id | 7 条正则 + 查询参数，要求 24 位 hex |
| S3 | 打开笔记 | `am start -a android.intent.action.VIEW -d "xhsdiscover://item/<id>"`，**只校验 returncode，不校验页面** |
| S4 | 等待加载 | `sleep(2)`；最多 3 次读评论数（`noteCommentTV` 或 `content-desc="评论 N"`） |
| S5 | 评论排序「最新」 | 点评论计数（6 种中/英模式 + 3 种 id/desc 兜底）→ `sleep(1)` → 点「最新」 |
| S6 | 详情页守卫 | 4 层特征：评论数控件 → 底部按钮 y>1000 → 单评论按钮 → RecyclerView+评论特征 |
| S7 | 定位输入框 | 底部 `clickable` 且 `y2≥0.9H & w≥0.6W & h≤0.2H` 的最靠下控件，点左 20%；兜底 `(0.2W, 0.94H)` |
| S8 | 清空输入框 | 发送按钮 `enabled=false` 跳过；否则删 `min(len+5,20)` 次 DEL |
| S9 | 选文案 | 顺序：`texts[idx % len]`；随机：`random.choice` |
| S10 | 输入 | `text`→模拟打字（burst 2-5 字，组间 0.2-0.5s）；`emoji`/`image` 等走层级路径 + 相册授权（最多 5 次） |
| S11 | 发送 | 10 条正则匹配「发送/發送/傳送/Send」，找不到 → 失败 |
| S12 | 等面板消失 | 最多 10 次 × 0.5-0.8s；**超时只打印，不判失败** |
| S13 | 记账 | `已评论(x/y)`；到上限置 `comment_limit_reached` |
| S14 | 子评论（仅新） | 解析第 0 条 `reply_center`；没有则最多 10 次上滑；每个子评回复后间隔 2s 起 |
| S15 | 评论后停留 | `deadline = now + comment_interval`，切 5 段倒计时（每段轻滑并上报），到点返回 |
| S16 | 笔记收尾 | 继续滚评论列表、点赞/存评论、筛选复核；返回 `(filtered, new, likes)` |

旧引擎 S1–S13 同构，**无子评论、无输入模式（仅纯文字）**，且一个任务串行处理整个 URL 列表。

## 5. 状态机

旧（无枚举，靠进度文本）：
```
"" --勾选开始--> 待执行 --已打开笔记--> 执行中 --下一条--> 完成
                     ↑                    |
                  可再次运行 ←── 失败(URL/ID/打开)
```
运行集：`selected and url and status ∉ {完成,✓,√}` → **失败行会重跑**。

新：`IDLE→READY→RUNNING→SUCCESS/FAILED(retryable)/CANCELLED`，多容器时 `RUNNING(ctn_i) --成功--> CONTAINER_SWITCH --成功--> RUNNING(ctn_{i+1})`。失败行**不自动重试**，只能重新分配或重置进度。

## 6. 并发

| 维度 | 旧 | 新 |
|---|---|---|
| 执行单元 | 1 次点击 = 1 个 QProcess，串行跑完整批 | 1 个 DeviceJob = 1 个子进程，可并行 |
| 并发上限 | 单窗口 1 个任务，多开窗口 | **无上限** |
| 同 IP 限流 | 无 | 每批 3 台立即提交，其余 `idx×10s` 延时 |
| 超时 | 无业务超时 | 任务无超时；仅容器切换 120s + 稳定 20s |
| 取消 | terminate → 3s kill | 队列直接 CANCELLED；运行 terminate→1s→kill |
| 协议 | `[PROGRESS]` 文本 + `[COMMENT_STATUS]` JSON | stdout JSONL 五态 + 结构化 `url_done/comment_done` |

## 7. 外部依赖

ADB（`exec-out uiautomator dump /dev/tty`、`input tap/swipe/keyevent`、`am start`）、ADBKeyboard、设备端 `curl`（短链解析，UA 伪装 iPhone）、MYT SDK（仅容器切换）、卡密 `auth_client`、Excel（`pandas` + `openpyxl`/`xlrd`）。

**评论本身不调用任何 HTTP API**，全部是 UI 自动化。

## 8. 数据产物

| 产物 | 位置 |
|---|---|
| 设备级业务日志 | `logs/YYYY-MM-DD/auto_jl_<ip>.log`（每设备一个 logger，DEBUG） |
| 任务进程日志 | `logs/<serial>_<YYYYmmdd_HHMMSS>.log` |
| 进度/结果 | 仅内存；**不导出 Excel** |
| 配置 | `login_config.json`（卡密、同 IP 批次参数） |

## 9. 风控/频率参数全表（移植时应进配置 schema）

| 值 | 含义 |
|---|---|
| 300 s | 评论间隔默认（旧 0-999，新 0.5-600） |
| 2.0 s | 子评论间隔默认（0.5-600） |
| 20 | 连续评论笔记数上限 |
| 200 | 点赞笔记数量默认 |
| 10.0-100.0 s | 点赞间隔区间 |
| 190 | 关注上限 |
| 0.35 s | 引擎级默认点赞间隔（标量 → 0.8x~1.2x 随机） |
| 5.0 s | 指定评论点赞默认间隔 |
| 99999 | 新 worker 传入的 `comment_count`（等价不设上限） |
| 5 段 | 评论间隔倒计时分段 |
| 2 s / 1 s | 打开笔记后等待 / 菜单点击后等待 |
| 3 次 / 10 次 | 评论数加载重试 / 发送后面板消失检查 |
| 10 / 20 / 10 次 | 单篇滚评论轮次 / 连续空轮 / 子评论上滑次数 |
| 20 次 | 清空输入框固定删除次数（旧） |
| 2-5 字 / 0.2-0.5 s | 打字 burst 与停顿 |
| y>1000 | 「在详情页」的底部按钮阈值（**分辨率硬编码**） |
| 0.9H/0.6W/0.2H、0.2W/0.94H | 输入框判定与兜底坐标 |
| 120 ms | 事件轮询 |
| 8000 字符 | payload 走临时文件阈值 |
| 3 台 / 10 s | 同 IP 批次大小 / 间隔 |
| `(title, author, date)` / `(username, content, date_region_raw)` | 笔记 / 评论去重键 |

## 10. 已知缺陷

| # | 问题 | 证据 |
|---|---|---|
| 1 | **评论「成功」无平台侧验证**，只判断发送面板消失；超时仍返回 True | `auto_jl_new.py:3264-3278` |
| 2 | worker 传 `comment_count=99999`，使评论上限失效，只剩间隔节流 | `throttle_worker.py:282` |
| 3 | 只点赞/收藏时必然误报失败（`total_comments==0 → fail("no_comments_made")` 无条件） | `:305-306` |
| 4 | `image` 输入模式仍强制要求文案，但该分支不使用文案 | `:3765-3767` vs `:3150-3200` |
| 5 | 「视频笔记」永远被跳过（`is_video → False`），即使选了视频类型 | `:2618-2621` |
| 6 | 筛选条件只在点击层生效，处理完才复核，不满足也不回滚已评论 | `:2046-2050` |
| 7 | 评论时间筛选只影响点赞/关注，不影响发评论 | `:3531` |
| 8 | 分辨率硬编码（`y>1000`、`0.94H`） | `:2115-2126,3074-3096` |
| 9 | 旧引擎 URL 列表共用 `StreamThrottler`，去重跨笔记；新引擎每 URL 新建，去重不跨笔记 | `:3499-3504` |
| 10 | `_comment_menu_sorted_once` 等隐式实例状态参与流程 | `:1779,3054-3065` |
| 11 | `_make_throttle_source(progress=None)` 分支缺 3 个开关字段 | `:3934-3950` |
| 12 | 多容器续跑可能重复全量（回退到完整配置而非分片） | `:3455-3467,3826` |
| 13 | 重复终态补发 FAILED，理论上可误伤刚启动的新 job | `throttle_dispatcher.py:157-172` |
| 14 | `open_note_by_id` 只看 adb 返回码，不校验是否进入详情页 | `:3941-3950` |
| 15 | 无限并发下 N 台同时 `uiautomator dump`，adb server/CPU 成瓶颈 | `:1861` |
| 16 | worker `except Exception: pass`，单 URL 失败无 error_detail | `throttle_worker.py:297-298` |

## 11. 旧 vs 新差异（移植时可合并为同一套步骤的可选能力）

| 维度 | 旧 | 新 |
|---|---|---|
| 任务来源 | 关键词搜索、单/多笔记、URL、评论 ID | 仅 URL 列表 / 评论 ID 列表（无搜索、无筛选、无关注） |
| 子评论 | 不支持 | 支持 |
| 输入模式 | 纯文字 | 文字/表情/文字+表情/文字+图片/纯图片 |
| 笔记点赞/收藏 | 参数存在但无开关 | 显式开关 |
| 失败语义 | 业务失败仍 `success=True` | 明确 `failed` 事件 |
| 并发 | 1 任务/窗口 | 多设备并行 + 同 IP 批次 |
| 设备锁 | 无 | 跨标签页互斥 |

## 12. 移植到 TS 的要点

1. 设备能力抽象为可替换适配器（`dump/tap/swipe/text/app`），否则引擎被分辨率与版本绑死。
2. 隐式状态（`_comment_menu_sorted_once`、`_last_comment_success`、`_comment_index` 等）全部提升为显式 Step 状态。
3. 取消改为协作式 `AbortSignal` 检查点，不再依赖杀进程。
4. 成功判定增加「评论列表回查」可选步骤，**默认兼容旧行为**但在事件里标注置信度。
5. `|` 分隔解析统一为一处 `parseTemplates()`（旧 UI、弹窗表格、worker 各实现一次）。
6. 进度行改用稳定 `rowId`，不用「索引 + `_progress_index`」。
7. 随机性可注入种子，保证测试可复现。
8. 风控参数全部进配置 schema 并做上下限钳制。
9. 旧/新两套评论语义合并为一个 `CommentStep` 的可选能力，不复制两条流程。
