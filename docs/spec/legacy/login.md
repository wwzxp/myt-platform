# 规格：上号器（XhsDeviceTab）

- 旧实现：`xhs_device_tab/device_tab.py`（6,869 行，`XhsDeviceTab` 自 2833 行起）
- 执行体：`gui_device_worker.py`（515）、`gui_device_dispatcher.py`（394）、`gui_device_models.py`（340）
- 业务脚本：`auto_login.py`（3,425）、`account_bind_phone.py`、`auto_modify_info.py`、`auto_follow.py`、`xhs_sid_extractor.py`
- 来源：只读测绘 2026-10-23，行号指向旧仓库 `F:/python_code/merge_auto_object/auto_object`

## 1. 页面结构

```
XhsDeviceTab
├─ 设备管理卡：地址输入 | 连接设备 | 刷新列表 | "N 台设备"
├─ 授权信息卡：卡密 | 授权状态 | 验证授权        （独立窗口形态才有）
├─ 设备列表卡
│  ├─ 刷新列表 | [ ]坑位多容器运行 | 切换超时(120s) | 稳定等待(20s) | 单项任务
│  ├─ QTreeWidget 5 列：设备地址 | 登录源 | 状态 | 耗时 | 设置
│  └─ 全选 | 大模型配置 | 批导入账号 | 查看日志
│     [ ]登录并备份(默认否) [x]清除数据(默认是)
│     清除数据 | 账号备份 | 立即登录 | 取消任务
└─ 运行日志（只读）

树：主机分组 "__group__|<ip>" → 设备行 "<serial>"（可勾选，列4 内嵌「设置」按钮）
                            → 容器行 "__ctn__|<serial>|<full_name>"
```

默认值：`多容器=否`、`切换超时=120`、`稳定等待=20`、`登录并备份=否`、`清除数据=是`、`并发=无上限`、轮询 `120ms`。

## 2. 按钮清单

| 控件 | 处理函数 | action / 副作用 | 失败表现 |
|---|---|---|---|
| 连接设备 | `connect_device:4350` | 按模式展开地址（v2/v3 调 SDK `get_host_info`）后逐个 `adb connect` | 仅日志，不弹窗 |
| 刷新列表 | `refresh_devices:3838` | 后台拉容器列表 + 重建树 | 不可达主机剔出配置；横幅提示 |
| 验证授权 | `verify_auth:4315` | `POST {server}/api/verify`，写 `remaining_days` | 弹「授权验证失败」 |
| 批导入账号 | `open_account_import_dialog:3725` | 8 个子页（账号/头像/昵称/代理/新机配置/关注/绑定账号/HeroSMS） | 取消则不改状态 |
| 清除数据 | `run_batch_action(CLEAR)` | worker：`check_xhs_installed` → `pm clear com.xingin.xhs` | `app_missing` / `clear_failed` |
| 账号备份 | `run_batch_action(BACKUP)` | worker：`extract_bundle(mode="full")` → 返回 `bundle_path` | `worker_exception` |
| 立即登录 | `run_batch_action(LOGIN)` | 可选先 `SET_PROXY`，再按登录源登录，成功后链式接后续任务 | 见 §4 |
| 取消任务 | `cancel_selected_jobs` | 队列项移除并发 CANCELLED；运行项 `terminate()`→1s→`kill()` | 无任务提示 |
| 单项任务 | `open_single_task_dialog:4414` | 6 项：设置代理 / 一键新机 / 改头像昵称 / 关注 / 绑定账号 / 抓取 XML | 行标失败 |
| 设备行「设置」 | `edit_row_source:4226` | `DeviceSourceDialog` 改登录源 | 执行中禁止修改 |

单项任务对应 action：`SET_PROXY` / `RESET_DEVICE` / `MODIFY_PROFILE` / `FOLLOW_USER` / `BIND_PHONE` / 无 job（UI dump 不占锁）。

## 3. 登录源与输入格式

| 模式 | 输入格式 | 处理 |
|---|---|---|
| 验证码登录 | `手机号----链接[----状态]`（区号默认 +1） | 拉取验证码网页 → 输入 → 登录 |
| 备份包登录 | 目录下 `*.zip` / `.bak` / `.tar.bak` | `.bak` → MIUI 转换，`.tar.bak` → 微share 转换，再还原 |
| QQ OP 登录 | 一行一份 OP 数据 | 东鹏上号器输入 → 一键授权 |
| V 跳登录 | 一行一份 V 数据 | 拉 `com.willh.wz` → 输入 → 授权 → force-stop |
| SID 登录 | `sid----uid` 或纯 `sid` | 本地生成 MMKV（主/CRC/login_user_info_kv）→ push → `su cp` → 重启 App |

文本文件编码回退顺序：`utf-8-sig → utf-8 → gb18030`。状态前缀 `成功--` / `失败--` / `已使用--` 均需兼容。

## 4. 登录流程（验证码模式，22 步）

> 选择器机制：`uiautomator dump`（登录流程用 YADB）→ XML → **固定子节点下标数组**下钻 → 要求 `clickable="true"` → 取 bounds 中心点。等待全是「轮询 + 随机 sleep」。

| # | 步骤 | 等待/重试 | 失败分支 |
|---|---|---|---|
| 0 | 前置：装/切 ADBKeyboard、push yadb | — | 仅打印，继续 |
| 1 | `adb disconnect+connect`，冷启小红书 | `sleep 3-7s` | 抛异常 |
| 2 | 取 UI XML（YADB） | 3 次，每次 0.5s | 返回空 → 后续全 miss |
| 3 | 首屏弹窗：同意 / 通知允许 | 各 5 次，0.3-0.8s | 继续 |
| 4 | 稳定等待「手机号登录」「其他登录方式」 | 5 次，0.6-1.5s | 继续 |
| 5 | 进「我的」 | 单次 | 跳过 |
| 6 | 再等入口 | 5 次 | — |
| 7 | 选「其他登录方式 → 手机号」 | 0.3s | dump `no_login_entry` → False |
| 8 | 等区号按钮 | **29 次**，0.6-1.5s | dump `no_country_code` → False |
| 9 | 选区号 | 列表 5 次 | 未匹配仅 dump，继续 |
| 10 | 清空手机号框 | — | 无按钮跳过 |
| 11 | 输入手机号 | 输入前 0.8-7s；burst 2-5 字；校验 5 次 | dump `no_phone_input` → False |
| 12 | 等验证码框 / 点「验证并登录」 | 外层 2 次，内层 5 次 | — |
| 13 | 安全验证（点选 2 图，LLM 识别） | 等页 **60s**，3 次尝试 | `press_back` 回退 |
| 14 | 发码失败闸门（按钮 enabled 且文案非重发） | — | dump `code_send_failed` → False |
| 15 | 拉验证码 | 6 轮；HeroSMS 每 2s、最长 70s | 转重发等待 |
| 16 | 输入验证码 | 5 次 | 未知页触发安全验证 |
| 17 | 登录后引导（生日/Skip/Got it/Later） | 生日 30×0.1-0.4s | dump `birthday_failed` |
| 18 | 确认离开验证码页 | — | 仍在则重发 |
| 19 | 重发等待 | **70s deadline** | dump `resend_timeout` → False |
| 20 | 终态断言：出现「我」 | — | dump `final_not_home` → False |
| 21 | 外层重试 | 最多 2 次 | `sms_login_failed` |
| 22 | HeroSMS 分支 | 2 次登录尝试 | 失败 `set_status(6)` |

## 5. 状态机

`RowStatus = idle/ready/running/success/failed/cancelled`（待命/已配置/执行中/成功/失败/已取消）。

```
IDLE --设置登录源--> READY --提交 job--> RUNNING
RUNNING --中间任务成功--> RUNNING（链式下一个 job）
RUNNING --链尾成功--> SUCCESS（释放设备锁、清理容器计划与预留账号）
RUNNING --失败(可重试且还有次数)--> 换新号重登，仍 RUNNING
RUNNING --失败--> FAILED(retryable=true)
RUNNING --取消--> CANCELLED（释放锁与代理，回滚头像昵称）
```

登录成功后的链（由 `job_context` 开关决定）：
`SET_FOLLOWING_COMMENTS → MODIFY_PROFILE → BIND_PHONE → FOLLOW_USER → BACKUP → CLEAR → 下一个 LOGIN（循环）`。

失败语义差异（关键）：

| 失败任务 | 处理 |
|---|---|
| `SET_PROXY` | 释放代理、行失败、**中断该设备** |
| `BIND_PHONE` | 账号标「绑定失败」；有重试次数则换新号重登 |
| `FOLLOW_USER` / `SET_FOLLOWING_COMMENTS` / `MODIFY_PROFILE` | 仅记日志，继续后续链 |
| `LOGIN` | 有重试则回滚头像昵称后换号重登，否则失败 |

## 6. 并发与批次

- `JobRunner(max_concurrent=None)`：**并发 = 设备数**，每个 job 一个子进程。
- 同 IP 批次：按 `serial` 的 host 分组，每组 `same_ip_batch_size`（默认 3）立即提交，其余 `delay = batch_index × interval`（默认 10s）。
- **已知缺陷**：`batch_index` 跨 IP 全局递增，导致后面 IP 的批次被无限推迟；重试时又从 1 开始。
- 容器切换是阻塞式：停轮询 + `processEvents` 忙等，`deadline = timeout + 15s`。
- 设备锁跨标签页互斥（`device_lock_checker/registrar/releaser`）。

## 7. 外部依赖

| 类别 | 内容 |
|---|---|
| MYT v2 | `GET /dc_api/v1/get/{host}`、`/dc_api/v1/run/{host}/{name}?force=1` |
| MYT v3 | `GET http://{host}:8000/android`、`POST /android/start`、`/android/stop` |
| 代理 | `http://{device_ip}:{api_port}/proxy`（默认端口 10008） |
| ADB | `shell`/`push`/`pull`/`ui_xml`/`screencap`/`swipe`/`keyevent`/`launch_app`/`force_stop_app` |
| 深链 | `xhsdiscover://security_account_operation?operateType=bind_phone`、`xhsdiscover://profile`、`xhsdiscover://edit_profile/`、`xhsdiscover://search/result?keyword=` |
| HeroSMS | `/stubs/handler_api.php`：`getNumber(service=qf)`/`getStatus`/`setStatus(3|6)`/`getPrices`/`getCountries` |
| 卡密 | `POST {server}/api/verify` |
| LLM | 用于安全验证拼图识别（默认 Ark 豆包） |

## 8. 数据产物

| 产物 | 位置 |
|---|---|
| 子进程日志 | `logs/{serial 冒号换下划线}_{YYYYmmdd_HHMMSS}.log` |
| UI dump | `logs/ui_dump/{serial}_{tag}_{时间戳}.xml`（tag 含 `no_login_entry`/`code_send_failed`/`resend_timeout`/`final_not_home` 等） |
| 备份包 | `.zip`：`manifest.json` + `files/mmkv/*` + `files/shared_prefs/*`；`bundle_version=2`；默认名 `{sid}----{user_id}----{did}.zip` |
| 账号回写 | TXT 行尾追加 `----成功/失败/绑定失败`；bundle 模式改为**重命名 zip** |
| 配置 | `login_config.json`（卡密、宿主列表、批次参数、新机配置、HeroSMS、LLM） |

## 9. 已知缺陷（移植时必须修）

| # | 问题 | 证据 |
|---|---|---|
| 1 | 卡密前缀分裂：UI 硬编码 `ZHBF`，`auth_client.CARD_PREFIX="ZHDL"` | `device_tab.py:335`、`auth_client.py:26` |
| 2 | 重启「假授权」：只要本地 `remaining_days>0` 就认为已授权，不联网复核 | `:3805-3820` |
| 3 | `only_following_comments` 是死字段（序列化但无人读） | `gui_device_models.py:264` |
| 4 | WebView 备份组不可达（`MODE_GROUPS` 不含 `webview`） | `common.py:127-171` |
| 5 | `restore_bundle` 的 `clear_first`/`skip_init_after_clear`/`init_wait_seconds` 全是 no-op | `restore.py:62-107` |
| 6 | root 检查被注释，但流程依赖 `su` | `worker:316-318,397-400` |
| 7 | 换容器用 `processEvents` 忙等，可重入弹窗 | `:5041-5084` |
| 8 | 同 IP 批次 `batch_index` 跨 IP 累加；重试从 1 重置 | `:3571-3578` |
| 9 | 大 payload 走命令行 argv：`follow_user_ids`+中文路径+api_key 会触发 `WinError 206` | `dispatcher:38-42` |
| 10 | 敏感数据（代理密码、api_key）进进程命令行 | 同上 |
| 11 | 头像预分配即改磁盘文件名，崩溃留脏状态 | `:2972-3003` |
| 12 | 多容器账号预留只在正常终态清理，异常退出残留 | `:5531-5541` |
| 13 | 选择器全为层级下标（登录按钮 7 条路径），无 resource-id 兜底 | `auto_login.py` 各处 |
| 14 | 双 UI 通道：登录用 YADB，其余用 uiautomator | `auto_login.py:421-433` |

## 10. 移植到 TS 的要点

1. 选择器改为「注册表 + 多策略（text/desc/class/结构）+ 录制回归」。
2. `sleep(random)` 改为 `waitUntil(predicate, timeout)`，sleep 只作限速。
3. 四个字典（`job_context_by_id`、`_container_plans`、`_proxy_context_by_job_id`、`batch_account_by_job_id`）收敛为单一 `DeviceRun` 聚合。
4. payload 改文件/stdin，删除死字段（`only_following_comments`、`mode`、`device_provider`）。
5. 保留 dispatcher 的错误码契约作为测试用例：`malformed_json` / `job_route_mismatch` / `missing_terminal_event` / `missing_bundle_path` / `duplicate_terminal_event`。
6. 备份格式显式版本化 + 迁移器；`webview` 组要么实现要么删除。
7. 启动时做能力探测（`id -u`），无 root 早失败。
8. 头像/昵称/TXT 回写改为「暂存 → 提交/回滚」事务。
