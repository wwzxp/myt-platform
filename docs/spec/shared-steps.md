# 共享步骤库（三个标签页的公共原语）

三个标签页的流程在规格上分属不同业务，但底层动作高度重合。新引擎应把这些抽成**可复用步骤原语**，业务 flow 只做编排。
本文件是 `docs/spec/legacy/{login,publish,comment}.md` 的公共部分归纳。

## 1. 设备就绪

| 原语 | 语义 | 旧实现 | 注意 |
|---|---|---|---|
| `ensureAdb(serial)` | `adb connect` + 状态确认 | `auto_login.py:370-378`、`auto_jl_new.py:1142` | 断开重连后需等待 `device` 状态 |
| `ensureIme(serial)` | 确保 ADBKeyboard 安装并切为默认输入法 | `auto_fb.py:876-896` | 安装 timeout 60s；APK 缺失要早失败 |
| `ensureYadb(serial)` | push `yadb` 到 `/data/local/tmp/` | `auto_fb.py:1732-1737` | 登录流程与编辑页依赖它 |
| `ensureRoot(serial)` | `su -c id` 能力探测 | 旧代码**检查被注释**（`worker:316-318`） | 新平台必须在启动时探测，无 root 早失败 |

## 2. App 生命周期

| 原语 | 语义 | 旧实现 |
|---|---|---|
| `forceStop(pkg)` | `am force-stop` | `worker` 多处 |
| `launch(pkg/activity)` | `am start -n` | `auto_login.py:370-378` |
| `deepLink(uri)` | `am start -a VIEW -d <uri>`，载体 `com.xingin.xhs.routers.RouterPageActivity` | `auto_fb.py:262-279` |
| `clearData(pkg)` | `pm clear` + 数据目录清理 | `worker:315-321` |

深链清单：

```
xhsdiscover://profile
xhsdiscover://post_note/<note_id>
xhsdiscover://item/<note_id>
xhsdiscover://post_new_note?page={"page_type":"now_portal_home_page"}
xhsdiscover://security_account_operation?operateType=bind_phone
xhsdiscover://security_account_page
xhsdiscover://edit_profile/
xhsdiscover://settings | settings/privacy
xhsdiscover://search/result?keyword=<kw>
xhsdiscover://following
```

## 3. UI 获取

| 原语 | 语义 | 注意 |
|---|---|---|
| `dumpUi(serial)` | `uiautomator dump` → XML | 空值需重试 3 次；旧项目 `adb_ui` 有双实现 |
| `dumpLayoutYadb(serial)` | yadb `-layout` | 编辑页专用，节点数与 uiautomator 不同 |
| `screenshot(serial)` | `screencap -p` | 用于安全验证识别与人工核对 |

**统一要求**：两条通道任选其一但必须显式标注，禁止同一流程里混用而不记录。

## 4. 定位器（新平台的核心抽象）

旧实现全部是「固定子节点下标数组 + `clickable=true` + bounds 中心点」。新平台需要：

```ts
type Locator = {
  kind: 'path' | 'xpath' | 'text' | 'desc' | 'id' | 'bounds-ratio'
  value: string | number[]
  requireClass?: string          // 命中后校验节点 class
  fallbacks: Locator[]           // 按序尝试
  timeoutMs: number
  pollIntervalMs: number
}
```

规则：

1. **多策略**：`id > text > desc > path`，至少两条独立策略，最后才落到层级下标。
2. **命中校验**：命中节点必须是期望 class（旧代码只有标题/正文/@/相册做了校验）。
3. **录制回归**：每个定位器配一份 dump 快照，改版时先跑快照测试。
4. **坐标兜底要显式**：`bounds-ratio` 只允许作为 fallback，且必须记录「用了兜底」事件。

## 5. 动作

| 原语 | 语义 | 拟人化 |
|---|---|---|
| `tap(x, y)` | 点击 | 高斯偏移 ±12px、按压 40-350ms |
| `swipe(from, to, ms)` | 滑动 | 间隔 0.08-2.5s |
| `back()` | `keyevent 4` | — |
| `typeText(text)` | ADBKeyboard 广播 `ADB_INPUT_TEXT --es msg` | burst 2-5 字，组间 0.2-0.5s |
| `clearInput(maxDel)` | `KEYCODE_DEL` N 次（旧：`min(len+5,20)` 或固定 20） | — |
| `pasteText(text)` | 剪贴板粘贴（艾特/长文本用） | — |

**输入必须回读校验**：旧代码在标题处做了 3 次回读，正文没有——新平台统一要求回读，失败即该步骤失败。

## 6. 等待策略

旧代码用 `sleep(random)` 铺满全流程。新平台统一为：

```ts
waitUntil(predicate, { timeoutMs, pollMs, jitterMs })   // 条件等待
sleep(ms)                                               // 仅用于限速，不得作为同步手段
```

已知需要条件等待的场景：

| 场景 | 旧实现 |
|---|---|
| 启动后等首屏 | `sleep 3-7s` |
| 等 loading 消失 | `wait_spinner_gone(30s)` |
| 等评论面板消失 | 10 次 × 0.5-0.8s |
| 等页面切换 | 5-29 次轮询 |
| 等验证码到达 | 6 轮、70s 窗口 |
| 等编辑页就绪 | 19 次轮询 |

## 7. 断言（新平台必须补的一层）

旧代码几乎没有断言，这直接导致「假成功」。建议原语：

| 断言 | 用途 |
|---|---|
| `assertPage('note-detail' \| 'profile' \| 'publish-editor' ...)` | 页面守卫，旧代码只在评论详情页做了 4 层特征判断 |
| `assertElement(locator)` | 元素存在/可见/可点击 |
| `assertTextMatches(text)` | 回读校验 |
| `assertNotePublished(baseline)` | 发布前记录（笔记数/首条 id）→ 发布后比对增量 |
| `assertCommentVisible(text)` | 评论后回查列表是否出现该文案 |

## 8. 限流与人味（HumanPolicy）

旧代码把随机延时散落在每个步骤里。新平台集中为策略对象，可开/可关、可注入种子：

| 参数 | 旧值 |
|---|---|
| 点击偏移 | 高斯 ±12px |
| 按压时长 | 40-350ms |
| 点击间隔 | 0.08-2.5s |
| 打字 burst | 2-5 字 / 0.2-0.5s |
| 思考停顿 | 15% 概率 4-7s |
| 点赞间隔 | 0.35s 标量 → 0.8x~1.2x |
| 评论间隔 | 默认 300s（旧 0-999，新 0.5-600） |

## 9. 错误分类（决定重试与人工介入）

| 类别 | 示例 | 处置 |
|---|---|---|
| `transient` | dump 空、元素暂未出现、adb 抖动 | 退避重试 |
| `wrong-page` | 停在非预期页面 | 回退到入口重进（有限次） |
| `precondition` | 无 root、APK 缺失、无可用账号 | 立即失败，标不可重试 |
| `platform-reject` | 风控提示、验证码、账号异常 | 标记人工介入，不自动重试 |
| `unknown` | 其他 | 失败并保留截图 + dump |

## 10. 三个标签页对这些原语的覆盖

| 原语 | 上号器 | 笔记发布 | 评论 |
|---|---|---|---|
| `ensureAdb` / `ensureIme` / `ensureYadb` | ✅ | ✅ | ✅ |
| `deepLink` | ✅ 5 种 | ✅ 3 种 | ✅ 2 种 |
| `dumpUi` / `dumpLayoutYadb` | ✅ 两者混用 | ✅ 编辑页用 yadb | ✅ |
| `typeText` + 回读 | 部分 | 标题有、正文无 | 无 |
| `waitUntil` | 少数几处 | 少数几处 | 少数几处 |
| `assertPage` | 无 | 无 | 仅详情页 |
| `assertNotePublished` / `assertCommentVisible` | — | **缺** | **缺** |
| `HumanPolicy` | 分散 | 分散 | 分散 |
