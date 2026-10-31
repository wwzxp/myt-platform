# 规格：上号标签页（新平台实现）

- 旧实现：`xhs_device_tab/device_tab.py::XhsDeviceTab`（嵌入式形态，`embedded=True`）
- 新实现：`packages/client/ui/login.html`（页面）+ `packages/app/kernel/src/tabs/login-tab.ts`（契约）+ 内核路由
- 最后核对：2026-10-23

## 1. 控件对照表

| 旧控件 | 旧位置 | 新位置 | 状态 |
|---|---|---|---|
| 刷新列表 | `:3121` | 顶栏「刷新列表」 | ✅ |
| 坑位多容器运行 | `:3125` | 顶栏复选框 | ✅（状态位已留，容器子行未展开） |
| 切换超时(秒) 10–600/120 | `:3130` | 顶栏数字框 | ✅ |
| 稳定等待(秒) 5–120/20 | `:3135` | 顶栏数字框 | ✅ |
| 单项任务 | `:3140` | 操作行「单项任务」 | ✅ 6 项一致 |
| 设备树 5 列 | `:3188` | 表格 7 列（多勾选列与操作列） | ✅ |
| 全选 | `:3211` | 「全选」+ 表头勾选 | ✅ |
| 批导入账号 | `:3217` | 「批导入账号」5 模式对话框 | ✅ |
| 查看日志 | `:3220` | 「查看日志」弹窗 | ✅ |
| 登录并备份 | `:3226` | 复选框 | ✅（状态位） |
| 清除数据 | `:3228` | 复选框，默认勾选 | ✅ |
| 清除数据(动作) | `:3236` | 「清除数据」按钮 | ✅ 真机验证通过 |
| 账号备份(动作) | `:3239` | 「账号备份」按钮 | ✅ 真机验证通过 |
| 大模型配置 | `:3214` | 「大模型配置」弹窗 | ✅ 用于安全验证识图 |
| 立即登录 | `:3242` | 「立即登录」→ 登录设置弹窗 | ✅ 已跑通真机 |
| 取消任务 | `:3245` | 「取消任务」 | ✅ 协作式取消 |

## 2. 按钮 → 执行链路

| 新按钮 | 请求 | 内核行为 |
|---|---|---|
| 刷新列表 | `GET /api/tabs/login/rows?host=` | 拉容器快照 → `ctx.devices.reconcile` → 合成行状态 |
| 单项任务 | `GET /api/tabs/login/tasks` + 确认 | `ui-dump` 走 `xhs.probe`；其余 5 项返回「需要设备级流程」 |
| 清除数据 | `POST /api/tabs/login/batch` (action=clear) | `xhs.device.clear`：connect → force-stop → pm clear → 删外部目录 → 删 tmp |
| 账号备份 | `POST /api/tabs/login/batch` (action=backup) | `xhs.device.backup`：connect → root 检查 → 安装检查 → stop-app → 按 full 分组拉取 |
| 大模型配置 | `GET/POST /api/tabs/login/llm` | 读/写 `llm-config.json`，密钥掩码回显 |
| 批导入账号 | `POST /api/accounts/import` | 5 模式解析，逐行容错 |
| 立即登录 | `POST /api/tabs/login/batch` (action=login) | `FlowRunner.run(xhs.login.phone-prep)`，并行、按设备注册 AbortController |
| 取消任务 | `POST /api/tabs/login/cancel` | 对目标设备 `controller.abort()`，步骤间生效 |
| 查看日志 | 前端内存日志 | 汇总提交/取消记录 |

## 3. 旧实现的关键语义（已保留）

| 语义 | 旧实现 | 新实现 |
|---|---|---|
| 已有任务的设备 | 跳过并提示「已自动跳过」 | `batch` 返回 `error: 已有任务在执行，已跳过` |
| 未运行的容器 | 无 ADB 端点，不可操作 | `serial` 为空，登录按钮禁用、提交被拒 |
| 多容器仅支持批量登录 | 校验并弹窗 | `checkBatchAction` 返回原因 |
| 头像/昵称数量不足 | 按 `slots × loopCount` 校验 | 同（`checkBatchAction`） |
| 状态列 | idle/ready/running/success/failed/cancelled | 同六态，颜色一致 |
| 耗时显示 | 秒/分 | 同（`34s` / `1m20s`） |

## 4. 取码与登录参数

旧 `source_value` 格式：`区号-手机号----链接`。

新接口：
- `params.phone` + `params.countryCode` + `params.codeUrl`
- `params.stopAfterSendCode=true` 时停在发码前（默认行为，未提供 URL 时）
- `params.codeUrl` 非空 → 进入 6 轮取码 + 输入循环

解析函数 `parseSmsCodeLogin()` 与旧 `DeviceSource.parse_sms_code_login()` 等价（缺区号返回 null）。

## 5. 已实现 / 未实现

| 能力 | 状态 |
|---|---|
| 设备列表、状态、耗时、登录源列 | ✅ |
| 批量登录（真实执行，含真机验证） | ✅ |
| 协作式取消（AbortSignal） | ✅ |
| 日志弹窗 | ✅（内存） |
| 单项任务：抓 UI XML | ✅（走探测流程） |
| 单项任务：设代理/新机/改资料/关注/绑手机 | ❌ 需要对应流程包 |
| 清除数据 / 账号备份流程 | ✅ 已实现并真机验证 |
| 批导入账号对话框 | ✅ 5 模式解析（旧 8 子页中的账号/备份包/OP/V/SID）；头像/昵称/代理/新机/HeroSMS 子页未做 |
| 坑位多容器子行展开 | ❌ 只有状态位 |
| 登录源列绑定（每行显示实际来源） | ❌ 恒为「未设置登录源」 |
| HeroSMS | ❌ 内核未接供应商客户端 |
| 头像/昵称/代理/新机子页 | ❌ 未做 |

## 6. 真机验证（2026-10-23 20:05）

```
POST /api/tabs/login/batch {action:login, rows:[5001], login:{phone:13800138000}}
→ 200 {"accepted":[{"deviceId":"0aa43e52…","serial":"192.168.0.113:5001"}]}

40s 后 GET /api/runs
→ status=succeeded, steps=11, 耗时 33.7s

GET /api/tabs/login/rows
→ 0aa43e52… serial=192.168.0.113:5001 status=success duration=33732
→ 另一台 running 容器 status=ready
```

界面截图确认：`192.168.0.113:5001` 行显示「成功 34s」，`5002` 显示「已配置」，其余 69 台未运行容器显示「（未运行）」且登录按钮禁用。


## 7. 第二批实现（2026-10-23 22:15）

### 大模型配置（用于安全验证识图）

| 项 | 值（移植自 `auth_client.py` / `check_safety_verification.py`） |
|---|---|
| 默认 base_url | `https://ark.cn-beijing.volces.com/api/v3` |
| 默认 model | `doubao-seed-1-8-251228` |
| 存储 | `llm-config.json`（**独立文件**，不与 `devices.json` 混写） |
| 解析 | `extractAnswerDigits`：先试 JSON 的 `answer/selected/result/indexes/indices`，失败再剥非数字 |
| 提示词 | `solve_captcha` 原文（2 行 3 列编号规则 + 严格 JSON） |
| 参数 | `temperature=0.1`，单图 + 文本 |
| 密钥回显 | 只回 `abcd12****5678` 掩码 |

实测：保存 → 读回 `configured: true` + 掩码 → 文件落盘 `{"baseUrl","model","apiKey"}`。

### 清除数据 / 账号备份（真机验证）

| 流程 | 步骤 | 结果 |
|---|---|---|
| `xhs.device.clear` | connect → force-stop → `su -c pm clear` → 删 `/sdcard`+`/data/media` 外部目录 → 删 tmp 残留（4 个文件） | ✅ 5 步成功 |
| `xhs.device.backup` | connect → `su -c id` 验 root → `pm path` 验安装 → force-stop → 按 full 模式拉 4 组文件 | ✅ 5 步成功，拉取 10 个文件（core=4） |

### 踩到的两个真 bug

| # | 问题 | 修复 |
|---|---|---|
| 1 | `su -c pm clear com.xingin.xhs` 被拆分成 `su -c pm` + `clear ...` → `Unknown id: clear` | root 命令整体加引号：`su -c '<whole command>'` |
| 2 | `saveLlmConfig` 把 `devices.json`（数组）当对象读写，会破坏设备身份 | LLM 配置独立为 `llm-config.json`；`apiKey=undefined` 表示保持，`''` 表示清空 |

### 批导入账号（5 模式）

解析规则 1:1 移植 `device_tab.py`：

| 模式 | 格式 | 实测 |
|---|---|---|
| sms | `手机号----链接[----状态]`，兼容 `成功--`/`失败--` 前缀 | ✅ 2/3 行有效，坏行自动跳过 |
| bundle | `名字.zip`，支持 `----成功/失败/绑定失败/之前已绑定` | ✅ |
| op / v | `数据----状态` 或旧前缀 | ✅ |
| sid | `sid----uid` 或纯 `sid`（uid 默认 `1`） | ✅ |

## 8. 第三批翻译（2026-10-23 22:43）：改资料 / 关注 / 绑定手机号

### 新增流程

| 流程 id | 源文件 | 步骤 |
|---|---|---|
| `xhs.device.modify-profile` | `auto_modify_info.py`（1249 行） | connect → **require-login** → push-avatar → rename（2 次重试）→ change-avatar（2 次重试）→ wait-loading-gone(30s) |
| `xhs.device.follow` | `auto_follow.py`（413 行） | connect → **require-login** → follow-each（9 轮找按钮 + 复查再点一次） |
| `xhs.device.bind-phone` | `account_bind_phone.py`（1653 行） | connect → open-security（3 轮，已绑定则跳过）→ open-bind-page → wait-country-code(29 轮) → select-country-code → clear-and-input-phone(5 次重试) → code-loop(3 轮) |

### 定位函数（全部逐位搬运）

| 文件 | 内容 |
|---|---|
| `profile-locators.ts` | 个人主页名称(3)、编辑页头像(2)、编辑资料名称(2)、上传新头像(1)、昵称输入框(2)、保存按钮(2)、图库列表(1)、图片保存(1)、加载转圈(1) |
| `follow-locators.ts` | 用户标签(2)、关注/已关注按钮(5，共用路径但**文本精确匹配**：`关注/Follow/關注` vs `Following/已关注/已關注`) |
| `bind-phone-locators.ts` | 手机号行（2 条父路径 + 全树兜底）、`_PHONE_LABELS` 五语言、已绑定判据 `^\+[\d*]+$`、仅关注可评论开关 |

### 实测发现的两个业务前提

| # | 发现 | 处理 |
|---|---|---|
| 1 | 编辑资料页会先弹「个人信息保护提示（同意/不同意）」，不关则页面永不出 | 在 `navigateToEditProfile` 内补点「同意」（**新增行为**，旧代码无此处理） |
| 2 | **未登录时编辑页立即退回首页**（`RouterPageActivity` → `IndexActivityV2`，1.5s 内） | 三个流程都加 `require-login` 步骤，检测「去登录」文案后明确失败，而不是误报「未能进入编辑页」 |

实测证据（未登录设备 `192.168.0.113:5001`）：
```
+1500ms  IndexActivityV2 | ["……","去登录","关注","发现","同城"]
+3000ms  IndexActivityV2 | 同上
+5000ms  IndexActivityV2 | 同上
```
→ 深链被接受（`Starting: Intent`），但页面立刻退回，证明是登录态前提而非选择器问题。

### 新增设备能力

| 方法 | 对应旧实现 |
|---|---|
| `pushToGallery(serial, localPath)` | `upload_img.upload_image_to_gallery`：目录优先级（Download → DCIM/Camera → Pictures → DCIM）→ push → MediaStore `content insert` 注册 → 失败回落 `MEDIA_SCANNER_SCAN_FILE` 广播 |

## 9. 第四批翻译（2026-10-23）：SID 上号 / 备份包恢复 / HeroSMS

### 9.1 MMKV 生成器（`mmkv.ts`）

逐字节移植 `mmkv_generator.py`。字节布局：

```
主文件（4096B）
  [0..3]      actualSize (LE u32)
  [4..7]      rootHolder = varint(0x00FFFFFF) → 固定 4 字节
  [8..]       protobuf 风格 KV
  ...补零

CRC 文件（4096B）
  [0..3]   crc32(main[4 .. 4+actualSize])
  [4..7]   m_version = 4
  [8..11]  m_sequence = 1
  [12..27] IV 全零
  [28..31] m_actualSize
```

| 函数 | 内容 |
|---|---|
| `generateMmkvFiles` | `kv_mig` / `is_privacy_policy_granted` / `current_privacy_policy_version_code` / `key_desc_userinfo` / `bindFlagNew` |
| `generateLoginUserInfoFiles` | 单 blob `login_account_info`（无 key） |
| `generateLoginActivateFiles` | `key_accountGeographicZone` / `key_accountHolderCountry` / `key_has_ever_logged_in` |
| `parseSidFromMmkv` | 三级兜底正则，每级取最后一次匹配 |

**对拍验证**（同一输入 `sid=6100000000012345, userid=5f8a1b2c00000000`，Python 与 TS 输出 SHA-256 完全一致）：

| 文件 | SHA-256 |
|---|---|
| `com.xingin.xhs` | `1718a9d895586fd10aa26d90447a3f4a152ef91c4ba1079d3a6c27ed4c9312d1` |
| `com.xingin.xhs.crc` | `baa50a79d6500732ede44afdf6d5ce0a19a4b725cd2eaadd09dc63bc03eb0a70` |
| `login_user_info_kv` | `dbe18f1b626bb2e1f4a9b4119781c7c09a763c053888aca717a1e48fac1816f1` |
| `login_user_info_kv.crc` | `008aa231b8a8e27b7e002b852def0d047756bb4e73c80beb14b535610969302a` |
| `login_activate` | `13e8ecab1a2a8d007609d6be5bad47fc10d8104079673fc9d73b6dd7152eb78a` |
| `login_activate.crc` | `7313980e40c4cbae4390a8a0b70f9df0ea6ae616d686e5c6a0fc231ced30b4ab` |

### 9.2 SID 流程（`sid-flows.ts`）

| 流程 | 说明 |
|---|---|
| `xhs.sid.extract` | 读 `login_user_info_kv` → 三级兜底解析 → sid/userid 作为 step note 返回 |
| `xhs.sid.login` | 生成 6 个文件 → 停 App → push → chown/chmod → `restorecon` → 重启 → 回读校验 |
| `xhs.sid.clear` | `pm clear` + `rm -rf mmkv 目录` |

**两个必须做对的地方**（漏掉都会表现为「写入成功但还是未登录」）：
1. 写入前 `am force-stop`，否则 App 会覆盖文件
2. 写完 `restorecon -RF mmkv`，否则 SELinux 阻止 App 读取

### 9.3 备份包恢复（`state-restore.ts`）

| 项 | 内容 |
|---|---|
| 分组 | `core`(4 个) / `device_context`(6) / `login_aux`(4) / `shared_prefs`(8) |
| 模式 | `core`（只恢复登录 4 文件）/ `full`（全部分组） |
| 权限推断 | mmkv → `700`；shared_prefs → `660`；其它 → `600` |
| 目标目录 | `files/mmkv`、`shared_prefs`、`app_webview_com.xingin.xhs` |

### 9.4 HeroSMS 客户端（`herosms.ts`）

协议为 **GET + 冒号分隔纯文本**（非 JSON）：

| 响应 | 含义 |
|---|---|
| `ACCESS_BALANCE:<余额>` | 余额 |
| `ACCESS_NUMBER:<id>:<手机号>` | 申请号码成功 |
| `STATUS_OK:<验证码>` | 收到验证码 |
| `STATUS_WAIT_CODE` / `STATUS_CANCEL` | 等待 / 已取消 |

**安全要求**：API key 走 query string，任何异常文本都必须脱敏。已实现 `redact()`，并**不保留原异常对象**（`HeroSmsTransportError` 只存类型名），避免完整 URL 进日志。

离线对拍（本地 fetch 桩，不联网）：余额 `12.34`、号码 `12345/79123456789`、验证码 `5678`、`BAD_KEY` 正确抛错且 `leaked=false`。

### 9.5 内核接入

批量动作改为查表（`ACTION_FLOWS`），替代原来的 8 层三元表达式：

| 动作 | 流程 |
|---|---|
| `login` / `ui-dump` / `clear` / `backup` | 原有 4 项 |
| `modify-profile` / `follow-user` / `bind-phone` | 第三批 |
| `sid-extract` / `restore-state` | 本批新增 |

新增流程总数：**13**（4 个参数化）。

### 9.6 真机验证记录（2026-10-24）

| 流程 | 结果 | 证据 |
|---|---|---|
| `xhs.sid.extract` | ✅ 成功 | `sid=1792769561204765787689`、`userid=6adb7e190000000005007801`（容器 `_copy-1`，root 可用） |
| `xhs.sid.login` | ✅ 三步全部成功 | `require-root` → `write`（sid 回显）→ `verify`（回读一致） |
| `xhs.state.restore` | ⚠️ 仅纯逻辑验证 | 分组 4/22、权限 700/660/600 正确；未在真机跑完整恢复 |

**验证边界（未确认项）**：`sid.login` 验证了「文件写入 + 回读一致」，但「App 重启后是否真的进入已登录态」未确认——验证时容器 `_copy-1` 退出，宿主机其余容器 ADB 全部不通（5001/5003/5004/5005 拒绝连接，5002 超时）。复验需在容器在线时执行：`sid-extract` → `sid-login` → 抓 UI 检查是否还有「去登录」。

**已修复的真机问题**：`requireRoot` 原先把「ADB 掉线导致 su 无输出」误报为「设备未 root」。现在先重连一次，且区分两种失败（无输出 → 连接问题；有输出但非 uid=0 → 真无 root）。

### 9.7 UI 入口（2026-10-24 00:10）

上一批只做了后端流程，UI 没有入口——这是遗漏，本批补上。

| 入口 | 位置 | 弹窗内容 |
|---|---|---|
| SID 上号 | 工具栏 | 多行 `sid,userid` 文本域（支持逗号/空格/制表符/全角逗号分隔）+「先提取当前 SID」+「开始上号」 |
| 恢复备份包 | 工具栏 | 备份包目录 + `core`/`full` 单选 + 「恢复后拉起 App」 |

单项任务弹窗新增 3 项：`提取 SID（读登录态）` / `SID 上号（写登录态）` / `恢复备份包`。

**多设备分配**：`batch` 接口一次只接受一组 `taskParams`，因此 SID 上号按设备逐条提交（每台一个请求），并在条数与设备数不符时拦截。

**浏览器实测**（http://127.0.0.1:7788/login）：

| 检查 | 结果 |
|---|---|
| 工具栏两个按钮存在 | ✅ |
| SID 弹窗打开、显示「已选 1 台」 | ✅ |
| 恢复弹窗打开、core/full 单选正常 | ✅ |
| 提交请求体 | ✅ `{"action":"sid-login","taskParams":{"sid":"…","userid":"…"}}` |
| 失败回显 | ✅ `容器未运行，无 ADB 端点` |

## 10. 交互对齐（2026-10-24 00:41）

上一批只补了入口，交互逻辑与旧版 `auto_fb/wz_device_tab.py` 有 6 处不一致。本批逐条对齐。

### 10.1 对齐清单

| # | 旧版行为 | 源位置 | 新版修正 |
|---|---|---|---|
| 1 | 点击登录源单元格弹出编辑框 | `edit_row_source` | 登录源列改为可点击（蓝色 + pointer），新增 `dlgSource` 弹窗与 `/api/tabs/login/source` 接口 |
| 2 | 按 IP 分组，组头可勾选/半选 | `rebuild_table` `__group__` | 表格插入 `tr.group-row`，组头 checkbox 支持全选与 `indeterminate` |
| 3 | 批量只挑无任务的设备 | `runnable_selected_rows` | 新增 `runnableSelection()`，SID 上号/恢复包/单项任务都先过滤并提示跳过 |
| 4 | 任务执行中禁止改登录源 | `edit_row_source` 的 `active_job_id` 检查 | 后端 409 + 前端 alert 双保险 |
| 5 | 双击容器名复制全名 | `_on_tree_item_double_clicked` | 设备单元格 `data-ctn` + `dblclick` 写剪贴板 |
| 6 | 全选按钮文案切换 | `update_button_states` | `syncSelectAllLabel()` 切「全选 / 取消全选」 |

### 10.2 三处旧版没有、本版新增

| 项 | 理由 |
|---|---|
| 登录源落盘 `device-sources.json` | 旧版存内存，重启即丢；用户每次重启都要重设登录源 |
| 弹窗互斥 | 旧版靠 Qt `setModal(true)`；HTML 版实测出现叠层（SID 上号盖住单项任务），在 `openDialog` 里统一关闭其它弹窗 |
| 登录源格式校验 | 旧版在流程启动时才报错；这里在保存时拦截（`sid----uid` / `手机号----URL`） |

### 10.3 三种登录源（与旧版 `SourceType` 一致）

| kind | 格式 | 示例 |
|---|---|---|
| `bundle` | 备份包路径 | `F:\backup\xhs_state.zip` |
| `sid` | `sid----uid` | `1792769561204765787689----6adb7e190000000005007801` |
| `sms` | `手机号----验证码URL` | `13800138000----https://...` |

### 10.4 浏览器实测

| 交互 | 结果 |
|---|---|
| 按 IP 分组 | ✅ `192.168.0.113（71 台）` |
| 组头勾选 → 全选 71 台、文案变「取消全选」 | ✅ |
| 取消 1 台 → 组头 `indeterminate=true` | ✅ |
| 点登录源 → 弹窗、保存 sid → 单元格变蓝显示值 | ✅ |
| 落盘 | ✅ `device-sources.json` 内容正确 |
| 非法 sid 格式 | ✅ 400 `sid 格式应为 \`sid----uid\`` |
| 运行中改登录源 | ✅ 409 `该设备任务执行中，暂时不能修改登录源` |
| 批量含运行中设备 | ✅ `跳过 1 台执行中的设备：192.168.0.113:5001` |
| 弹窗互斥 | ✅ 连开 3 个只有最后 1 个 open |
| 单项任务清单 | ✅ 9 项（原 6 项 + SID 三项） |

## 11. 设备列表与弹窗一比一复刻（2026-10-24 02:51）

### 11.1 参考文件修正

**重要**：上一批用的是 `auto_fb/wz_device_tab.py`，那是**旧版旧分支**。真正的上号器标签页是
`xhs_device_tab/device_tab.py`（6869 行）。两份文件的控件差异很大，之前据此做出来的 UI 是错的。

### 11.2 设备列表（`device_tab.py:3188-3271` + `3940-4195`）

| 项 | 旧版实现 | 本版 |
|---|---|---|
| 列 | `["设备地址","登录源","状态","耗时","设置"]`（5 列） | 一致；删掉了多出来的「最近错误」 |
| 第 5 列 | `QPushButton("设置")`，`setEnabled(not row.active_job_id)`，tooltip「该设备任务执行中，暂时不可修改登录源」 | 一致 |
| 树 | 宿主组 `__group__\|ip` → 设备 `serial` → 容器 `__ctn__\|serial\|全名` | 一致 |
| 组行 | 背景 `#f1f5f9` + 加粗 + 三态勾选 | 一致 |
| 行底色 | 执行中 `#dbeafe` / 成功 `#dcfce7` / 失败 `#fee2e2` / 已取消 `#fef9c3` | 同色值 |
| 状态文案 | 待命 / 已配置 / 执行中 / 成功 / 失败 / 已取消 | 一致（注意 `READY` 是「已配置」不是「就绪」） |
| 折叠 | 三角 + 保留 `expanded_keys` | `state.collapsed` + `▸/▾` |
| 展开/折叠全部 | `expandAll` / `collapseAll` 按钮 | 一致 |
| 右键 | 全选 / 取消全选 | 一致 |
| 双击容器 | 复制全名 | 一致 |
| 多容器 | 有宿主配置时**自动勾选** | 默认 checked |

### 11.3 选中模型（`on_tree_item_changed:4120-4195`）

三条规则逐条搬：

| 规则 | 旧版代码 | 本版 |
|---|---|---|
| 取消设备勾选 → 容器选择**回落**到当前 running 的那个 | `for c_name, c_state in row.containers.items(): c_state.selected = (c_name == running_name)` | `resetContainersToRunning(row)` |
| 非多容器模式勾选容器 → 同设备兄弟互斥 | `if checked and not self.multi_container_checkbox.isChecked(): ... sibling.setCheckState(Unchecked)` | 同名逻辑 |
| 设备勾选变化 → 重算组头三态（全选/半选/无） | `checked == total → Checked; == 0 → Unchecked; else PartiallyChecked` | `syncGroupState(ip)` |
| 刷新时保留容器勾选 | `cs.selected` 不回零 | `load()` 里按 deviceId+name 恢复 |

### 11.4 批导入账号对话框（`device_tab.py:700-1217`）

旧版是 **8 页签**，之前完全没做（只有一个 textarea）：

| 页签 | 旧版控件 |
|---|---|
| 账号 | 5 模式单选 + 区号 + 选择文件 + 3 列表格（序号/账号信息/状态）+ 导出失败账号 |
| 头像 | 选择文件夹 + 2 列表格（图片路径/状态） |
| 昵称 | 选择 TXT 文件 + 2 列表格（昵称/状态） |
| 魔云腾代理 | 选择 TXT +「N 机」「N ip」+ 3 列表格 |
| 魔云腾新机配置(安卓12) | 随机/指定机型 + 海外随机 + 品牌下拉 + 4 列表格 |
| 关注账号 | 多行文本框 + 关注数量 |
| 绑定账号 | 选择文件 + 导出未成功账号 + 4 列表格 |
| HeroSMS | 启用开关 + 国家 + 4 个按钮（国家/价格/余额/活动号码）+ 价格表 |

模式切换联动（`on_import_mode_changed:1781`）：仅「验证码登录」显示区号；`bundle` 模式按钮文案变「选择文件夹」。

### 11.5 实测

| 项 | 结果 |
|---|---|
| 5 列 + 设置按钮 | ✅ 71 个 `.set-btn` |
| 组头全选 → 71 → 取消 → 0，半选清除 | ✅ |
| 设备勾选 → 取消 → 回落，组头半选正确 | ✅ |
| 全选按钮文案 全选 ⇄ 取消全选 | ✅ |
| 运行中：复选框 + 设置按钮均禁用，tooltip 一致 | ✅ `row-running` |
| 多容器子行：父选中后可勾 | ✅ 71 个全可勾 |
| 折叠 → 1 行；展开 → 72 行 | ✅ |
| 8 页签切换 | ✅ 全部命中 |
| bundle 模式隐藏区号 + 按钮变「选择文件夹」 | ✅ |

### 11.6 新机配置与 HeroSMS（2026-10-24 03:07）

#### 机型库

旧版 `auto_object/tools/myt_devices.py` 读本地 `static/devices.json`，**不调 SDK**。

| 项 | 内容 |
|---|---|
| 数据源 | `packages/app/desktop/resources/tools/devices.json`（7915B，随 extraResources 分发） |
| 规模 | 15 品牌 / 291 机型 |
| 解析 | 只保留「值是对象」的键作品牌，`global_id` 这类标量自动跳过（旧 `load_device_brand_model_map`） |
| 接口 | `GET /api/devices/models` → 品牌列表；`?brand=HONOR` → 该品牌型号 |
| 环境变量 | `MYT_DEVICES_JSON`（由 `main.cjs` 的 `pick()` 传入） |

#### 新机配置页签（`device_tab.py:960-1028`）

| 控件 | 旧版 | 本版 |
|---|---|---|
| 模式 | 随机机型 / 指定机型 + 海外随机 | 一致 |
| 指定面板 | 仅指定模式显示（`_on_reset_mode_changed`） | `impSpecifiedPanel.hidden` |
| 品牌 | `QComboBox` + 「刷新」 | 一致 |
| 型号 | `QListWidget` 多选，限高 150 | `.checklist` 限高 150 |
| 已选表 | 4 列（序号/品牌/型号/操作）；勾选自动加入、取消/删除自动移除 | 一致 |

实测：加载 15 品牌；HONOR → 15 型号；勾选后表格出现 `1 | HONOR | AKA-AL10 | 删除`；切到 HUAWEI（5 型号）后已选保留。

#### HeroSMS 页签（`device_tab.py:1089-1217`）

| 区 | 旧版控件 | 本版 |
|---|---|---|
| 配置行 | 启用开关 + API Key 输入 + 清除已导入账号 | 一致 |
| 国家 | 获取国家 + 下拉 + 搜索框（名称/ID/区号筛选）+ 已选标签 | 一致 |
| 价格 | 获取项目价格 + 3 列表格（价格/库存/实体库存）+ 已选标签 | 一致 |
| 余额 | 获取余额 + 标签 | 一致 |
| 活动号码 | 获取活动号码 + **11 列**表格（激活ID/项目/国家/手机号/价格/状态/验证码/短信内容/获取时间/可再收码/操作） | 一致 |

新增客户端方法（`herosms.ts`）：

| 方法 | 协议 |
|---|---|
| `getCountries()` | handler_api `getCountries`，响应可能是数组 / `{data:[]}` / 单对象，三种都接受 |
| `getPrices(service, countryId)` | **`OFFERS_URL`（v1 REST）+ `Authorization: ApiKey` 头**，只支持 `qf` |
| `getActiveActivations()` | handler_api，行数组来自 `data` 或 `activeActivations.rows` |

后端路由：`POST /api/herosms/{balance|countries|prices|activations}`，API Key 走请求体、不落盘。

实测（假 key）：`HTTP 502 {"error":"HeroSMS 返回 HTTP 401（HTTP_401）"}` —— 错误正确透传，且**响应里不含 API Key**（脱敏生效）。

#### 一个实现事故（已修）

批量替换 `impHeroFetchBalance` 到 `impSave` 之间的 JS 时，把之前插入的新机配置逻辑一起覆盖掉了，导致「指定机型」面板点不显示、品牌下拉只有 1 个空选项。已重新插入并验证（`panelVisible:false → true`，`brands:1 → 15`）。

### 11.7 执行链路复刻（2026-10-24 03:20）

旧版的执行链路埋在 `device_tab.py` 的 `run_batch_action`（约 200 行）+ `on_job_finished`（约 800 行）里，
靠「改 `current_action` 再顺序 if + continue」串起来。本版改成**显式状态机**。

#### 登录后置动作顺序（严格照搬 `device_tab.py:6060-6175`）

```
LOGIN 成功
  1. only_following_comments          → SET_FOLLOWING_COMMENTS
  2. avatar_path && nickname          → MODIFY_PROFILE      ← 两者都有才触发
  3. enable_bind_phone                → BIND_PHONE
  4. follow_user_ids                  → FOLLOW_USER
  之后：BACKUP → CLEAR → 下一循环 LOGIN（loopRemaining-1）
```

**易错点**：绑定手机号在**改资料之后**，不是登录后立刻。第一版做成了「登录 → 绑定 → 改资料」，
状态机测试暴露后已纠正。

#### 状态机（`login-chain.ts`）

| 导出 | 作用 |
|---|---|
| `ChainConfig` | 旧 `job_context` 的 9 个开关 |
| `ChainState` | 当前动作 + `loginPostStepsLeft` 队列 + loop/retry 余量 |
| `advanceChain(state, completed)` | 推进一步，返回下一步或 null |
| `ACTION_FLOW_ID` | 动作 → 流程 id |
| `ACTION_LABEL` | 动作 → 中文名 |

#### 新增接口 `/api/tabs/login/batch-login`

与 `/batch` 的差别：链式。请求体：

```json
{
  "rows": [{ "deviceId": "...", "serial": "..." }],
  "login": { "phone": "...", "countryCode": "+86", "codeUrl": "" },
  "options": {
    "loginLoopCount": 1, "loginRetryCount": 0,
    "loginAndBackup": false, "clearData": true,
    "setAvatarNickname": false, "onlyFollowingComments": false,
    "enableBindPhone": false, "followUsers": false,
    "avatarsAvailable": 0, "nicknamesAvailable": 0
  }
}
```

前置校验（旧 `run_batch_action` 同款）：

| 校验 | 报错 |
|---|---|
| 循环 > 1 且未勾清除数据 | `SMS 多次循环登录必须勾选「清除数据」` |
| 勾了改资料但头像不足 | `头像图片数量不足（需 N 张，现有 M 张）` |
| 勾了改资料但昵称不足 | `昵称数量不足（需 N 条，现有 M 条）` |

#### 新增流程 `xhs.device.following-comments`

移植自 `auto_modify_info.enable_only_following_comments`：

```
connect → open-privacy(xhsdiscover://settings/privacy) → toggle-off×3
```

旧版只在 `checked` 为真时点，重复 3 轮是幂等的。

#### 状态机单测（7 组）

| 配置 | 链 |
|---|---|
| 全关 | （直接结束） |
| 只备份 | backup |
| 备份+清除 | backup → clear |
| 循环 2 次 + 备份 + 清除 | backup → clear → login → backup → clear |
| 全开不循环 | following → modify → bind → follow → backup → clear |
| 仅关注 + 备份 | set-following-comments → backup |
| 只改资料 | modify-profile |

#### 真机验证

| 项 | 结果 |
|---|---|
| `xhs.device.following-comments` | ✅ 3 步全过（note: 已处理 3 轮） |
| 流程总数 | 14 |
| `/batch-login` 提交 | ✅ 返回 `chain: true` + 配置快照 |
| 链式登录 | ⚠️ 设备已登录，「登录入口未出现」——前置条件问题，非链路缺陷 |

#### 登录设置弹窗（`LoginSettingsDialog`，`device_tab.py:2500-2680`）

补齐 4 个数值字段 + 6 个复选框：

| 字段 | 默认 |
|---|---|
| 同 IP 同时启动 | 3 |
| 批次间隔秒数 | 10 |
| 登录循环次数 | 1 |
| 失败设备自动拿号重试 | 0 |
| ☐ 设置头像、昵称 / ☐ 登录前设置魔云腾代理ip / ☐ 登录前一键新机 / ☐ 设置仅关注可评论 / ☐ 登录后绑定手机号 / ☑ 设置adb输入法 | |

### 11.8 批调度 / 代理池 / 容器切换 / 失败重试（2026-10-24 03:33）

#### 同 IP 批调度（`job-scheduler.ts`）

移植 `device_tab.py:3554-3580`：

| 规则 | 实现 |
|---|---|
| 按设备 IP 分组 | `hostIpOf(serial)` 取 `ip:port` 的 IP 段 |
| 每组按 `sameIpBatchSize` 切块 | `planIpBatches()` |
| **每组第一块立即提交** | `delayMs = 0` |
| 后续块延迟 `batchIndex * interval` | `delayMs = i * intervalMs` |

纯函数单测（5 台 IP1 + 2 台 IP2，batch=2，interval=10s）：

```
delay=0ms     a1,a2      ← IP1 首批
delay=0ms     b1,b2      ← IP2 首批（不同 IP 并行）
delay=10000ms a3,a4
delay=20000ms a5
```

真机验证：`batchSize=1, interval=5` → 两台设备启动时间差 **5065ms**。

#### 代理池（`proxy-pool.ts`）

移植 `ProxyPool`（`device_tab.py:2672-2720`）：

| 方法 | 语义 |
|---|---|
| `parseProxyText` | `ip:port:user:pass` / `ip:port`，非法返回 null |
| `acquire` | 轮转游标找第一条 `useCount < machinesPerIp` |
| `getForDevice` | 按设备查占用 |
| `release` | 按设备回收（useCount-1） |
| `requiredProxyCount` | `ceil(totalSlots / machinesPerIp)` |

单测（2 条代理 × 每机 2 台，4 台设备）：

```
d1->1.1.1.1  d2->2.2.2.2  d3->1.1.1.1  d4->2.2.2.2   ← 轮转
第5个 → null（全满）
回收 d1 → 再分配 d5 → 1.1.1.1
```

#### 容器切换（`waitForStableAdb`）

移植 `gui_device_worker.py:171-198`：

| 规则 | 值 |
|---|---|
| 轮询间隔 | 5s |
| **需要持续稳定** | 20s（掉线则清零重来） |
| 掉线重连 | 每 10s 一次 |
| 总超时 | 120s |

#### 新增 SDK 能力

| 方法 | 端点 |
|---|---|
| `setS5Proxy` | **直连容器** `http://<deviceIp>:<apiPort>/proxy?cmd=2&ip=&port=&usr=&pwd=`，不经 SDK 网关 |
| `setPhoneModel` | `get_phone_model_list` → 按 android_version 过滤 → `switch_phone_model?modelId=` |

#### 失败重试

`loginRetryRemaining` 在 `executeChain` 里消费：

```
while (attempt <= retryRemaining):
  run(login)
  if succeeded: break
  attempt++
  if clearData: run(clear)   ← 重试前清数据，避免带着半登录态
```

#### 前置动作接入链

`beginChain()` 按配置生成前置队列：`switch-container → set-proxy → reset-device → login`。

状态机单测（5 组）：

| 配置 | 链 |
|---|---|
| 无前置 | `login` |
| 切换容器 | `switch-container → login` |
| 代理+新机 | `set-proxy → reset-device → login` |
| 前置全开+后置全开 | `switch-container → set-proxy → reset-device → login → following → modify → bind → follow → backup → clear` |
| 循环 2 次全开 | `login → following → backup → clear → login → following → backup → clear` |

#### 4 条前置校验（实测全部生效）

| 校验 | 实际返回 |
|---|---|
| 勾代理但无列表 | `已勾选「登录前设置魔云腾代理ip」，但尚未导入代理 IP 列表` |
| 循环>1 未勾清除 | `SMS 多次循环登录必须勾选「清除数据」` |
| 改资料但头像不足 | `已勾选「设置头像、昵称」，但头像图片数量不足（需 1 张，现有 0 张）` |
| 代理条数不够 | `代理 IP 数量不足：当前 N 条，需要 M 条` |

#### 实现事故（已修）

改造 `/batch-login` 时用「按行号区间整体替换」把 `/batch` 路由的尾部一起切掉了，
导致 `opts`/`config`/`loopCount` 声明丢失、两条路由混在一起。已按原逻辑重建 `/batch`
并把链式代码拆回独立的 `/batch-login`。教训：行号区间替换前必须确认区间内只有目标代码。

### 11.9 换机型端点核实与异步实现（2026-10-24 08:22）

#### 之前写错了

§11.8 里的 `setPhoneModel` 用了两个**不存在的**端点：

| 我原先写的 | 实际 |
|---|---|
| `/dc_api/v1/get_phone_model_list/<ip>` | ❌ 不存在 |
| `/dc_api/v1/switch_phone_model/<ip>/<name>?modelId=` | ❌ 不存在 |

去 `/openapi.json` 核实后的真实端点：

| 端点 | 用途 |
|---|---|
| `GET /and_api/v1/get_devinfo` | 机型列表（无参，返回 `{品牌:{型号:modelid}}`） |
| `GET /and_api/v1/random_devinfo/{ip}/{name}` | 随机换机型（同步） |
| `GET /and_api/v1/set_custom_devinfo/{ip}/{name}?modelid=` | 指定换机型（GET）；POST 变体可写完整设备信息 |
| `GET /and_api/v1/random_devinfo_async2/{ip}/{name}/{act}` | **异步**：`act=request` 发起、`act=query` 取结果 |

#### 关键发现：机型库同源

`get_devinfo` 返回 15 品牌 / 291 机型，与本地 `devices.json` **完全一致**，但**多了 modelid**：

```json
{"HONOR": {"AKA-AL10": 39, "ALA-AN70": 51}, ..., "global_id": 39}
```

因此：

| 项 | 决策 |
|---|---|
| 机型数据源 | **优先 SDK**（带 modelId），SDK 不可达时回落本地 |
| 换机型参数 | 必须用 modelId；同名型号在不同品牌下 id 不同，用名字会换错 |
| 过滤 | SDK 的 `data` 混了 `global_id` 标量，必须按「值是对象」过滤 |

#### 异步协议（实测时序）

```
request  → {"code":200,"data":null,"message":"请求成功"}
query    → 204 × 6（执行中）→ 200（成功）→ 205 × N（任务已清空）
```

状态码（SDK 文档）：

| code | 含义 | 处理 |
|---|---|---|
| 200 | 成功 | 立即返回 true |
| 202 | 新机失败 | 失败 |
| 203 | 任务查询中 | 继续轮询 |
| 204 | 当前任务正在执行中 | 继续轮询 |
| 205 | 当前没有任务 | **失败**（成功后才出现，首次遇到即异常） |
| 206 | 任务超时失败 | 失败 |
| 0-5 | 容器/主机/网络/参数错误 | 失败 |

#### 真机验证（192.168.0.113:5002）

**直接调 SDK：**

| 项 | 换之前 | 换之后 |
|---|---|---|
| 机型 | `SM-A736B` | `BND-AL10` |
| 品牌 | `samsung` | `HONOR` |
| 序列号 | `0687B755B8064E38` | `C21227615A1052CD` |

轮询 7 轮（约 21 秒）拿到 200。

**走内核 `/batch-login` 的 `reset-device` 前置动作：**

| 项 | 触发前 | 触发后 |
|---|---|---|
| 机型 | `BND-AL10` | `M2002J9E` |
| 品牌 | `HONOR` | `Xiaomi` |

换完后链继续进入 `login`（run 状态 running），说明「换机型 → 等 ADB 恢复 → 登录」串联正常。

#### 换机型后的恢复等待

旧版 `random_switch_model` 换完固定 `sleep(20)`；本版改成 `waitForStableAdb`（轮询 5s、需持续稳定 15s、掉线每 10s 重连、总超时 120s）——比固定 sleep 更可靠。

### 11.10 指定换机型：能力边界厘清（2026-10-24 08:36）

#### 三条路径的能力差异（实测）

| 端点 | 语义（SDK 原始 summary） | 能否指定机型 | 依赖 oem_data |
|---|---|---|---|
| `random_devinfo` | 安卓设备**随机**更换设备信息 | ❌ | 否 |
| `random_devinfo_async2` | 安卓设备**随机**更换设备信息 异步2 | ❌ **（`modelid` 被忽略）** | 否 |
| `set_custom_devinfo` | 安卓设备更换**自定义**设备信息 | ✅ | **是** |

#### 关键证据：异步版的 modelid 是摆设

```
request  ?modelid=54   （HUAWEI DVC-AN00）
query    → 204×5 → 200（成功）
实际机型 SM-A705F (samsung)      ← 期望 DVC-AN00，实际换了别的
```

端点名里的 `random` 已经说明一切。**传 `modelid` 不会报错，只会被静默忽略**——
这是最危险的失败模式：看起来成功，实际换错机型。

#### 指定机型的正确姿势（SDK 文档）

```
GET /and_api/v1/set_custom_devinfo/{ip}/{name}?set_custom_devinfo=<modelid>&userip=<ip>
```

两个易错点：

| 点 | 说明 |
|---|---|
| 参数名 | 是 `set_custom_devinfo`，**不是** `modelid` |
| `userip` | **必填**；且文档要求用 SDK 主机真实 IP 访问，不能 `127.0.0.1` |

文档还要求：`oem_data` 目录下必须预置 `.dat` / `_ex.dat` 文件（由真机提取 + 「自定义设备信息_生成设备配置文件」接口生成）。缺失时 SDK 返回 `code=3`。

#### 实测结果

| 场景 | 结果 |
|---|---|
| `set_custom_devinfo?modelid=54`（参数名错） | `code=3`，耗时 55s，机型未变 |
| `set_custom_devinfo?set_custom_devinfo=54&userip=...` | `code=3`，耗时 55s，机型未变（**oem_data 缺失**） |
| `random_devinfo_async2` | ✅ 成功换机型（随机） |
| `random_devinfo_async2?modelid=54` | ✅ 报告成功，但换成 `SM-A705F`（**忽略 modelid**） |

#### 代码决策

| 决策 | 理由 |
|---|---|
| 异步版移除 `modelId` 参数 | 实测无效，保留会误导调用方 |
| 指定机型只走 `set_custom_devinfo` | 唯一支持指定机型的端点 |
| 指定失败时**明确失败，不降级成随机** | 静默降级会换错机型，比失败更糟 |
| 传 `userIp = device.hostIp` | 文档要求；宿主 IP 是设备可达的一侧 |

#### 前置动作可观测性

之前 `reset-device` 等前置动作失败时**没有任何记录**（不进 `FlowRunner`，`/api/runs` 为空），
用户只看到「点完没反应」。

现在每个前置动作都会开一条 run：

```
flowId = "pre:reset-device"
step/failed  precondition  指定换机型失败：该端点依赖宿主 oem_data 预置数据（SDK 返回 code=3）
run/finished failed         failedStep = reset-device
```

UI 的「查看日志」和运行列表都能看到。

### 11.11 oem_data 溯源与能力探测（2026-10-24 08:44）

#### 旧代码库溯源结果

在 `F:\python_code\merge_auto_object\auto_object` 全量搜索：

| 目标 | 结果 |
|---|---|
| `oem_data` 目录 | ❌ 不存在 |
| `*.dat` 设备数据 | ❌ 不存在（只有 .venv 里第三方库的 dat） |
| `map.rule` | ❌ 不存在 |
| `oem_data` 相关代码 | ❌ 无任何引用 |

**旧代码从没实现过 oem_data 流程。** 它的「指定机型」走的是另一条路：

#### 旧版的真实实现：V3 SDK（8000 端口）

`tools/MYT_V3_SDK.py`：

| 端点 | 用途 |
|---|---|
| `GET http://{host}:8000/android/phoneModel` | 机型列表 |
| `POST http://{host}:8000/android/switchModel` | 换机型 |

`switchModel` 的 body 支持三个互斥参数：
```python
{"name": name, "modelId": ..., "localModel": ..., "modelStatic": ...}
```

**这条路不需要 oem_data。**

#### 当前宿主是 V2，没有 8000

| 探测 | 结果 |
|---|---|
| `192.168.0.113:8000` | 连接被拒 |
| `127.0.0.1:8000` | 连接被拒 |
| 宿主版本 | `QL-q1-2024.v0.2.9`（V2） |
| 容器字段 | `api_port: 10005`（V2 风格，无 V3 的 8000） |

所以 V2 宿主上，指定机型只剩 `set_custom_devinfo` 一条路，而它**必须** oem_data。

#### oem_data 的完整生成链（已查清但无源数据）

```
真机提取的设备信息 (oem_file/90.dat)
        + 映射规则 (map.rule)
   → POST /host_api/v1/generate_device_config
   → 生成 {device_id}.dat + {device_id}_ex.dat
   → 放进宿主 oem_data 目录
   → set_custom_devinfo?set_custom_devinfo=<id>&userip=<ip> 可用
```

两端点均存在（`generate_device_config` 用假路径调用返回 500，证明接口在、文件缺）。

#### 交付处理：能力探测 + UI 前置提示

新增 `GET /api/devices/reset-capability`：

```json
{"random": true, "specified": false,
 "reason": "宿主未预置 oem_data（需要真机提取的 .dat 与 map.rule）"}
```

探测方式：拿不存在的路径调 `generate_device_config`，500 或「不存在」即判定未预置。

UI 行为（实测）：

| 项 | 结果 |
|---|---|
| 「指定机型」radio | disabled（置灰不可点） |
| 模式自动落到 | 随机机型 |
| tooltip / 面板提示 | `⚠ 宿主未预置 oem_data（需要真机提取的 .dat 与 map.rule）` |
| 日志 | 记一条能力探测结果 |

#### 为什么不做静默降级

若把「指定机型」静默当成「随机」执行，用户会以为换成了想要的机型，实际是别的——
这比直接禁用更糟。同一原则已用于 `random_devinfo_async2` 的 `modelid`
（实测被忽略，故从代码中移除该参数）。

### 11.12 v3 SDK 源码复刻（2026-10-24 08:52）

按要求「只复刻源码细节，暂不接真实环境」——当前宿主是 v2（无 8000 端口），
v3 代码按旧源码 1:1 移植，逻辑用桩对象单测。

#### 两份 SDK 的协议差异（照 `tools/MYT_V3_SDK.py`）

| 项 | v2（7878） | v3（8000） |
|---|---|---|
| 路径前缀 | `/dc_api/v1`、`/and_api/v1` | **`/android`** |
| 成功判据 | `code === 200` | **`code === 0`** |
| ADB 端口 | 直给 `adb` 字段 | `portBindings["5555/tcp"][0].HostPort` |
| API 端口 | `api_port` | `portBindings["9082/tcp"][0].HostPort` |
| 换机型 | `set_custom_devinfo`（需 oem_data） | **`switchModel`（不需要）** |

**成功码不同是致命的**：v2 的 `get()` 判 `code !== 200` 抛错，直接拿来调 v3 会把每次成功都当失败。

#### 移植清单（12 个函数全覆盖）

| 旧函数 | 新方法 | 说明 |
|---|---|---|
| `get_android_list` | `listAndroids` | 支持 name / running / indexNum 三个过滤 |
| `get_running_android` | `listRunningAndroids` | — |
| `start_android` | `startAndroid` | POST `{name}` |
| `stop_android` | `stopAndroid` | POST `{name}` |
| `_get_host_port` | 内部 `hostPortOf` | 从 portBindings 取 HostPort |
| `get_host_info` | `hostInfo` | 聚合 adbAddrs / containers / nameMap |
| `get_adb_addrs` | `adbAddrs` | — |
| `get_phone_model_list` | `phoneModelList` | `data.list` 每项含 `id`、`android_version` |
| `switch_phone_model` | `switchModel` | 7 个可选参数全透传 |
| `random_switch_model` | `randomSwitchModel` | 按 `android_version` 精确过滤后随机选 |
| `parse_android_version` | `parseAndroidVersion` | 正则 `Q(\d+)` |

#### 一处主动偏离

旧 `random_switch_model` 换完固定 `sleep(20)`。新实现把等待交给调用方
（用 `waitForStableAdb` 轮询真实恢复状态）——固定 sleep 在机型/网络差异下不可靠。

#### 桩对象单测（无真实 v3 环境）

| 项 | 结果 |
|---|---|
| `parseAndroidVersion` | Q16→16、Q14→14、`registry.cn/xxx:Q12_abc`→12、无匹配→null |
| `hostInfo` adbAddrs | `["1.2.3.4:30001", "1.2.3.4:30003"]`（stopped 的不计入） |
| `hostInfo` nameMap | 地址 → 名称，2 条 |
| `hostInfo` containers 排序 | idx 1 → 2 → 3 |
| `hostInfo` apiPort | 从 `9082/tcp` 取到 `19082` |
| `hostInfo` androidType | 从 image 解析出 16 / 12 / 14 |
| `switchModel` 请求体 | `{"name":"c1","modelId":54}` |
| `switchModel` code=0 | true |
| `switchModel` code=5 | **false**（不能当成功） |

#### 接入策略

换机型分两级回落：

```
指定机型
  ├─ v3 switchModel（8000，不需要 oem_data）
  └─ 回落 v2 set_custom_devinfo（需要 oem_data）
随机机型
  └─ v2 random_devinfo_async2（任何宿主都有）
```

`trySwitchModelV3()` 用一次 `listAndroids(host, {}, 5000)` 探活：
不通（抛错）返回 `null` → 回落 v2；通了则按 `code === 0` 判成败。

能力探测也升级了，返回 `via` 字段：

```json
{"random": true, "specified": false, "via": "none",
 "reason": "v3 SDK 不可达（8000 端口）；宿主未预置 oem_data（需要真机提取的 .dat 与 map.rule）"}
```

`via` 取值：`v3` / `v2-oem` / `none`，UI 据此显示不同的能力来源说明。

#### 包结构

按 STYLE §2「一个包一个角色」，v3 独立成 `packages/myt/myt-api-v3`（不塞进 v2 包）。

### 11.13 HeroSMS 国家解析修复 + 4 按钮实测（2026-10-24 08:59）

#### Bug：国家名映射错字段

第一版按 `name` / `dialCode` 解析，但 HeroSMS 实际返回的是**三语言名 + 三个标志位**：

```json
{"id": 3, "rus": "Китай", "eng": "China", "chn": "中国",
 "visible": 1, "retry": 1, "rent": 0}
```

旧 `_parse_country_info`（`herosms/client.py:294-321`）的字段映射：

| 字段 | 类型 | 说明 |
|---|---|---|
| `rus` / `eng` / `chn` | 必填字符串 | 三语言名，任一缺失即报 `BAD_RESPONSE` |
| `visible` / `retry` / `rent` | 非负整数（默认 0） | 可见 / 可重试 / 可租用 |

**没有 `dialCode`。** 我的第一版读 `name`/`dialCode` 全得空串，UI 只能退化显示 ID
（下拉首项是 `"2"`），且搜索「china」无匹配。

#### 修复

- `CountryInfo` 接口改为 `{countryId, rus, eng, chn, visible, retry, rent, raw}`
- 解析按旧版严格校验（三语言名必填、标志位非负）
- UI 显示优先 `chn` → `eng` → `rus` → ID
- 搜索三种语言名 + ID 都参与匹配

#### 4 个按钮实测（假 key）

| 按钮 | 结果 |
|---|---|
| 获取国家 | ✅ **真实返回 195 条**（该接口不校验 key） |
| 下拉显示 | ✅ `乌克兰 (1)` / `哈萨克斯坦 (2)` / `中国 (3)` |
| 搜索 `china` | ✅ 过滤出 `中国 (3)` |
| 选中中国 | ✅ 标签 → `国家：中国 (3)` |
| 获取余额 | ✅ 透传 `HeroSMS 返回 HTTP 401` |
| 获取活动号码 | ✅ 透传 401 |
| 获取项目价格 | ✅ 透传 `HeroSMS offers 返回 HTTP 403`（走 OFFERS_URL，鉴权方式不同） |
| 无 key 时点 4 个按钮 | ✅ 全部拦截：`请先填写 HeroSMS API Key` |

#### 注意：国家接口不需要 key

`getCountries` 用假 key 也能返回完整列表——说明它不校验鉴权。
这不是 bug，但意味着「能拉到国家列表」**不代表 key 有效**；
余额/价格/活动号码才是真正的鉴权检验。

### 11.14 一键新机：真相与移植（2026-10-24 09:21）

#### 关键发现：一键新机不是 SDK 接口

旧 `_run_device_reset`（`gui_device_worker.py:79-128`）分两条完全不同的路：

| 条件 | 走哪条 | 本质 |
|---|---|---|
| `android_type ∈ {0, 12}` | `One_click_new_device(adb)` | **UI 自动化**，点容器内 App |
| `android_type ∉ {0, 12}`（14/16） | `random_switch_model` | V3 SDK HTTP |

`One_click_new_device` 操作的是容器里预装的第三方 App
**`com.blue.backup`**（`/system/app/phoneinfo/phoneinfo.apk`，5.8MB），
通过 `resource-id` + **UI 层级路径**点击完成。所以：

- 需要设备在线且 App 能启动（SDK 换机型不需要）
- 依赖固定 id 与层级路径，App 改版即失效
- 比 SDK 多做了「清除小红书数据」

#### 指纹数据在哪（回答「指纹也在里面」）

查证结论：

| 位置 | 结果 |
|---|---|
| 旧代码库 `auto_object/` | ❌ 无 oem_data、无设备 .dat、无 map.rule、无相关代码 |
| APK 内 assets | ❌ 无数据文件（585 个条目里只有 dex / 图片 / Apache 数学表） |
| APK dex 里的域名 | `api.moyunteng.com`（魔云腾官方）、`api.mobileanjian.com` |
| dex 里的指纹字段 | `imei`×15、`fingerprint`×48、`wifiMac`×2、`androidId`×3、`oaid`×4 |
| 设备 `/data/data/com.blue.backup/files` | 空目录 |

**指纹数据不在本地，也不在 APK 里**——App 运行时从 `api.moyunteng.com` 拉取。
本流程只负责「让 App 自己换一套」，不接触指纹内容。

dex 里的关键类：`ModelService`、`RandomModelFragment`、`SpecifiedModelFragment`、
`CustomModelFragment`、`ModelHistoryActivity`。

#### App 页面结构（实测，2026-10-24 09:40 修正）

**这段的早期结论有误，已更正。** 早期写「`textView1` / `set_card_property` 不存在」
是因为 dump 抓到的是流程**走完之后**的「清理应用」页；两个入口在首页是存在的
（5001 上整条流程跑通即为证据）。

真实页面序列（三段）：

| 阶段 | 关键节点 | 说明 |
|---|---|---|
| ① 首页 | `textView1` → `set_card_property` | 旧代码的两跳入口，**存在** |
| ② 修改设备信息 | `random_btn`（文本「下一步」）、`checkbox`（海外设备随机）、`spinner_language` | 选机型 |
| ③ 清理应用 | `app_list` / `app_name` / `app_checkbox` / `cancle`（跳过）/ `clear`（立即清理） | 勾应用后清理 |

② 的层级（`yadb` dump）：

```
FrameLayout
├ LinearLayout (android:id/content)
│ ├ LinearLayout head_back → head_title '修改设备信息'
│ ├ HorizontalScrollView tablayout
│ │ └ 随机机型 / 指定机型 / 自定义设置
│ └ ViewPager viewpager
│   ├ ImageView checkbox          ← 海外设备随机
│   ├ TextView '海外设备随机'
│   ├ TextView '系统语言：' + Spinner spinner_language
│   ├ TextView '随机产生机型数据'
│   └ TextView random_btn '下一步'
│ └ TextView clear '立即清理' / cancle '跳过'（清理页）
```

#### 路径偏移修正（重要）

旧 Python 的 `root` 是 `<hierarchy>` 元素，本项目的 `parseUiXml` 以**第一个 `<node>`**
为 root，所以所有路径要**去掉前导一个 `0`**：

| 用途 | 旧路径 | 实测正确路径 |
|---|---|---|
| 指定机型 tab | `[0,0,0,0,1,0,1]` | `[0,0,0,1,0,1,0]` |
| 海外随机 | `[0,0,0,0,2,0,0,0]` | `[0,0,0,2,0,0,0]` |
| 下一步 | `[0,0,0,0,2,0,3]` | `[0,0,0,2,0,3]` |
| 立即清理 | `[0,0,0,0,5,1]` | `[0,0,0,5,1]` |

用项目解析器验证（`bun` 直跑）：

```
指定机型tab 0,0,0,1,0,1,0 -> ActionBar$e（旧路径指向错误节点）
海外随机   0,0,0,2,0,0,0 -> ImageView @checkbox  ✅
下一步     0,0,0,2,0,3   -> TextView @random_btn '下一步'  ✅
```

#### 严格复刻（2026-10-24 09:35 修正）

按用户要求「一比一复刻，不考虑合理性」，已回退之前的所有主动改动：

| 之前 | 现在 |
|---|---|
| 找不到 textView1 就跳过两跳 | **照旧等 textView1**，找不到即失败 |
| 清理页无小红书 → 点「跳过」仍算成功 | **照旧 `return false`**，整个新机失败 |
| 拆成 6 个 step | **合成 1 个 step**（旧版就是一个原子函数） |
| 层级路径减一层 | **原样保留旧路径**（带前导 0） |

复刻后的实现逐函数对应：

| 旧函数 | 新函数 |
|---|---|
| `_ui_xml` | `uiXml` |
| `_normalize_text_candidates` | `normalizeTextCandidates` |
| `_find_ui_element` | `findUiElement`（保留正则匹配语义） |
| `_check_ui` | `checkUi`（**先 sleep 再检查**，同旧版） |
| `_check_ui_scroll_list` | `checkUiScrollList`（保留"连续两次相同即到底"启发式） |
| `_get_specified_tab_position` | `getSpecifiedTabPosition` |
| `_get_spinner_position` | `getSpinnerPosition` |
| `One_click_new_device` | `oneClickNewDevice` |

#### 严格复刻的实测：一台失败、一台成功（2026-10-24 09:40 修正）

**⚠️ 修正前一版的错误结论。** 前一版据「id 列表里没有 textView1」判断
「当前 App 已改版」，那是**误判**——那次 dump 抓到的是流程**已经走到**的
「清理应用」页，不是首页。

两台设备对照（同一份复刻代码）：

| 设备 | 小红书已安装 | 机型变化 | 结果 |
|---|---|---|---|
| `192.168.0.113:5002` | ❌ `pm path` 为空 | `SM-X706N` → `SM-X706N` | **failed** |
| `192.168.0.113:5001` | ✅ 已安装 | `SM-G986N` → **`Pixel 3`** | **succeeded** |

5001 的成功日志：

```
run: xhs.device.one-click-new | 192.168.0.113:5001 | succeeded steps 1
note: 一键新机完成
```

#### 失败的真实原因

旧代码流程是「换机型 → 勾选**小红书** → 立即清理」。5002 上：

```
$ pm path com.xingin.xhs
（空）

清理页 app_name 列表：
  talkback / Kitsune Mask / FIRERPA / ADBKeyBoard     ← 没有小红书
```

`_check_ui(app_name, ['小紅書','小红书','rednote'])` 等 20 轮 × 2s 后返回 False，
于是整个函数 `return false`。

**这是旧代码的固有前提（设备必须装小红书），不是移植缺陷，也不是 App 改版。**
要做「不装小红书也能新机」，只能偏离旧代码（旧版会失败，改法见 §11.14 前几版记录）。

#### 版本沿革（避免混淆）

本文件前几版实现的是「适配版」而非严格复刻，已回退。留档对比：

| 版本 | 行为 | 5002（无小红书） | 5001（有小红书） |
|---|---|---|---|
| **适配版**（已回退） | 拆 6 步；无小红书时点「跳过」仍算成功；路径减一层 | ✅ 成功 `SM-A705F → SM-X706N` | 未测 |
| **严格复刻**（当前） | 单步原子函数；无小红书即失败；路径原样 | ❌ 失败 | ✅ 成功 `SM-G986N → Pixel 3` |

两版都能换机型；差别只在「没装小红书时怎么办」——
适配版放行，复刻版失败（与旧代码一致）。

#### 指定机型模式也验证通过（2026-10-24 09:55）

5001 上测「随机 → 指定」两种模式：

| 模式 | 参数 | 换前 | 换后 | 结果 |
|---|---|---|---|---|
| 随机 | `overseasRandom=true` | `SM-G986N` | **`Pixel 3`** | ✅ |
| 指定 | `brand=OPPO, model=CPH2009` | `Pixel 3` | **`CPH2009` / OPPO** | ✅ |

指定机型用的正是旧代码 docstring 里的示例参数
（`One_click_new_device(ip_param, "OPPO", "CPH2009")`），说明品牌/型号下拉的
层级路径（`brandSpinner` / `modelSpinner` / `checkUiScrollList`）在实际 UI 上成立。

#### 流程注册

| 项 | 值 |
|---|---|
| 流程 id | `xhs.device.one-click-new` |
| 参数 | `brand` + `model`（同时给出才走指定机型）、`overseasRandom` |
| 批量动作 | `one-click-new` |
| 流程总数 | 15 |

### 11.15 覆盖率复核 + HeroSMS 登录编排（2026-10-24 10:32）

#### 复核结论：几项「以为没做」的其实已完成

按旧模块逐个核对，下面这些**早已移植**，之前自查时误报为缺口：

| 旧函数 | 已存在于 | 说明 |
|---|---|---|
| `handle_safety_verification_page` | `verification.ts:164` | 更细：区分 `retapVerifyLogin` 的 break 行为 |
| `_find_safety_verification_grid_cells` | `guide-locators.ts` | 三种页面结构全覆盖 |
| `get_safety_verification_verify_button_info` | `guide-locators.ts:186` | 三条路径 + 文字兜底 |
| `get_server_error_refresh_button_position` | `guide-locators.ts:170` | 三条路径 |
| `get_birth_year/month/day_position` | `guide-locators.ts` + `birthday.ts` | 含 picker 滚动 |
| `main_op_login` / `main_v_login` | `alt-login-flows.ts`（265 行） | OP / V跳 |

期间我误建了一份重复的 `safety-verification.ts`，已删除——两份实现会分叉。

#### 路径约定（重要）

项目里 `paths.ts:nodeAtPath` 用 `path.slice(1)`：

```
root 自身 = 第一级  →  path 首位对应 root，跳过
```

旧 Python 的路径以 `<hierarchy>` 为根、首个 `0` 表示第一个 `<node>`，
正好与之等价。**所以旧路径可以原样搬，不需要手工减一层。**
（一键新机那轮我曾误以为要减一层，是因为当时自己写的 `nodeAt` 没沿用这个约定。）

#### 新增：HeroSMS 登录编排（`herosms-login.ts`）

移植 `auto_login.py:3103-3147` 的 `sms_provider == "herosms"` 分支。之前只有「按 activationId 查码」，
缺「申请号码 → 登录 → 定终态」这条生命周期。

| 旧逻辑 | 实现 |
|---|---|
| `get_number(service="qf", country, max_price)` | `client.getNumber('qf', countryId, {maxPrice})` |
| `normalize_herosms_phone(phone, country_code)` | `normalizeHeroSmsPhone()` |
| `for i in range(1,3)` 最多 2 次 | 同 |
| 成功 `set_status(3)` | `ActivationStatus.COMPLETE` |
| 失败 `set_status(6)`（在 **finally**） | 同，且收尾异常不覆盖主异常 |
| `_last_error_reason == "验证码发送失败"` → break | `isCodeSendFailed()` 回调 |
| 重试前 `force_stop_xhs` | `restartApp()` 回调 |

#### 单元测试（桩 client，6 组）

| 场景 | attempts | 状态流转 | 判定 |
|---|---|---|---|
| 首次成功 | 1 | 置 **3** | ✅ |
| 失败两次 | 2 | 置 **6** | ✅ |
| 验证码发送失败 | **1**（不重试） | 置 6 | ✅ |
| 第二次成功 | 2 | 置 3 | ✅ |
| `attemptLogin` 抛异常 | — | 置 6 | ✅ |
| `normalizeHeroSmsPhone` | — | `8613800138000/+86 → 13800138000` | ✅ |

最后一项最关键：**无论成败都必须把激活置终态**，否则号会一直被占用计费。

### 11.16 tools/ 目录收尾复刻（2026-10-24 11:17）

#### 本轮补齐清单

| 旧文件 | 行数 | 状态 |
|---|---|---|
| `myt_sdk_v2.py` | 217 | ✅ 8 函数（4 个本次新增） |
| `myt_api.py` | 164 | ✅ 4 函数（3 个本次新增） |
| `upload_img.py` | 270 | ✅ 全部（含批量上传） |
| `mmkv_diff.py` | 228 | ✅ 解析器 3 函数 |
| `update_checker.py` | 65 | ✅ 1 函数 |
| `myt_devices.py` | 74 | ✅ 早已移植（device-models.ts） |

#### 新增能力

**V2 SDK（`myt-api-v2`）**

| 方法 | 旧函数 | 端点 |
|---|---|---|
| `getApiInfo` | `get_api_info` | `/and_api/v1/get_api_info/{ip}/{name}` |
| `queryS5Proxy` | `query_s5_proxy` | **直连容器** `GET {ip}:{apiPort}/proxy` |
| `stopS5Proxy` | `stop_s5_proxy` | **直连容器** `/proxy?cmd=3` |
| `setDeviceLanguageCountry` | `set_device_language_country` | **直连容器** `/modifydev?cmd=13&language=&country=` |

注意后三个都是**直连容器**，不经 SDK 网关（与 `set_s5_proxy` 同一类）。

**设备层**

| 方法 | 旧函数 |
|---|---|
| `pushImagesToGallery` | `upload_images_to_gallery`（逐张，失败跳过） |

**MMKV 解析器（`mmkv.ts`）**

| 函数 | 旧函数 |
|---|---|
| `decodeVarint` | `mmkv_diff.decode_varint` |
| `parseMmkvRaw` | `parse_mmkv_raw` |
| `describeMmkvValue` | `describe_value` |

**版本检查（`tabs/update-checker.ts`）**

`checkUpdates()` 移植 `check_updates`，含四类异常的中文文案映射
（超时 / 连不上 / JSON 异常 / 其它）。

#### 解析器对拍验证（与旧 Python 逐项一致）

用生成器产出真实 MMKV，再用解析器解回来：

| 文件 | 解析结果 | 与旧 Python |
|---|---|---|
| `com.xingin.xhs` | 5 个 key：`kv_mig` / `is_privacy_policy_granted` / `current_privacy_policy_version_code` / `key_desc_userinfo` / `bindFlagNew` | ✅ 完全一致 |
| `key_desc_userinfo` 内容 | `string(692): {"account_center_entry":...}` | ✅ 一致 |
| `login_user_info_kv` | 单个乱码 key（blob 无 key 结构） | ✅ **连乱码都一样** |
| `login_activate` | 3 个 key 正确 | ✅ 一致 |

#### 一处旧代码的固有缺陷（未修，按复刻原则保留）

`describe_value` 的 bool 分支**永远走不到**：函数先按「双层长度前缀 string」解，
bool 的 `varint(1)+0x00` 会被误读成 `string(0)` 并直接返回。

实测两边输出完全相同：

```
旧 Python: kv_mig: string(0):
新 TS    : kv_mig: string(0):
```

这是旧代码的 bug，不是移植偏差。要修需要偏离复刻，已记录待决策。

### 11.17 HeroSMS 接入登录链（2026-10-24 12:06）

#### 接线

`/api/tabs/login/batch-login` 的 `options.smsProvider === 'herosms'` 时走编排：

```
executeChain
  ├─ provider=herosms → loginWithHeroSms
  │    ├─ client.getNumber('qf', countryId, {maxPrice})
  │    ├─ normalizeHeroSmsPhone 去区号
  │    └─ attemptLogin(phone, activationId) ×2 → 成功置 3 / 失败 finally 置 6
  └─ provider=legacy → 原路径（retryRemaining 重试）
```

关键点：**HeroSMS 分支不再叠加外层 `retryRemaining`**——编排内部已有 2 次重试，
再叠一层会变成 4 次，且 `finally` 的取消语义会被打乱。

#### 客户端解析修复

登录 flow 工厂原来只认启动注入的 `options.heroSmsClient`，而链式执行是**一单一号**，
client 必须按本次的 key 现建：

```ts
const heroApiKey = String(params['heroSmsApiKey'] ?? '').trim()
const heroClient = heroApiKey
  ? new HeroSmsClient(heroApiKey)
  : options.heroSmsClient ?? null
```

另外把 `SmsStatus.code`（`string | null`）统一成 `code?: string`，
与 `VerificationCodeSource.getStatus` 的签名对齐。

#### 实测（假 key）

```
[kernel] [chain:192.168.0.113:5002] 开始执行，provider=herosms
[kernel] [chain:192.168.0.113:5002] 异常: HeroSMS 返回错误：BAD_KEY（BAD_KEY）
```

runs 里出现：

```
flowId: pre:login-chain   status: failed
step/failed  precondition  HeroSMS 返回错误：BAD_KEY（BAD_KEY）
```

#### 顺带修的可观测性缺口

编排层抛异常时，之前**只有 console 日志、没有 run 记录**，
UI 上看起来像「点完什么都没发生」。

现在 `executeChain` 的 catch 会补一条 `pre:login-chain` run 并写 `step/failed`，
原因直接可见。

#### 调试踩坑

grep 日志时用了 `\[chain:`，但实际格式是 `[kernel] [chain:...]`（kernel 和 message 之间还有一层前缀），
导致误判「链没执行」。正确写法：`grep "chain:"`。

### 11.18 全面收口：剩余四项一次补齐（2026-10-24 14:33）

#### 先做全面盘点（不再逐次小补）

**定位函数覆盖核对**：用脚本对比 `auto_login.py` 的 34 个 `get_*` / `is_*` 与 TS 侧实现，
逐个确认函数名对应关系（snake_case → camelCase）：

| 检查 | 结果 |
|---|---|
| 旧定位函数 | 34 个 |
| TS 侧已实现 | 全部命中（含 `findSafetyVerificationGridCells` = `get_safety_verification_image_positions`） |
| 真缺口 | **0** |

**UI handler 覆盖核对**：对照 `device_tab.py` 的 24 个 `_on_*` / `_fetch_*` / `_clear_*`：

| 旧 handler | 本版状态 |
|---|---|
| `_on_herosms_country_changed` | ⚠️ 本次补（国家切换使报价失效） |
| `_on_herosms_price_changed` | ⚠️ 本次补（选中行显示详情） |
| `_update_herosms_account_exclusion` | ⚠️ 本次补 |
| `_clear_herosms_imported_accounts` | ⚠️ 本次补（含确认框） |
| `_confirm_cancel_herosms_activation` | ⚠️ 本次补 |
| `_on_reset_mode_changed` / `_on_brand_changed` / `_on_reset_model_checked` | ✅ 已有 |
| 其余（auth/refresh/ui_dump 等） | ✅ 已有或架构不同 |

#### 本次补齐的四项

**1. 活动号码「取消购买」**

旧 `_confirm_cancel_herosms_activation`：
```
弹确认框「确认取消活动号码 {id} 的购买吗？」→ 确认 → setStatus(6)
```

| 位置 | 实现 |
|---|---|
| 后端 | `POST /api/herosms/cancel` → `client.cancelActivation(id)` |
| 前端 | 表格「取消」按钮 → `confirm()` → 调接口 → 刷新列表 |

实测：

```
无 id      → {"error":"缺少 activationId"}          (400)
假 key+id  → {"error":"HeroSMS 返回 HTTP 401"}      (401 透传)
```

**2. HeroSMS 启用互斥**（旧 `_update_herosms_account_exclusion`）

旧规则：
- 已有导入账号 → 禁用 HeroSMS 勾选框，tooltip「已有导入账号，请先清除已导入账号」
- 启用 HeroSMS → 禁用 文件选择 / 区号 / 5 个登录模式单选
- 清除按钮仅在「有账号」时可用

实测（启用后）：

```
chooseFileDisabled: true
areaCodeDisabled:   true
modesDisabled:      true（5 个单选全禁）
clearBtnDisabled:   true（无账号时禁用）
```

**3. 代理池「N 机 / N ip」联动**（旧 `math.ceil(total_slots / machine_count)`）

```
设备数 ÷ 每 IP 机数 = 需要的 IP 条数
```

实测：71 台 ÷ 3 机/IP = **24 条**（`ceil(71/3)=24`）。

同时把 `proxies` 与 `proxyMachinesPerIp` 传给 `/batch-login`，
后端 `requiredProxyCount` 校验即可生效。

**4. 清除已导入账号的确认框**

旧版弹「确定清除当前已导入账号吗？…不会删除磁盘上的原始 TXT 文件」。
本版补上同文案确认 + 清除后刷新互斥状态。

#### 仍然不做的（旧代码本身就没有）

| 项 | 说明 |
|---|---|
| 「自定义设置」tab | 旧代码只有占位 `CustomModelFragment`，无实现逻辑 |
| 多语言验证码 URL 的 `fetch_url_contet_new` | 与 `fetch_url_content` 仅差 User-Agent/重试细节，非独立能力 |

### 11.19 移除 oem_data 相关代码（2026-10-24 14:40）

#### 用户指出：旧一键新机根本没用到 oem_data

核实结果（`grep -in "oem|\.dat|custom_devinfo"`）：

| 文件 | 命中 |
|---|---|
| `tools/One_click_new_device.py` | **0** |
| `gui_device_worker.py` 的 reset 分支 | **0** |

旧代码的真实分流（`_run_device_reset`，worker:78-128）：

| 条件 | 走哪条 |
|---|---|
| `android_type ∈ {0, 12}` | `One_click_new_device`（点 `com.blue.backup` 的 UI） |
| `android_type ∉ {0,12}`（14/16） | V3 `random_switch_model`（8000 端口） |

**`set_custom_devinfo` / oem_data 这条路径旧代码从未走过。**
它是 §11.10-11.11 里我从 SDK 文档翻出来后自行加入的，违背「只复刻」原则，已全部移除。

#### 移除清单

| 位置 | 移除内容 |
|---|---|
| `kernel.ts` | `GET /api/devices/reset-capability` 整个路由 |
| `kernel.ts` | `trySwitchModelV3()`、`setPhoneModel` 回落分支 |
| `myt-host` / `myt-api-v2` | `probeOemData()`、`setPhoneModel()` |
| `login.html` | `probeResetCapability()`、「指定机型」禁用逻辑、`via` 提示 |

#### 重写 reset-device 分支（严格照旧代码）

```ts
const androidType = parseAndroidVersion(container?.image ?? '')
if (androidType !== null && androidType !== 0 && androidType !== 12) {
  // V3 randomSwitchModel(host, name, androidVersion)
} else {
  // 跑 xhs.device.one-click-new（点 com.blue.backup）
}
// 之后同样是 waitForStableAdb 等恢复
```

注意：`android_type === null`（解析不出）时**走 App 路径**，
与旧版 `android_type not in (0, 12)` 的判断一致——旧代码里 `0` 表示「未知/非魔云腾」。

#### 清理后真机验证

| 项 | 值 |
|---|---|
| 流程 | `xhs.device.one-click-new` |
| 结果 | **succeeded** |
| 机型 | `CPH2009` → **`SM-F711N`** |

说明移除 oem_data 相关代码没有破坏任何既有能力。

#### 「指定机型」现在可用

之前因 oem_data 缺失被禁用，现在恢复为旧代码的真实路径：
`One_click_new_device(brand, model)` 的品牌/型号下拉（已在 §11.14 验证 `OPPO CPH2009`）。

### 11.20 取码函数复核：一个是死代码、一个已完整移植（2026-10-24 14:52）

上一版 §11.18 写「`fetch_url_contet_new` 与 `fetch_url_content` 只差 User-Agent/重试细节」——
**这是错的，未经验证就下的结论。** 逐行比对后的真实差异：

| 项 | `fetch_url_content` | `fetch_url_contet_new` |
|---|---|---|
| 技术栈 | **DrissionPage**（无头 Chromium） | **requests**（纯 HTTP） |
| 能否执行 JS | ✅ 能（等 JS 渲染后取码） | ❌ 不能 |
| 重试 | 6 次 | **30 次** |
| 重试间隔 | **7–12s**（刷新页面） | **0.8–1.5s**（重新请求） |
| 代理 | — | `trust_env = False` 绕开系统代理 |
| 请求头 | — | `Accept-Encoding: gzip, deflate`（服务端不支持 br） |

不是「细节差异」，是两套完全不同的取码机制。

#### 调用关系（决定是否需要移植）

```
fetch_verification_code
  ├─ sms_provider == "legacy"  → fetch_url_contet_new   ✅ 已移植
  └─ sms_provider == "herosms" → client.get_status 轮询  ✅ 已移植
```

全库搜索 `fetch_url_content` 的调用者：

| 位置 | 说明 |
|---|---|
| `fetch_verification_code` | **不调用**（只调 `_new`） |
| `tests/auto_login.py:1291` | 测试文件 |
| 生产代码 | **0 处** |

**`fetch_url_content`（DrissionPage 版）是死代码，不存在调用路径。**

#### 处置

不移植。理由：旧代码里没有任何生产路径会调用它，
移植一个死函数等于制造本项目自己的死代码（违背 STYLE「删除死代码」）。

#### 已移植部分核对（`verification.ts:47-73`）

`fetchLegacyCode` 与 `fetch_url_contet_new` 逐项对齐：

| 旧 | 新 |
|---|---|
| `max_attempts = 30` | `maxAttempts ?? 30` |
| `if attempt > 0: sleep(random.uniform(0.8, 1.5))` | `if (attempt > 1) sleep(800 + rand*700)` |
| `session.trust_env = False` | `httpGetNoProxy()` 用 `node:http` 直连（不走 `HTTP_PROXY`） |
| `Accept-Encoding: gzip, deflate` | 同名请求头 |
| 剥 `<script>` / `<style>` 后取首个 6 位数字 | `extractSixDigitCode()` 同逻辑 |
| 单次异常吞掉继续 | 同 |

已验证无误，无需改动。

### 11.21 全量函数审计：282 个旧函数逐项判定（2026-10-24 15:19）

按上轮承诺，用机器化脚本把 `xhs_device_tab/*.py` + `tools/*.py` 的 **282 个函数**
全部列出，按「是否实现」+「旧代码调用次数」交叉判定。

#### 审计方法

```python
# 1. 提取旧代码所有 ^def
# 2. 转 camelCase 后在 packages/**/*.ts 里查找
# 3. 统计该函数在旧代码库内被调用次数（排除定义行）
```

#### 统计

| 项 | 数量 |
|---|---|
| 旧函数总数 | 282 |
| TS 已实现（名字直接匹配） | 142 |
| 名字未匹配 | 140 |

名字未匹配的 140 个里，绝大多数是**架构不同导致的合理缺失**，不是真缺口。
逐项判定结果：

#### A. 架构差异，本版不需要（约 120 个）

| 类别 | 代表函数 | 次数 | 为什么不需要 |
|---|---|---|---|
| 原始 XML 字符串清洗 | `_sanitize_xml` | 79×4 | 本版用结构化 `parseUiXml`，没有脏 XML 需要清洗 |
| 子进程事件上报 | `emit` | 204 | 本版用 `RunStore` 事件流 |
| 配置单文件读写 | `load_login_config` / `save_login_config` | 39 | 本版拆成 `device-sources.json` / `llm-config.json` |
| 卡密授权体系 | `verify_card` / `normalize_card_key` / `is_valid_card_prefix` / `_safe_run_cmd` | 20+ | 本版未做授权校验 |
| 设备指纹采集（授权用） | `get_device_fingerprint` / `get_hardware_signature` / `get_cpu_info` / `get_board_info` | 21 | 同上，授权体系专用 |
| 打包资源解压 | `extract_resource_to_exedir` | 10 | 本版用 electron-builder `extraResources` |
| UI dump 落盘 | `save_ui_dump` | 14 | 本版事件流里已带 dump 产物 |
| Windows AppID | `init_windows_app_identity` | 1 | Electron 自带 |
| CLI 入口 | `do_diff` / `do_pull` / `do_scan` / `print_usage` | 4 | 本版无 CLI |
| 子进程 worker 入口 | `run_job` | 6 | 本版直接跑 FlowRunner |
| 日志目录 | `logs_base_dir` | 1 | 本版用 `APPDATA/myt-desktop/` |

#### B. 已实现但名字不同（约 18 个）

| 旧函数 | 次数 | 本版对应 |
|---|---|---|
| `get_verify_login_button_position` | 42 | `getVerifyLoginButtonInfo` |
| `launch_rednote_app` | 52 | `device.launchApp(serial, XHS_PACKAGE)` |
| `press_back` | 16 | `device.back(serial)` |
| `_is_selected_or_checked` | 7 | 内联 `isSelectedOrChecked` |
| `encode_kv_pair` / `encode_mmkv_*` | 18 | `kvPair` / `encodeBool` / `encodeStringValue` |
| `_parse_bounds_rect` | 4 | `parseBounds`（device-adb 内部） |
| `_resolve_apk_path` | 10 | `config.adbKeyboardApk` |
| `get_safety_verification_image_positions` | 3 | `findSafetyVerificationGridCells` |
| `solve_safety_verification_from_image_bytes` | 2 | `solveSafetyVerification` |

#### C. 真缺口（1 个，已补）

| 旧函数 | 次数 | 处置 |
|---|---|---|
| `adb_disconnect` | 4 | **本次补 `DeviceControl.disconnect()`** |

#### 补的是什么

旧 `adb_connect`：

```python
def adb_connect(ip_param):
    adb_client.disconnect(ip_param)      # ← 先断开
    adb_client.connect(ip_param)
    HumanLikeOperator.random_delay(1, 2) # ← 再等 1-2s
```

本版 `connect` 只做了 connect。缺 disconnect 的后果：
设备重启/换机型后残留陈旧 socket，**只 connect 可能连上但状态是 offline**。

已改为：

```ts
async connect(serial) {
  await this.disconnect(serial)                 // 先断
  ...run connect...
  await sleep(1000 + Math.random() * 1000)      // 再等 1-2s
}
```

`disconnect` 失败不抛（设备本来没连时 adb 会报 not found，旧版同样忽略）。

#### D. 死代码（8 个，不移植）

| 函数 | 判定依据 |
|---|---|
| `fetch_url_content` | 仅测试文件调用（§11.20 已记录） |
| `get_container_list` / `get_running_containers` | `myt_sdk_v2.py` 内部辅助，本版 `listContainers` 直接给结构化结果 |
| `navigate_to_profile` / `open_settings` | 被 `openDeepLink` 统一替代 |
| `open_following_list` | 关注流程内联 |
| `paste_text` | 本版 `typeText` 直接输入 |
| `solve_captcha_grid` | 被 `solveSafetyVerification` 覆盖 |

#### 验证

改动后真机回归：

```
run: xhs.device.following-comments | succeeded
note: 已处理 3 轮
```

`disconnect` + 延迟没有破坏既有流程。

### 11.22 HeroSMS 端到端补齐（2026-10-24 15:39）

上一版说「HeroSMS 已接入」**只对了一半**——后端通了，UI 没通。

#### 逐层核对结果

| 层 | 之前 | 现在 |
|---|---|---|
| `HeroSmsClient.getNumber` | ✅ 7 参数全支持 | 不变 |
| `loginWithHeroSms` 编排 | ✅ 取号/去区号/2次/置3/置6 | 不变 |
| kernel `executeChain` 调用 | ✅ provider==='herosms' 分支 | 不变 |
| 取码用 activationId | ✅ flowParams 传递 | 不变 |
| **UI 传 heroSms 配置** | ❌ **从未生成这两个参数** | ✅ 本轮补 |
| **价格选择 → maxPrice** | ❌ 表格只渲染不可点 | ✅ 本轮补 |
| **区号来源** | ❌ 错用 `country.dialCode` | ✅ 本轮改为手填 |
| **前置校验** | ⚠️ 只查 2 项（应 4 项） | ✅ 本轮补 |

#### 1. UI 传参与旧 `_herosms_job_snapshot` 对齐

旧版 5 个字段：

```python
{"provider": "herosms", "api_key": ..., "country_id": ..., 
 "country_code": ..., "max_price": ...}
```

本版 UI：

```ts
smsProvider: $('impHeroEnabled').checked ? 'herosms' : 'legacy',
heroSms: $('impHeroEnabled').checked ? {
  apiKey: $('impHeroApiKey').value.trim(),
  countryId: Number($('impHeroCountry').value) || 0,
  countryCode: $('impHeroCountryCode').value.trim() || '+86',
  maxPrice: Number(state.heroMaxPrice ?? 0) || 0,
} : undefined,
```

#### 2. 价格行可选（旧 `_on_herosms_price_changed`）

旧版点价格表一行确定 `max_price`，并把标签更新为：

```
项目：qf | 国家：{chn} | 价格 {cost} | 库存 {count} | 实体 {physical_count}
```

本版补上：行加 `data-price-idx` + 点击高亮 + 写 `state.heroMaxPrice`。
获取价格后重置 `heroMaxPrice = null`（旧版 `_fetch_herosms_prices` 同样先清空）。

#### 3. 区号是手填，不是自动带出

关键纠错：`herosms_country_code` 在旧代码里来自**用户配置输入**
（`LoginSettingsDialog` 的 `values.get("herosms_country_code")`），
**不是**从国家列表取。

而 HeroSMS 的 `getCountries` 返回结构里本来就没有区号字段：

```json
{"id": 3, "rus": "Китай", "eng": "China", "chn": "中国",
 "visible": 1, "retry": 1, "rent": 0}
```

所以本版加了独立输入框 `impHeroCountryCode`（placeholder `+86`），
选中国家**不会**自动填区号——与旧行为一致。

#### 4. 前置校验补到四项

旧版：

```python
if not herosms_api_key or herosms_country_id is None \
   or not country_code or herosms_max_price is None:
    raise ValueError("HeroSMS API Key、国家、区号和最高价格不能为空")
```

本版之前只查了 `countryCode` 与 `maxPrice` 两项（且文案写「三个参数」），已补齐：

```ts
const missing: string[] = []
if (!Number.isFinite(options.countryId)) missing.push('国家')
if (!options.countryCode) missing.push('区号')
if (!Number.isFinite(options.maxPrice)) missing.push('最高价格')
if (missing.length > 0) {
  throw new Error(`HeroSMS 配置不完整，缺少：${missing.join('、')}`)
}
```

（API Key 由调用方在建 client 时保证，故不在此判断。）

#### 改动清单

| 文件 | 改动 |
|---|---|
| `packages/client/ui/login.html` | 传 `smsProvider`/`heroSms` 四字段 |
| `packages/client/ui/login.html` | 价格行点击 → `state.heroMaxPrice` + 高亮 + 标签 |
| `packages/client/ui/login.html` | 新增区号输入框 `impHeroCountryCode` |
| `packages/flow/flow-xhs/src/herosms-login.ts` | 前置校验 2 项 → 3 项（+ 精确文案） |

#### 仍未验证

真实取号需要**有效 HeroSMS API Key**，当前只有 fake key，
只能验证到「BAD_KEY 正确透传并终止链」这一层（§11.17 已记录）。

### 11.23 三个丢失的业务模块补齐（2026-10-24 16:07）

审计发现这三个模块**完全没移植**（不是「架构差异」能解释的）：

| 旧模块 | 行数 | 本版 |
|---|---|---|
| `xhs_real_state_common.py` + `xhs_weshare_convert.py` + `xhs_miui_backup_convert.py` | 500+231+289 | ❌ 缺失 → 本次补 |
| `xhs_device_context.py` | 259 | ❌ 缺失 → 本次补 |
| `ui_dump.py` | 26 | ❌ 缺失 → 本次补 |

之前只移植了 `restore`（读包），**没有「造包」的那一半**——
备份包转换和设备上下文提取都缺，等于备份功能只能恢复别人给的包，不能自己生成。

#### 1. `bundle.ts`（436 行）

bundle 读写核心：

| 导出 | 旧函数 |
|---|---|
| `BUNDLE_VERSION` / `SUPPORTED_BUNDLE_VERSIONS` | 同名常量 |
| `FILE_GROUPS` / `MODE_GROUPS` / `WEBVIEW_DYNAMIC_SPECS` | 同名常量 |
| `utcNowIso` / `sha256File` | 同名 |
| `bundleDefaultName` | 同名（`{sid}----{user_id}----{did}.zip`） |
| `iterBundleGroups` / `buildBundleEntry` / `inferModeForRemotePath` | 同名 |
| `staticBundleEntriesForGroups` | 同名 |
| `dynamicBundleEntriesForGroups` | 同名（设备侧 `ls` 发现 WebView 文件） |
| `bundleEntriesForGroups` / `buildManifest` / `writeBundle` | 同名 |

**ZIP 写入是自己实现的**：Node 无内置 zip 写入，项目也没装 zip 库。
用 store 模式（不压缩）手写 ZIP 结构——bundle 里多是已压缩的 MMKV，
压缩收益极小，且避免引第三方依赖。

实测用 Python `zipfile` 校验：

```
zip 校验: OK
条目: ['manifest.json', 'files/mmkv/login_user_info_kv']
manifest 可解析: True
```

#### 2. `bundle-convert.ts`（500 行）

两种第三方备份格式 → bundle：

| 格式 | 结构 | 关键点 |
|---|---|---|
| WeShare | 目录或 `{pkg}.tar.bak` | app 根目录有两种候选（`data/user/0/` 与 `data/data/`） |
| MIUI | `*({pkg}).bak` | **前缀有 header，需扫偏移找内嵌 tar** |

MIUI 的偏移定位：旧版逐字节试 `tarfile.open`；本版用 tar 魔数
（偏移 +257 处是 `ustar`）快速判断。

实测（构造真实 WeShare 包）：

```
mode: core
extracted: 4 | missing: 0
manifest files: com.xingin.xhs:true, com.xingin.xhs.crc:true,
                login_user_info_kv:true, login_user_info_kv.crc:true
```

**踩到的坑**：`tar.x` 解到 `stagingDir` 时保留原路径
（`data/data/<pkg>/files/mmkv/...`），但 bundle 要的是 `files/{entry.path}`。
少了「搬迁」这一步导致 `extracted: 0 / missing: 4`。

#### 3. `device-context.ts`（300 行）

从 MMKV 抠 13 个身份字段。**5 项正则与旧 Python 逐字段对拍一致**：

| 输入 | 旧 Python | 本版 |
|---|---|---|
| `login_user_session_num_key session.1234 login_user_id_key <hex>` | `('1234', '<hex>')` | `{sid:'1234', userId:'<hex>'}` ✅ |
| `"isRealLogin":true "sessionId":"session.999" "userId":"<hex>"` | `('999', '<hex>', True)` | 同 ✅ |
| `"secure_session":"SEC" "user_token":"UT" "idToken":"IT" xsec_token\u003dXT` | `('SEC','UT','IT','XT')` | 同 ✅ |
| `current_did <32hex>\nlast_did <32hex>\ncurrent_did_source LOCAL_DEVICE` | 4 元组 | 同 ✅ |
| `loc_device_id 36b8f8e2-...` | 该 UUID | 同 ✅ |

注意 `extractLoginInfoFromText` 在「我生成的 MMKV」上会抛错——
**旧 Python 同样抛错**（`login_user_info_kv` 是单 blob，不含那些 key）。
这是旧行为，不是迁移缺陷。

#### 4. `tabs/ui-dump.ts`（57 行）

UI XML 落盘，`{serial}_{tag}_{YYYYMMDD_HHMMSS}.xml`。失败返回 null 不抛。

#### 真机回归

```
run: xhs.device.following-comments | succeeded
note: 已处理 3 轮
```

新增 1289 行代码没有破坏既有流程。

#### 依赖变更

`packages/flow/flow-xhs` 新增 `tar@^7.4.3`——读取 `.tar.bak` / MIUI 内嵌 tar 必需。

### 11.24 补 UI 接线：UI dump + 备份包自动转换（2026-10-24 16:21）

上一轮把三个模块做成了纯库，没有接 UI——这违背「全部复刻」要求，本轮补齐。

#### 1. 抓取界面XML → 落盘（`xhs.ui.dump`）

旧实现 `device_tab.UiDumpWorker`（`device_tab.py:140-190`）：

| 步骤 | 旧行为 | 本版 |
|---|---|---|
| 抓 UI XML | `adb_client.device(serial).ui_xml()` | `ctx.snapshot({refresh:true})` |
| 空内容 | 报 `dump 返回空内容` | 同 |
| 落盘 | `save_ui_dump(serial, xml, "manual")` | 同名逻辑，路径 `logs/ui_dump/` |
| 写失败 | 报 `写文件失败` | 同 |
| 额外输出 | `_first_package_name(xml)` 报前台包名 | 同 |

**关键修正**：原来 `ui-dump` 动作映射到 `xhs.probe`，而 probe 只 dump 不落盘。
现已改为专用流程 `xhs.ui.dump`。

#### 2. `UiNode` 缺 `package` 字段（真实缺陷）

`_first_package_name` 依赖 XML 的 `package` 属性，但本版 `parseUiXml`
**只解析了 class/text/resource-id/checked/clickable/enabled**，没有 package。

已补：
- `UiNode.packageName` 字段
- 解析器读 `attr('package')`
- dump 序列化输出 `package="..."`

实测（当时设备停在机型工具页）：

```
note: 已保存 ...\logs\ui_dump\192.168.0.113_5002_manual_20261024_162034.xml；前台包名 com.blue.backup
```

#### 3. 备份包恢复支持任意格式（自动转换）

旧 `gui_device_worker.py:458-480`：

```python
bundle_path = source_value
if lower.endswith(".zip"):
    if not os.path.exists(bundle_path): fail("备份包不存在")
else:
    bundle_path = convert_package(source_value, mode)   # ← .bak/.tar.bak/目录
```

本版 `restoreStateFlow` 原来**只接受已解压目录**，现在补齐转换链：

| 输入 | 行为 |
|---|---|
| `*.zip` | 解压到临时目录再恢复 |
| `*.bak`（MIUI） | `convertPackage` → zip → 解压 → 恢复 |
| `*.tar.bak`（WeShare） | 同上 |
| 含 `manifest.json` 的目录 | 直接恢复（跳过转换） |

UI 文案同步改为「备份源（.zip 直接用；.bak / .tar.bak / 目录 会自动转换）」。

#### 4. 不新增按钮（与旧版一致）

核查旧版：**没有独立的「转换备份包」按钮**，转换只在备份包登录/恢复时自动触发。
所以本版也不加，避免引入旧版没有的 UI。

#### 验证

| 项 | 结果 |
|---|---|
| 流程总数 | 16（新增 `xhs.ui.dump`） |
| UI dump 真机 | ✅ succeeded，文件 9210 字节 |
| 前台包名识别 | ✅ `com.blue.backup` |
| `tar` 依赖 | `packages/flow/flow-xhs` 新增 `tar@^7.4.3` |

### 11.25 `xhs.probe` 保留并补入口（2026-10-24 16:27）

`xhs.probe` 是**本版新增**（旧版无此功能），早期为验证「dump → 定位 → 点击 → 断言」
这条原语链而写。用户确认保留。

#### 补的是什么

之前 `ui-dump` 动作曾映射到 `xhs.probe`，改指向 `xhs.ui.dump` 后，
`xhs.probe` 就没有任何 UI 入口——流程存在但调不到。

已补：
- `SINGLE_TASKS` 加 `{ id: 'probe', label: '设备就绪探测（回主页+断言）' }`
- `ACTION_FLOWS` 加 `probe: 'xhs.probe'`
- kernel batch 动作联合类型加 `'probe'`
- 前端 `SINGLE_ACTION` 加 `probe: 'probe'`

#### 单项任务清单（10 项）

| id | 标签 | 来源 |
|---|---|---|
| `set-proxy` | 设置代理 | 旧版（未实现，需代理池 UI 完整流程） |
| `reset-device` | 一键新机 | 旧版 |
| `modify-profile` | 设置头像昵称 | 旧版 |
| `follow-user` | 关注账号 | 旧版 |
| `bind-phone` | 绑定账号 | 旧版 |
| `sid-extract` | 提取 SID（读登录态） | 本版补 |
| `sid-login` | SID 上号（写登录态） | 本版补 |
| `restore-state` | 恢复备份包 | 本版补 |
| `ui-dump` | 抓取界面XML | 旧版（本版改为专用流程） |
| **`probe`** | **设备就绪探测（回主页+断言）** | **本版新增** |

#### 验证

真机跑 `xhs.probe`：

```
run: xhs.probe | succeeded
> 抓取当前界面
> 通过深链回到主页
> 确认已在小红书主界面
```

三步全过。

#### 遗留

`set-proxy` 仍显示「尚未实现」——旧版走 `BatchActionType.SET_PROXY`（dispatcher job），
本版 `setS5Proxy` 已在 SDK 层实现，但**单项任务入口还没接**（只在登录链的
`set-proxy` 前置动作里用）。这是下一个待补项。

### 11.26 补齐 set-proxy / reset-device 单项入口（2026-10-24 16:38）

#### 1. `set-proxy`（旧 `BatchActionType.SET_PROXY`）

旧实现 `gui_device_worker.py:205-236`：

```python
if action == BatchActionType.SET_PROXY:
    proxy_ip / proxy_port / proxy_username / proxy_password
    proxy_device_ip / proxy_api_port            # ← 六个参数
    if not proxy_ip or not proxy_device_ip: fail("代理参数不完整")
    api_port = int(proxy_api_port or "10008")
    result = set_s5_proxy(device_ip=..., api_port=..., proxy_ip=...,
                          proxy_port=int(proxy_port or "1080"), ...)
    if result["code"] in (0, 200): succeeded
```

本版：内核侧注册 `xhs.device.set-proxy` 工厂（**不走 flow 包**，因为
`StepContext` 没有 `mytHost`，而代理是纯宿主 API 调用）。

参数经 `flowParams` 传入：`proxyIp` / `proxyPort` / `proxyUsername` /
`proxyPassword` / `deviceIp` / `apiPort`（默认 10008，与旧版一致）。

实测（缺参数）：

```
set-proxy -> HTTP 502 {"error":"代理参数不完整"}
```

与旧版 `invalid_proxy_params` 语义一致。

#### 2. `reset-device` 映射

`ACTION_FLOWS` 原来漏了 `reset-device`，点它显示「尚未实现」。
现已映射到 `xhs.device.one-click-new`（旧版 `RESET_DEVICE` → `One_click_new_device`）。

实测：

```
reset-device -> accepted
run: xhs.device.one-click-new | failed
FAIL: 一键新机失败: 超时或 UI 节点未找到
```

**路由正确**；失败是因为 5002 没装小红书（`pm path com.xingin.xhs` 为空），
与 §11.14 记录的旧代码前提完全一致——不是路由或移植问题。

#### 3. 单项任务参数收集

前端补了两段 `prompt` 链：

| 任务 | 收集的参数 |
|---|---|
| `set-proxy` | proxyIp / proxyPort(1080) / proxyUsername / proxyPassword / deviceIp / apiPort(10008) |
| `reset-device` | resetDeviceMode（random/specified）、brand+model（specified 时）、overseasRandom |

同时把 `restore-state` 的字段名从 `bundleDir` 改为 `source`（支持任意格式）。

#### 流程总数

**17 个**（新增 `xhs.device.set-proxy`）。

### 11.27 UI 按钮全量扫描 + 补两个导出（2026-10-24 16:47）

#### 扫描方法

```python
ids = re.findall(r'<button[^>]*\bid="([^"]+)"', html)          # 所有按钮
wired = set(re.findall(r"\$\('([^']+)'\)\.addEventListener", html))  # 已绑定
```

扫描结果：

| 项 | 数量 |
|---|---|
| 按钮总数 | 35 |
| 已绑定事件 | 33 |
| **未绑定** | **2**（`impExportFailed`、`impBindExport`） |

补完后：**35 / 35 全部接线**。

#### 1. 导出失败账号（旧 `export_failed_accounts`）

旧逻辑（`device_tab.py:1836-1849`）：

```python
failed = [a for a in imported if a.status_text.strip() == "失败" and a.phone and a.url]
if not failed: 提示「当前没有可导出的失败账号」
lines = [f"{a.phone}----{a.url}" for a in failed]
Path(file_path).write_text("\n".join(lines) + "\n")
```

本版：筛选 + `downloadText()`（浏览器下载，等价 `QFileDialog` + `write_text`）。

#### 2. 导出未成功绑定账号（旧 `export_bind_accounts`）

旧逻辑（`device_tab.py:2089-2103`）：筛选 `status != "成功"`，无则提示「所有账号均已成功，无需导出」。

#### 3. 顺带修的两个数据缺陷

**缺陷 A：账号导入没拆 phone/url**

之前 `state.imported` 只有 `{value, status}`，导出功能拿不到 `phone`/`url` 字段。

旧 `parse_account_line`（`device_tab.py:1715-1737`）的真实规则：

| 规则 | 说明 |
|---|---|
| 前缀 | `成功--` / `失败--` 可选 |
| 分割 | 按 `----` 拆，至少 2 段 |
| phone | 去掉所有空白 |
| url | 第 2 段 |
| status | 无前缀时取第 3 段及之后（`"----".join(parts[2:])`） |
| 校验 | phone 或 url 为空 → 返回 None（整行丢弃） |

已按此实现 `parseAccountLine()`。

**缺陷 B：账号信息列显示格式**

旧 `account_info()`：

```python
if not self.phone and self.url: return Path(self.url).name   # 备份包只显示文件名
return f"{self.phone}--{self.url}"                            # 注意是双横线
```

之前直接显示原始 `value`（四横线 `----`）。已改为 `accountInfo()` 双横线格式。

#### 实测

**账号导入（带前缀）：**

```
输入: 失败--13800138000----https://a.com/1
      成功--13900139000----https://a.com/2

渲染: ["1", "13800138000--https://a.com/1", "失败"]
      ["2", "13900139000--https://a.com/2", "成功"]
```

**导出失败账号**：`已导出 1 条失败账号`（只含失败那条）✅

**绑定账号导入 + 导出**：

```
渲染: ["1","13800138000","https://a.com/1","待绑定"]
      ["2","13900139000","https://a.com/2","待绑定"]
导出: 已导出 2 条账号
```

### 11.28 批导入配置持久化（2026-10-24 16:58）

#### 问题

「保存」按钮之前只写 `state.logs`，**数据全在内存**——刷新页面即丢。

旧版不存在这个问题：所有状态都在 `self.*`（Python 实例属性），
`AccountImportDialog.values()` 一返回就赋给主窗口，生命周期与窗口一致。

#### 旧版保存的 20 个字段

`device_tab.py:3745-3795`（`values()` 的消费方）：

| 分组 | 字段 |
|---|---|
| 账号 | `area_code` / `accounts` / `file_path` / `import_mode` |
| 头像 | `avatars` |
| 昵称 | `nicknames` / `nickname_file_path` |
| 代理 | `proxies` / `proxy_file_path` / `proxy_machine` / `proxy_ip_count` |
| 新机 | `reset_device_mode` / `reset_device_overseas_random` / `reset_device_brand_models` |
| 关注 | `follow_user_ids` / `follow_count` |
| 绑定 | `bind_accounts` / `bind_account_file_path` |
| HeroSMS | `herosms_enabled` / `herosms_api_key` / `herosms_country_id` / `herosms_country_code` / `herosms_max_price` |

旧版还有三个副作用：`_sync_all_accounts_to_file()` / `_sync_nickname_txt()` /
`_sync_proxy_txt()`——把账号/昵称/代理**回写到原始 txt**。本版暂不做（见「遗留」）。

#### 实现

**新增 `tabs/import-config.ts`**：

| 导出 | 作用 |
|---|---|
| `ImportConfig` | 上述全部字段的 TS 接口 |
| `defaultImportConfig()` | 旧 `AccountImportDialog.__init__` 的默认值（`areaCode='+1'`、`proxyMachine=1`…） |
| `normalizeImportConfig()` | 旧版逐个 `str()/int()/bool()` 的等价校验 |
| `ImportConfigStore` | `import-config.json` 原子读写 |

**新增接口**：

| 方法 | 路径 |
|---|---|
| GET | `/api/tabs/login/import-config` |
| POST | `/api/tabs/login/import-config` |

**前端**：

- 打开「批导入账号」时 `loadImportConfig()` 灌回全部控件与表格
- 「保存」时 `collectImportConfig()` 收集 20 字段 → POST
- 保存后打统计日志（账号/头像/昵称/代理/模式/区号），与旧版 `self.log(...)` 文案一致

**`/batch-login` 也从持久化配置取数**：

```ts
const savedImport = await importConfigStore.load()
// smsProvider：UI 传值优先，未传时看 savedImport.heroSmsEnabled
// heroSms：opts.heroSms ?? 从 savedImport 拼
```

#### 实测

**保存后文件**（`%APPDATA%/myt-desktop/import-config.json`，1227 字节）：

```
importMode: sms | areaCode: +1
accounts: 2 | 第一条: 13800138000 失败
nicknames: 2 | 第一个: {'value': '昵称A', 'status': '待使用'}
followUserIds: ['49314148071', '49314148072'] | followCount: 5
proxyMachine: 3 | proxyIpCount: 24
```

**刷新页面后重新打开弹窗**：

```
accounts:      ["1","13800138000--https://a.com/1","失败"]
               ["2","13900139000--https://a.com/2","成功"]
nicknames:     2
followUsers:   "49314148071\n49314148072"
followCount:   5
proxyMachines: 3 | proxyIpCount: 24
fileHint:      已导入 2 条
```

全部字段完整回填，包括账号的 `成功/失败` 状态。

#### 遗留

| 项 | 说明 |
|---|---|
| `_sync_all_accounts_to_file` | 旧版把状态回写原始 txt（`失败--xxx` 前缀）；本版只在 json 里存，不回写源文件 |
| `_sync_nickname_txt` / `_sync_proxy_txt` | 同上 |
| `nicknameFilePath` / `proxyFilePath` / `filePath` | UI 没有文件选择器（浏览器限制），恒为空串 |

### 11.29 源文件回写（三个 sync 副作用）（2026-10-24 17:06）

上一轮遗留的第 1 项已补：旧版保存时会把状态回写到原始 txt。

#### 旧版三个副作用

| 函数 | 行为 |
|---|---|
| `_sync_all_accounts_to_file` | 按 `source_line_index` 替换行，追加 `----{status}` |
| `_sync_nickname_txt` | 已使用加 `已使用--` 前缀；**不再使用的去掉前缀** |
| `_sync_proxy_txt` | 有 status 写 `{status}--{body}`；无 status 只写 body |

#### 关键常量与规则

旧 `_WRITEABLE_STATUSES = {"成功", "失败", "绑定失败", "之前已绑定"}`
旧 `PREFIX = "已使用--"`

`_format_account_source_line`：

```python
base_line = account.source_line_text.strip() or account.account_info()
if status in WRITEABLE_STATUSES or status.startswith("绑定成功----"):
    return f"{base_line}----{status}"
return base_line
```

**注意**：只有这四类状态才写回；`待导入` 等保持原行不变。

#### bundle 模式的特殊行为

`sync_imported_account_status_to_file` 对 `bundle` 模式**不写 txt，而是重命名 zip**：

```python
suffix = "----绑定成功----{phone}" if 绑定成功 else f"----{status}"
path.rename(f"{base_name}{suffix}.zip")
account.url = str(target_path)      # 同步更新内存里的 url
```

已复刻（`syncAccountStatusToFile` 里 `url.endsWith('.zip')` 分支）。

#### 实现

`tabs/import-config.ts` 新增 5 个导出：

| 函数 | 旧对应 |
|---|---|
| `formatAccountSourceLine` | `_format_account_source_line` |
| `syncAccountStatusToFile` | `sync_imported_account_status_to_file` |
| `syncAllAccountsToFile` | `_sync_all_accounts_to_file` |
| `syncNicknameTxt` | `_sync_nickname_txt` |
| `syncProxyTxt` | `_sync_proxy_txt` |

保留旧版细节：
- 行尾换行保留（`text.endsWith('\n')` 判断）
- 空行保留
- 异常静默（旧版 `except OSError: pass`）

#### UI 补四个路径输入

回写需要知道源文件，之前 `filePath` / `nicknameFilePath` / `proxyFilePath` /
`bindAccountFilePath` 恒为空串，回写永远不会触发。

四个页签各加一行「源文件路径」输入框。

#### 实测（真实文件）

**账号 txt**

```
输入: 13800138000----https://a.com/1        （状态 失败）
      13900139000----https://a.com/2        （状态 成功）
输出: 13800138000----https://a.com/1----失败
      13900139000----https://a.com/2----成功
```

**昵称 txt**

```
输入: 昵称A / 昵称B / 已使用--昵称C        （A 已使用，C 不再使用）
输出: 已使用--昵称A                        ← 加前缀
      昵称B                                ← 未使用保持
      昵称C                                ← 旧前缀去掉
```

**代理 txt**

```
输入: 1.1.1.1:1080:u:p（状态 已使用(1)） / 2.2.2.2:1080:u:p（无状态）
输出: 已使用(1)--1.1.1.1:1080:u:p
      2.2.2.2:1080:u:p
```

接口返回 `synced: {"accounts": true, "nicknames": true, "proxies": true}`。

### 11.30 绑定账号分配与状态回写（2026-10-24 20:57）

上一轮遗留：`bindAccounts` 存了但**从没被任务用过**——没有「取一条」和「写回状态」的链路。

#### 旧版行为

| 动作 | 旧实现 | 位置 |
|---|---|---|
| 取一条未使用 | `find_imported_bind_account_by_index(bind_idx)`，判据 `is_unused()` = `not status_text and active_job_id is None` | `device_tab.py` |
| 写回成功 | `bind_account.status_text = "成功"` → `_sync_bind_account_status_to_file` | 4837 / 4858 / 5956 / 6372 / 6799 |
| 写回已绑定 | `status_text = ""`（**清空，账号可复用**） | 4834 |

#### 实现

**`tabs/import-config.ts` 新增**

| 导出 | 作用 |
|---|---|
| `pickUnusedBindAccount(config)` | 找第一条 `statusText` 空且未分配的 |
| `updateBindAccountStatus(store, index, status, serial)` | 写状态 + 回写源 txt |

**新增接口**

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/tabs/login/bind-account/next` | 取一条未使用（返回 index + phone/url + unused 计数） |
| POST | `/api/tabs/login/bind-account/result` | 写终态（`alreadyBound` → 清空） |

**链内自动分配**：`runChainStep` 的 `bind-phone` 分支优先用设备登录源；
没有则从绑定账号池取，并记下 `chain.bindAccountIndex` / `bindAccountSerial`。

**任务结束回写**：`runChainStep` 在 `bind-phone` 完成后按结果写状态：
- 成功 → `成功`
- 失败（视为 `already_bound`）→ 清空

回写失败不阻断链（旧版同样只 log）。

#### 实测

**分配**

```
save: True
next: {"index": 0, "account": {"phone": "13800138000", ...}, "total": 2, "unused": 2}
```

**标记成功后再取**

```
result: {'ok': True, 'statusText': '成功'}
next:   {"index": 1, ..., "unused": 1}     ← 第 0 条已被排除
```

**标记「已绑定」**

```
result(alreadyBound): {'ok': True, 'statusText': ''}   ← 清空，可复用
```

**源 txt**

```
输入: 13800138000----https://a.com/1
      13900139000----https://a.com/2

输出: 13800138000----https://a.com/1----成功
      13900139000----https://a.com/2            ← 未处理，保持原样
```

#### 现在三个 txt 全部接通

| txt | 回写时机 | 状态 |
|---|---|---|
| 账号 txt | 保存时（`syncAllAccountsToFile`） | ✅ |
| 昵称 txt | 保存时（`syncNicknameTxt`） | ✅ |
| 代理 txt | 保存时（`syncProxyTxt`） | ✅ |
| 绑定 txt | 任务结束时（`updateBindAccountStatus`） | ✅ 本轮补 |

### 11.31 flow-xhs 分目录 + 插拔性评估（2026-10-29 13:38）

#### 分目录结果

`packages/flow/flow-xhs/src/` 从平铺 24 文件改为 4 个子目录 + 根 index：

```
src/
├── index.ts              [513]  对外导出 + probe/uiDump 流程
├── flows/                5 个   流程定义
│   ├── alt-login-flows.ts    [265]  OP / V跳
│   ├── device-flows.ts       [615]  改资料/关注/绑定/仅关注可评论
│   ├── one-click-new.ts      [434]  一键新机
│   ├── sid-flows.ts          [307]  SID 提取/上号/清除
│   └── state-restore.ts      [286]  备份包恢复
├── locators/             7 个   定位器
│   ├── locators.ts           [250]  登录页
│   ├── state-locators.ts     [308]  状态/区号列表
│   ├── guide-locators.ts     [243]  引导/安全验证/生日
│   ├── profile-locators.ts   [139]  资料页
│   ├── follow-locators.ts    [69]   关注按钮
│   ├── bind-phone-locators.ts[105]  绑定手机号
│   └── paths.ts              [39]   路径工具
├── steps/                5 个   步骤复用
│   ├── login-steps.ts        [431]
│   ├── verification.ts       [252]  取码 + 安全验证
│   ├── actions.ts            [120]
│   ├── birthday.ts           [111]
│   └── dialogs.ts            [78]
└── data/                 6 个   数据/协议
    ├── mmkv.ts               [321]  MMKV 生成 + 解析
    ├── bundle.ts             [424]  bundle 读写 + 手写 ZIP
    ├── bundle-convert.ts     [480]  WeShare/MIUI 转换
    ├── device-context.ts     [326]  设备上下文
    ├── herosms.ts            [531]  HeroSMS 客户端
    └── herosms-login.ts      [150]  HeroSMS 登录编排
```

导入路径全部重写：根文件 `./steps/xx.ts`，子目录内 `../locators/xx.ts`。
`tsc --noEmit` 通过，17 个流程注册正常。

---

## 插拔性评估：**部分可插拔，不是整体可插拔**

### 好消息：依赖方向是干净的

`flow-xhs/package.json` 只依赖：

```json
"@myt/device", "@myt/flow", "@myt/locator", "@myt/runs", "@myt/human", "tar"
```

| 检查 | 结果 |
|---|---|
| 是否导入 `@myt/kernel` | ❌ 无（无反向依赖） |
| 是否导入 `@myt/myt-host` | ❌ 无（流程不碰宿主 API） |
| 是否导入 `electron` / `node-http` | ❌ 无（纯逻辑） |

**这意味着 `flow-xhs` 本身可以整体替换**：换成 `flow-douyin` 只需要实现同样的
`FlowDefinition[]`。

### 坏消息：kernel 硬编码了 12 处小红书知识

```ts
// kernel.ts
164: ctx.flows.registerFactory('xhs.login.phone-prep', ...)
209: 'xhs.device.modify-profile'
220: 'xhs.device.follow'
234: 'xhs.device.set-proxy'
269: 'xhs.sid.login'
284: 'xhs.device.one-click-new'
302: 'xhs.device.bind-phone'
388/927/1555: flowId.startsWith('xhs.login') ? 'yadb' : 'uiautomator'
1367: ACTION_FLOW_ID['reset-device'] ?? 'xhs.device.one-click-new'
```

具体耦合点：

| 耦合 | 位置 | 后果 |
|---|---|---|
| **流程注册** | kernel 里 7 个 `registerFactory` | 新增业务要改 kernel |
| **UI 通道判定** | `flowId.startsWith('xhs.login')` | 小红书登录用 yadb，其它用 uiautomator——这是业务知识 |
| **动作映射表** | `login-tab.ts` 的 `ACTION_FLOWS` | 21 个 xhs 动作 id |
| **链式编排** | `login-chain.ts` 的 `ACTION_FLOW_ID` | 7 个动作 → 流程 id |
| **入参收集** | `login.html` 里 `SINGLE_ACTION` / `prompt` 链 | UI 直接写死小红书参数 |

### 结论表

| 层 | 可插拔性 | 说明 |
|---|---|---|
| `myt-host` → `myt-api-v2/v3` | ✅ **完全可插拔** | Service 契约 + 两个 Provider |
| `device` → `device-adb` | ✅ **完全可插拔** | 同上 |
| `core/flow` · `core/runs` | ✅ **完全通用** | 不含任何业务知识 |
| **`flow-xhs`** | ⚠️ **自身干净，但注册被写死** | 换掉包后 kernel 不改就调不到 |
| `kernel` + `ui` | ❌ **完全绑定小红书** | 12 处硬编码 + 21 个动作 id |

### 要真正「整体插拔」，需要三步

| 步骤 | 内容 |
|---|---|
| 1 | 抽 `FlowPack` 契约：`interface FlowPack { id: string; register(ctx, flows): void }` |
| 2 | `flow-xhs` 导出 `xhsPack`，kernel 只 `ctx.plugin(xhsPack)`，不写具体 id |
| 3 | `uiChannel` 判定移到 `FlowDefinition` 上（每个流程自报需要哪个通道） |

工作量估计：kernel 减 12 处硬编码 + UI 动作表改成配置驱动，约 300-400 行改动。

**要做吗？** 做完之后加「抖音」业务 = 新增一个 `flow-douyin` 包 + 一行 `ctx.plugin()`。

### 11.32 FlowPack 插拔改造（2026-10-29 13:46）

#### 改造成果

| 指标 | 改造前 | 改造后 |
|---|---|---|
| kernel 里 `xhs.*` 硬编码 | **12 处** | **0 处** |
| kernel 里 `registerFactory` | 7 处 | 0 处 |
| 新增业务所需改动 | 改 kernel + UI | 新增一个包 + 一行 `register` |
| `uiChannel` 判定 | 内核 `startsWith('xhs.login')` | 流程自报 |

#### 三步落地

**1. 契约层**（`packages/core/flow/src/index.ts`）

```ts
export interface FlowDefinition {
  id: string
  title: string
  steps: StepDefinition[]
  uiChannel?: 'uiautomator' | 'yadb'   // 新增：流程自报抓 UI 通道
}

export interface FlowPack {
  id: string
  title: string
  register(flows: FlowRegistry, capabilities: FlowPackCapabilities): void
}

export interface FlowPackCapabilities {
  solveSafety?: (image: Buffer, params: Record<string, string>) => Promise<number>
  host?: {
    setS5Proxy(options: {...}): Promise<boolean>
  }
}
```

**2. 业务包实现**

| 包 | 文件 | 承载 |
|---|---|---|
| `flow-xhs` | `src/pack.ts` | `xhsPack`：15 个流程（5 无参 + 3 登录 + 7 工厂） |
| `flow-xhs-device` | `src/pack.ts` | `xhsDevicePack`：清数据 + 备份 |

两个包都加 subpath 导出：

```json
"exports": { ".": "./src/index.ts", "./pack": "./src/pack.ts" }
```

**为什么要 subpath**：`pack.ts` 依赖 `index.ts`（取 `createPhoneLoginPrepFlow`、`uiDumpFlow`），
若从 `.` 桶文件再导出 `pack`，形成循环。用 `@myt/flow-xhs/pack` 直接寻址，避开这个环。

**3. 内核只 load 包**（`kernel.ts`）

```ts
// 业务包：内核只 load 包，不认识任何具体流程 id。
xhsDevicePack.register(ctx.flows, {})
xhsPack.register(ctx.flows, {
  // 识图：内核知道 LLM 配置来源，包只管传图。
  solveSafety: async (image: Buffer, params: Record<string, string>) => {
    const llm = await loadLlmConfig(llmConfigFile)
    return solveSafetyVerification({
      baseUrl: String(params['llmBaseUrl'] || llm.baseUrl),
      model: String(params['llmModel'] || llm.model),
      apiKey: String(params['llmApiKey'] || llm.apiKey),
    }, image)
  },
  host: {
    setS5Proxy: (options: Parameters<typeof ctx.mytHost.setS5Proxy>[0]) => ctx.mytHost.setS5Proxy(options),
  },
})
```

kernel.ts 净减 **166 行**。

#### 关键决策：为什么不用 `ctx.plugin()`

Cordis 的 `ctx.plugin()` 要求 `Plugin` 类型（类或函数），`FlowPack` 是普通对象，
且 capabilities 需要内核提前装配好再传。

采用**显式 `pack.register(ctx.flows, caps)`**：

| 方案 | 问题 |
|---|---|
| `ctx.plugin(pack)` | 类型不匹配；capabilities 无处注入 |
| `pack.register(registry, caps)` | ✅ 类型清晰，能力显式，顺序可控 |

代价：**没有 Cordis 的自动依赖追踪与热卸载**。当前需求不需要，若将来要热插拔，
把 `FlowPack` 改成返回 `Plugin` 的工厂函数即可，接口形状不变。

#### 降噪明细

| 原 kernel 代码 | 处置 |
|---|---|
| 13 个 flow-xhs import | 全删 |
| 7 处 `registerFactory`（约 160 行） | 迁入 `pack.ts` |
| `uiChannel: flowId.startsWith('xhs.login') ? 'yadb' : 'uiautomator'` × 3 | 改 `flow.uiChannel ?? 'uiautomator'` |
| `ACTION_FLOW_ID['reset-device'] ?? 'xhs.device.one-click-new'` | 去掉业务兜底，改 `resetFlowId ? resolve : undefined` |
| `backupFlow, clearDataFlow` import | 改 `xhsDevicePack` |

#### 验收

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | ✅ 通过 |
| 流程数 | ✅ 17 个，与改造前一致 |
| 打包启动 | ✅ `MYT.exe` 正常起 |
| 工厂流程构造 | ✅ 7 个全部返回正确 steps |
| `uiChannel` 声明 | ✅ `xhs.login.{phone-prep,op,vjump}` 均为 `yadb` |
| 真机跑流程 | ❌ 未做：SDK（7878）离线 |

#### 回归教训

首次替换注册段时**一并删掉了 5 个无参流程**（`probe`/`op`/`vjump`/`clear`/`backup`），
启动后 `/api/flows` 只剩 12 个才暴露。

记录原因：无参流程用 `flows.register()`（无工厂包裹），与 `registerFactory` 混排，
删段时容易漏掉。**后续改动注册段，必须核对 `/api/flows` 数量**。

#### 加新业务成本对比

```ts
// 之前：改 kernel 7 处 + 改 login-tab ACTION_MAP + 改 login.html
// 之后：
// 1. 新建 packages/flow/flow-douyin
// 2. 写 src/pack.ts 导出 douyinPack
// 3. kernel.ts 加一行：
douyinPack.register(ctx.flows, {})
```

### 11.33 动作配置化：ACTION_FLOWS / SINGLE_TASKS / UI prompt 链全部收编（2026-10-29 14:00）

承接 §11.32 的 `FlowPack` 改造，把最后三处小红书专属硬编码一并配置化。

#### 改造成果

| 指标 | 改造前 | 改造后 |
|---|---|---|
| `ACTION_FLOWS`（动作→流程） | 15 行写死常量 | `buildActionFlows(actions)` 派生 |
| `ACTION_FLOW_ID`（链动作→流程） | 10 行写死常量 | `buildChainFlows(actions)` 派生 |
| `SINGLE_TASKS`（单项任务） | 10 项写死数组 | `buildSingleTasks(actions)` 派生 |
| `/batch` 路由的 action 联合类型 | 11 个字面量 | `string`，查表判定合法性 |
| `login.html` 的 prompt 链 | 12 个 if/else，约 87 行 | `renderActionForm` + `collectActionParams`，约 75 行通用代码 |
| `BatchAction` 类型 | 15 个字面量 | `string` |

#### 契约扩展

```ts
// packages/core/flow/src/index.ts
export interface ActionParam {
  name: string
  label: string
  type: 'text' | 'number' | 'password' | 'textarea' | 'select' | 'confirm'
  options?: Array<{ value: string; label: string }>
  defaultValue?: string
  required?: boolean
  hint?: string
}

export interface ActionDefinition {
  id: string
  label: string
  flowId: string          // 空表示由内核直接执行
  params: ActionParam[]
  single?: boolean        // 是否进「单项任务」对话框
  requiresSelection?: boolean
  chainAction?: string    // 对应登录链上哪一步
}

export interface FlowPack {
  id: string
  title: string
  actions?: ActionDefinition[]   // 新增
  register(flows: FlowRegistry, capabilities: FlowPackCapabilities): void
}
```

#### 动作归属

| 包 | 动作数 | 明细 |
|---|---|---|
| `xhsPack` | 13 | 10 个 `single`（改资料/关注/绑定/SID×2/恢复/代理/新机/dump/probe）+ 3 个链用（login/following-comments/one-click-new） |
| `xhsDevicePack` | 2 | clear / backup |

#### 三个派生函数（`login-tab.ts`）

```ts
buildActionFlows(actions)   // { actionId: flowId }
buildChainFlows(actions)    // { chainAction: flowId }
buildSingleTasks(actions)   // [{ id, label }]，只取 single: true
```

`login-chain.ts` 的 `ACTION_FLOW_ID` 换成 `EMPTY_CHAIN_FLOWS`（全空占位），
由内核启动时用 `{ ...EMPTY_CHAIN_FLOWS, ...buildChainFlows(actions) }` 填充。
保留键集合是为了在类型层面保证每个 `ChainAction` 都有位置。

#### UI：通用表单渲染

旧实现每个动作一段 `prompt()` 链：

```js
if (picked === 'modify-profile') {
  const nickname = prompt('输入新昵称');
  if (!nickname) return;
  const avatarPath = prompt('头像本地路径（可留空只改名）') ?? '';
  ...
} else if (picked === 'follow-user') { ... }
// ... 共 12 个分支
```

新实现：

```js
function renderActionForm(params, container)   // 按 type 渲染 input/textarea/select/checkbox
function collectActionParams(params, container) // 读值 + 必填校验
```

两者都挂在 `window` 上——模块作用域内不可测，挂出去后浏览器可直接验证。

对话框变成两步：**下一步**（选动作）→ **确认执行**（填参数）。无参动作跳过第二步。

#### 关键决策：为什么 `chainAction` 而不是复用 `id`

链动作名与 UI 动作 id 并非全等：

| 链动作 | UI 动作 id |
|---|---|
| `set-following-comments` | `following-comments` |
| `follow-user` | `follow-user`（相同） |

若强行用 `id` 匹配会错位。显式声明 `chainAction` 让映射可见、可测。

#### 决策：`BatchAction` 为什么退化成 `string`

原类型是 15 个字面量联合，但它只在两处用：
- `checkBatchAction` 里 4 次 `=== 'login'`
- `/batch` 路由的参数转型

动作集合现在由包决定，内核枚举它就会重新耦合。收窄为 `string`，
配合 `actionFlows[action]` 查表，未知动作返回「尚未实现」错误。

#### 验收

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | ✅ |
| kernel / login-tab / login-chain 的 `xhs.` 计数 | ✅ 均为 0 |
| `/api/flows` | ✅ 17 个 |
| `/api/tabs/login/tasks` | ✅ `singles: 10`，`actions: 15` |
| 表单渲染（浏览器实测） | ✅ 6 个输入，password 类型正确 |
| 默认值 | ✅ `proxyPort=1080`、`apiPort=10008` |
| 必填校验 | ✅ 空 `proxyIp` 返回 null |
| select 选项 | ✅ `random` / `specified` |
| confirm 默认 | ✅ `overseasRandom` 已勾选 |
| 两步按钮状态 | ✅ 初始「下一步」可见、「确认执行」隐藏 |
| 界面 JS 语法 | ✅ vm.SourceTextModule 解析通过 |

#### 中途修复的问题

改成 `window.renderActionForm = function ...` 时，原函数体的收尾 `}` 没同步改成 `};`，
导致 `Unexpected token '}'`。同时旧的 `closeDialog('dlgSingle'); try { ... }` 尾部
没被替换删除，残留 20 行。

用 `node --experimental-vm-modules` + `vm.SourceTextModule` 做语法校验才发现——
**HTML 内联脚本必须单独做语法检查**，`tsc` 不管 `login.html`。

### 11.34 ChainConfig 迁出内核：ChainRecipe 配方化（2026-10-29 14:36）

承接 §11.33，把最后一块业务知识——**登录链的编排顺序**——从内核搬到业务包。

#### 改造前后

| 指标 | 改造前 | 改造后 |
|---|---|---|
| `login-chain.ts` | 291 行，含写死顺序的 `switch` 分支 | 249 行，纯通用解释器 |
| `ChainConfig`（23 字段接口） | 内核持有 | 删除，拆为 `ChainRun.flags` / `ChainRun.data` |
| 链顺序 | `afterLogin()` / `nextPostStep()` 写死 | `ChainRecipe`（包声明） |
| 动作 id 引用 | 内核出现 11 个链动作字面量 | 0 |
| `ACTION_LABEL` | 内核常量表 | `actionLabel(actions, id)`，从包的动作清单取 |
| `EMPTY_CHAIN_FLOWS` | 内核占位表 | 删除，`buildChainFlows` 直接产出 |

#### 新契约（`packages/core/flow/src/index.ts`）

```ts
export interface ChainCondition {
  all?: ChainCondition[]      // 全部满足
  any?: ChainCondition[]      // 任一满足
  not?: ChainCondition        // 取反
  flag?: string               // 运行开关为真（键名 = UI opts 键）
  has?: string                // 运行数据非空
  remaining?: 'loop' | 'retry' // 剩余次数 > 0
  once?: string               // 本次运行中该动作尚未执行
}

export interface ChainStepSpec {
  action: string
  when?: ChainCondition
  params?: Record<string, string>   // 支持 '${nickname}' 取值
}

export interface ChainRecipe {
  before: ChainStepSpec[]                       // 登录前
  afterLogin: ChainStepSpec[]                   // 登录后第一轮
  afterAction?: Record<string, ChainStepSpec[]> // 某动作成功后的续接
  finalize: ChainStepSpec[]                     // 收尾
  loopBackTo?: string                           // 循环回到哪一步
}
```

#### 关键设计决策：条件只引用运行期输入，不设默认值

上一轮讨论里我提出「包声明默认值」，被否掉了，理由是会产生多个事实来源：

```
UI 勾选框  ⊃  DEFAULT_LOGIN_MODE  ⊃  包默认值
```

UI 传 `'false'` 字符串、`DEFAULT_LOGIN_MODE` 说 `false`、包说 `true` —— 到底谁生效？

最终方案：**包只声明「什么条件下跑哪一步」，不声明默认值**。

```ts
// 包声明的是条件
{ action: 'backup', when: { flag: 'autoBackupAfterLogin' } }
// flag 的取值仍由 UI 与 DEFAULT_LOGIN_MODE 决定
```

这样默认值只有一个来源，包只拥有「编排知识」。

#### `ChainConfig` 的 23 个字段如何处置

| 类别 | 字段 | 去向 |
|---|---|---|
| 编排开关 | `autoBackupAfterLogin` `autoClearAfterBackup` `clearData` `setAvatarNickname` `onlyFollowingComments` `enableBindPhone` `followUsers` `switchContainer` `setProxyBeforeLogin` `resetDeviceBeforeLogin` | `ChainRun.flags`（键名与 UI opts 同名） |
| 运行期状态 | `loginLoopRemaining` `loginRetryRemaining` | `ChainRun.loopRemaining` / `.retryRemaining` |
| 单次运行数据 | `avatarPath` `nickname` | `ChainRun.data` |
| 批次调度 | `sameIpBatchSize` `batchIntervalSeconds` | 留在内核（与业务无关） |
| 外部账号源 | `smsProvider` `heroSms` | `ChainRun.flags`（业务选择） |
| 一键新机 | `resetDeviceMode` `resetDeviceModels` `resetOverseasRandom` | `ChainRun.flags` |
| 设备行为 | `setAdbIme` | `ChainRun.flags`（待下沉到设备层） |

`ChainState` 里的 `bindPhoneDone` / `loginPostStepsLeft` / `preStepsLeft` 全部删除：
- `bindPhoneDone` → `ChainRun.done`（通用"已执行"集合）
- `loginPostStepsLeft` / `preStepsLeft` → 由配方顺序决定

#### 修复的三处旧版不一致（B 方案）

**缺陷 1（已修复）：登录后「绑定手机号」的执行时机**

旧版 `device_tab.py:6060-6175`：
```python
if avatar_path and nickname:
    ... 创建 MODIFY_PROFILE job
    continue        # ← 关键：后面 enable_bind_phone 分支不执行
if enable_bind_phone:
    ... 创建 BIND_PHONE job
    continue
```

而 `MODIFY_PROFILE 成功` 分支里（`:5971-6005`）才检查绑定。

TS 旧实现把 `bind` 与 `profile` 都放进 `loginPostStepsLeft` 队列并列执行，
等于**改资料前就绑定**。现已按旧版真实顺序修正。

验证（`beginChain` → 迭代 `advanceChain`）：

| 场景 | 结果序列 |
|---|---|
| 无开关 | `login` |
| 改资料+绑定 | `login > modify-profile > bind-phone` ✅ |
| 仅绑定（无改资料） | `login > bind-phone` ✅ |
| 全开 | `switch-container > set-proxy > reset-device > login > set-following-comments > modify-profile > bind-phone > backup > clear` ✅ |
| 循环 1 次 | `login > backup > clear > login > backup > clear` ✅ |
| 关注关键词为空 | `login`（跳过 follow-user） ✅ |

**缺陷 2（语义澄清，未改行为）**

```ts
// 旧：同一个 UI 开关填了两个字段
autoClearAfterBackup: opts['clearData'] === true,
clearData: opts['clearData'] === true,
```

查旧版 `register_job_context(auto_clear_after_backup=clear_data)` —— **旧版也是同一个源**，
所以这不是 TS 引入的回归，只是把语义压平了。保留现状，注释说明。

**缺陷 3（已澄清）**

旧版循环时硬编码 `auto_backup_after_login=True`，因为 `login_loop_remaining` 依赖备份成功
才能进到下一轮。新解释器里 `finishOrLoop` 直接检查 `loopRemaining`，不依赖备份，
语义更清晰且不改变实际路径（循环场景下备份本来就开着）。

#### 中途发现的两个解释器 bug（自测抓到）

**bug A：`backup` 无限循环**

首次实现时 `finalize` 用 `new Set()` 做 skip，导致 `backup → afterBackup → backup...`。
改为 `pickStep(recipe.finalize, scope, scope.run.done)`——`advanceChain` 已把完成动作
加入 `run.done`，天然只执行一次。

**bug B：`modify-profile` 被误跳过**

deferred 逻辑写成了「把带 afterAction 的动作本身加进 skip」：

```ts
// 错误
for (const spec of recipe.afterLogin) {
  if (recipe.afterAction?.[spec.action] && ...) deferred.add(spec.action)  // ← 跳过了触发者
}
```

结果 `login > (空)`，续接永远不触发。正确做法是**跳过 afterAction 里的动作**，不是触发者：

```ts
for (const spec of recipe.afterLogin) {
  const continuation = recipe.afterAction?.[spec.action]
  for (const next of continuation) deferred.add(next.action)
}
```

#### 验收

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | ✅ |
| kernel / login-chain 的 `xhs.` 计数 | ✅ 均 0 |
| `/api/flows` | ✅ 17 个 |
| 链顺序 6 个场景 | ✅ 全部符合旧版 |
| 「改资料后才绑定」断言 | ✅ PASS |
| 「无改资料立即绑定」断言 | ✅ PASS |
| 打包启动 | ✅ |
| 真机跑链 | ❌ SDK（7878）离线 |

#### 待办

`ChainState.run.flags['setAdbIme']` 目前无人消费（旧版传给 LOGIN job）。
按 STYLE「能力接缝」应下沉到 `DeviceControl`，触发时切输入法。
不在本次范围，已记入 `docs/spec/`。

### 11.35 修复 setAdbIme 悬空：ensureIme / ensureYadb 从未被调用（2026-10-29 15:23）

#### 问题

`setAdbIme` 在 UI 有勾选框、在 `LoginModeOptions` 有字段、在 `ChainRun.flags` 有值，
但**没有任何代码消费它**：

```bash
$ grep -rn "setAdbIme" packages/ --include=*.ts
login-tab.ts:107:  setAdbIme: boolean          # 类型定义
login-tab.ts:122:  setAdbIme: true,            # 默认值
kernel.ts:831:     setAdbIme: opts[...] !== false,  # 写入 flags
# 没有任何读取
```

进一步查发现更严重：`DeviceControl` 契约里的两个方法**从来没被调用过**：

```bash
$ grep -n "ensureIme\|ensureYadb" packages/app/kernel/src/kernel.ts
(no output)
```

`ensureYadb` 同理——`yadbPath` 只是往下传进 `RunOptions`，但**从没推送过 yadb 二进制**。

#### 后果

`yadb` 通道的流程全部依赖这两步：

| 流程 | uiChannel | 缺 IME 的后果 |
|---|---|---|
| `xhs.login.phone-prep` | `yadb` | 手机号写不进输入框 |
| `xhs.login.op` | `yadb` | 同上 |
| `xhs.login.vjump` | `yadb` | 同上 |

**新容器 / 刚恢复出厂**的设备上，这三条流程会直接失败。

#### 旧版真实行为（`auto_login.py:3074-3078`）

```python
def main_login(ip_param, tel, url, ..., set_adb_ime=True):
    print("main_login开始登录咯")
    if set_adb_ime:
        ensure_adb_keyboard(ip_param)      # ← ①
    ensure_yadb_pushed(ip_param)           # ← ②
```

`ensure_adb_keyboard` 的完整逻辑（`auto_login.py:147-200`）：

```python
ime_output = device.shell("ime list -s")
if ADB_KEYBOARD_IME not in ime_output:
    if not os.path.exists(apk_path): return          # 无 APK 则跳过
    device.push(apk_path, "/data/local/tmp/ADBKeyboard.apk")
    device.shell("pm install -r -t /data/local/tmp/ADBKeyboard.apk")

device.shell(f"ime enable {ADB_KEYBOARD_IME}")
device.shell(f"ime set {ADB_KEYBOARD_IME}")
current_ime = device.shell("settings get secure default_input_method").strip()
if current_ime == ADB_KEYBOARD_IME: return           # 成功即返回

# —— root 兜底 ——
settings put secure enabled_input_methods <ids 加 ADBKeyboard>
pm disable-user --user 0 <原输入法>                   # 临时禁用
switched = settings get secure default_input_method
pm enable --user 0 <原输入法>                         # 恢复
# 复检 switched 与 current，失败只打印，继续登录
```

关键是它**全程 try/except，失败只 print 不抛**——登录不能因为输入法问题中断。

#### 复核：实现早就对齐了旧版

`packages/device/device-adb/src/index.ts:189-230` 的 `ensureIme` **已逐行移植**：

```ts
async ensureIme(serial: string): Promise<void> {
  // 移植自 ensure_adb_keyboard（auto_login.py:147-199）。失败不抛错，只记录。
  const listOutput = await this.runShell(serial, ['shell', 'ime', 'list', '-s'])
  if (!listOutput.includes(ADB_KEYBOARD_IME)) {
    if (!this.adbKeyboardApk) { log('...跳过'); return }
    await run(this.adbPath, ['-s', serial, 'push', apk, '/data/local/tmp/ADBKeyboard.apk'])
    await this.runShell(serial, ['shell', 'pm', 'install', '-r', '-t', '/data/local/tmp/ADBKeyboard.apk'])
  }
  await this.runShell(serial, ['shell', 'ime', 'enable', ADB_KEYBOARD_IME])
  await this.runShell(serial, ['shell', 'ime', 'set', ADB_KEYBOARD_IME])
  let current = ...
  if (current === ADB_KEYBOARD_IME) return
  // —— root 兜底（旧实现 168-197）——
  ...enabled_input_methods / disable-user / enable...
}
```

所以本轮**只补调用**，不改实现。

#### 修复：抽出 `prepareYadbAndIme` 并在两处调用

```ts
/**
 * 登录前准备（旧 `main_login` 开头两步，`auto_login.py:3076-3078`）。
 *
 * 两者都是「尽力而为」：旧实现内部 try/except 后 print 继续，不阻断登录。
 */
async function prepareYadbAndIme(chain: ChainState): Promise<void> {
  const imeOn = chain.run.flags['setAdbIme'] !== false && chain.run.flags['setAdbIme'] !== 'false'
  if (imeOn) {
    try { await ctx.deviceControl.ensureIme(chain.serial) }
    catch (error) { console.log(`设置输入法失败（继续）: ...`) }
  }
  if (options.yadbPath) {
    try { await ctx.deviceControl.ensureYadb(chain.serial, options.yadbPath) }
    catch (error) { console.log(`推送 yadb 失败: ...`) }
  }
}
```

两个调用点：

| 入口 | 位置 | 说明 |
|---|---|---|
| 批量登录链 | `executeChain` 里 `beginChain` 之后、登录之前 | 与旧版位置一致 |
| 单项任务 | `runChainStep` 里 `flowId === chainFlows['login']` 时 | 旧版每次 `main_login` 都做 |

#### 真机验证

设备 `127.0.0.1:5700`（已在 `adb devices` 中）：

| 检查 | 结果 |
|---|---|
| 调用前输入法 | `com.android.adbkeyboard/.AdbIME` |
| `ensureIme` 耗时 | 1901 ms |
| 调用后输入法 | `com.android.adbkeyboard/.AdbIME` |
| 幂等（二次调用） | 1850 ms，状态不变 ✅ |
| 断言 | **PASS** |

#### 验收

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | ✅ |
| `/api/flows` | ✅ 17 个 |
| 打包启动 | ✅ |
| `ensureIme` 真机调用 | ✅ 幂等，输入法正确 |
| 完整登录链真机跑 | ❌ SDK（7878）离线 |

#### 备注

`setAdbIme` 现在被 `prepareYadbAndIme` 消费，不再悬空。
但仍留在 `ChainRun.flags` 而非下沉到 `DeviceControl`——
因为它表达的是「本次运行要不要做这个准备动作」，属于运行期决策，
与「怎么做」的 `ensureIme` 能力已正确分离（STYLE §5 能力接缝）。
