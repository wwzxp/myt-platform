# 移植对照表：auto_login.py → @myt/flow-xhs

本文件是**逐行移植**的核对依据。规则：旧实现是权威，任何偏离都是缺陷。

- 源：`F:/python_code/merge_auto_object/auto_object/xhs_device_tab/auto_login.py`（3425 行 / 77 个函数）
- 目标：`packages/flow/flow-xhs/src/` + `packages/device/{device,device-adb,human}/src/`
- 最后核对：2026-10-23

## 1. 文件映射

| Python | TS | 说明 |
|---|---|---|
| 定位辅助（逐级下钻 / bounds 解析） | `paths.ts` | `nodeAtPath`、`Point`、`BoundedPoint` |
| 12 个 `get_*_position`（主界面/登录页） | `locators.ts` | 路径数组逐位一致 |
| `_find_safety_verification_grid_cells` 等状态判定 | `state-locators.ts` | 含区号列表、重发、聚焦、下线、转圈、6 宫格 |
| 生日 Next / Skip / 风险插件 / See original / Later | `dialogs.ts` | — |
| 生日三列、QQ、东鹏、蓝旗、网络异常、服务器出错、安全验证按钮 | `guide-locators.ts` | — |
| `clear_phone_input` / `input_with_human_like` / `wait_spinner_gone` | `actions.ts` | — |
| `HumanLikeOperator` | `packages/device/human/src/index.ts` | 高斯偏移/按压/节奏/burst/种子随机 |
| `scroll_picker_column` / `scroll_birthdate_to` / `generate_random_adult_birthday` | `birthday.ts` | — |
| `fetch_url_contet_new` / `fetch_verification_code` / `normalize_herosms_phone` / `handle_safety_verification_page` | `verification.ts` | 识图由调用方注入 |
| `main` 前半段（进登录页） | `index.ts::createPhoneLoginPrepFlow` | 11 步 |
| `main` 后半段（验证码 + 引导页） | `login-steps.ts` | `createCodeRetryStep` / `createPostLoginGuideSteps` |
| `main_op_login` / `main_v_login` | `alt-login-flows.ts` | `opLoginFlow` / `vJumpLoginFlow` |
| `tap_with_human_like` / `ensure_adb_keyboard` / `adb_ui_yadb` / `press_back` / `launch_*_app` | `packages/device/device-adb/src/index.ts` | `tapLikeHuman` / `ensureIme` / `dumpUi({channel:'yadb'})` / `back` / `launchApp` |

## 2. 三个致命细节（实测验证）

| 细节 | 错误做法 | 旧代码做法 | 证据 |
|---|---|---|---|
| UI 获取通道 | `uiautomator dump` | **YADB**（`app_process -Djava.class.path=/data/local/tmp/yadb ... -layout`） | `auto_login.py:2960-2980` |
| 点击方式 | `input tap` | **同点位 swipe 40–350ms** | `auto_login.py:704-746` |
| 手机号输入 | 只用 ADBKeyboard 广播 | 纯 ASCII 用 `input text`（同步有序） | 实测：广播乱序导致 `180 3000 8013` |

## 3. 关键数值（不得改动）

| 参数 | 值 | 位置 |
|---|---|---|
| 区号按钮等待 | 29 轮 × 0.6–1.5s | `main:2521` |
| 登录入口等待 | 5 轮 × 0.6–1.5s | `main:2474` |
| 首屏弹窗 | 2 段 × 5 轮 × 0.3–0.8s | `main:2416-2456` |
| 验证码轮次 | 6 轮 | `main:2763` |
| 重发等待 | 70s（倒计时取 `min(cd+2,30)`） | `main:2870-2910` |
| 引导页卡住上限 | 10 次 | `main:2899` |
| 生日重试 | 2 轮 × 30 次 × 0.1–0.4s | `main:2830-2850` |
| 清空输入 | `min(len+5, 20)` 次，每次 50–80ms | `2288-2296` |
| 输入重试 | 5 次（含清空重输） | `2297-2338` |
| 思考停顿 | 15% → 4–7s，否则 0.8–3s | `39-58` |
| 点击间隔 | <1s: 80–250ms；10%: 1000–2500ms；否则 300–800ms | `704-746` |
| 按压时长 | 70%: 80–150ms；20%: 40–80ms；10%: 250–350ms | `704-746` |
| 高斯偏移 | 均值 (1.5, 2.0)，σ=4.0，夹 ±12 | `72-96` |
| 打字 burst | 2–5 字，组间 200–500ms | `99-116` |
| 滚轮滑动 | 起点=列 top，`up` 交换，时长 `max(120, d*0.9)±40..60` → 夹 [100,800] | `885-910` |
| 生日滚动 | 单次 ≤250px，步长 80，滑后 0.3s | `911-945` |
| 转圈判定 | 40–160px、宽高差≤20、中心距≤22%、无参照时节点≤15 | `2339-2392` |
| 安全验证 | 3 次尝试、等页 60s、点后 1.5s 复查 | `2981-3064` |
| 取码（legacy） | 30 次，第 2 次起 0.8–1.5s | `291-334` |
| 取码（heroSMS） | 每 2s，最长 70s | `335-360` |

## 5. 审核记录（2026-10-23，三路并行审核）

对移植做了逐函数审核（定位 / 动作 / 流程三组），发现并修复以下 P0：

| # | 缺陷 | 修复 |
|---|---|---|
| 1 | **点击原语未生效**：`tapLikeHuman` 固定按压 120ms，无高斯偏移、无点击前等待；`humanClickPoint`/`nextTapGap`/`pressDuration` 在流程中零引用 | 重写 `tapLikeHuman`：三档间隔 + 高斯偏移 + bounds 内缩 3px + 70/20/10 按压加权 + 微移 `int(-2,2)` + `rightBoundary-20` |
| 2 | `get_later_button_position` 有**两份定义**（1177 与 2177），后者覆盖前者；移植了被覆盖的那份 | 改用运行时的 `[0,0,0,0,0,0,0,0,0,2,1]` |
| 3 | 手机号登录路径漏 2 条（20260507 / 20260602），且缺「排除 QQ/微博」判定 | 补足 10 条 + content-desc 排除 |
| 4 | 区号按钮 text 未做子节点回落 → 区号比较恒为假 | 补子节点回落 |
| 5 | 发码两轮后既不失败也不停止，直接进下一步 | 重写 `sendCodePhase`：2 轮 + 5×3 连点 + k/j 循环 + `assertCodeSent` 闸门 |
| 6 | 验证码错误后无法回到 6 轮重发 | 引入 `CodeRejected`，引导页抛出让 `code-retry-loop` 继续 70s 重发 |
| 7 | `main_login` 外层 2 次重试与「发送失败立即停止」缺失 | 新增 `loginWithRetry`，`FlowAbort.reason === CODE_SEND_FAILED` 时不再重试 |
| 8 | `ensureIme` 在 `ime set` 失败时直接抛错，缺 root 强切 | 补 `settings put` + `pm disable-user` + `finally pm enable` |

顺带修正的 P1：

| # | 缺陷 | 修复 |
|---|---|---|
| 1 | `AGREE_CONTINUE_PATHS` 4 条全生效（旧代码 3 条被注释） | 只保留 `[0,0,0,0,3]` |
| 2 | 区号漏第 6 条 20260923 路径 | 补上 |
| 3 | 验证码框未校验 `EditText`；通知 ALLOW 未校验 `Button` | 补 class 约束 |
| 4 | `getVerifyLoginButtonInfo` 的 text 未按「有子节点取 children[0]」 | 修正 |
| 5 | `inputWithHumanLike` 用 `\s+` 剥离（旧实现只删半角空格） | 改 `replaceAll(' ', '')` |
| 6 | 流程多余地直接进入引导页（无验证码时） | 引导页移入 `code-retry-loop` 内部 |

### P1（已全部修复）

全部已修复（2026-10-23 19:22），见下表：

| # | 项 | 修复 |
|---|---|---|
| 1 | `findSafetyVerificationGridCells` 缺旧实现的 `sleep(10)` | 改为 async，识别到 6 格后固定等 10s 再返回（`state-locators.ts:274`） |
| 2 | `isLoadingSpinnerPresent` 节点计数从第一个 `<node>` 起（旧实现含 `<hierarchy>`） | 计数起点 +1（`state-locators.ts:151`） |
| 3 | `getServerErrorRefreshButtonPosition` 额外要求 clickable | 去掉 clickable 判定，能解析 bounds 即返回 |
| 4 | 安全验证超时分支的连点参数 | `retapVerifyLogin` 增加参数：服务器出错 0.5–1.5s + 不可用即 break；超时 0.3–0.6s + 连试满 5 次（`verification.ts:197`） |
| 5 | `fetchLegacyCode` 未显式禁用系统代理 | 改用 `node:http`/`node:https` 直连（等价 `trust_env=False`），并按 `content-encoding` 解压 |
| 6 | 区号列表循环缺「网络异常→不了」兜底 | 5 轮等待中加入 `getNetworkErrorCancelButtonPosition` 点击（`index.ts:303`） |

### 修复后的二次验证（2026-10-23 19:20）

真机 `192.168.0.113:5001` 重跑登录准备流程：`succeeded, 11 steps`，耗时 33s；
设备最终状态 `EditText="138 0013 8000"`、区号 `+86`、`focused=true`。

## 6. 尚未移植

| 项 | 原因 |
|---|---|
| 安全验证识图 | 旧实现调外部模型；TS 侧通过 `solveSafety` 注入，内核未接 |
| SID 登录 | 在 `xhs_sid_extractor.py`，属另一模块 |
| 备份包登录 | 在 `xhs_real_state_restore.py` + worker，属另一模块 |
| 卡密/硬件指纹 | 在 `auth_client.py` 与 `main.py`，属授权模块 |
| 区号列表滚动 | 旧实现只点当前可见项；目标区号不在首屏时行为一致（会失败），未额外增强 |
