# 代码风格与工程约定（STYLE）

适用范围：本项目全部 TypeScript 代码与包结构。与 `CONTEXT.md` 冲突时，术语以 CONTEXT 为准。

## 1. 语言与工具链

| 项 | 约定 |
|---|---|
| 语言 | TypeScript，`strict: true`，禁止 `any`（确需时写明理由） |
| 模块 | ESM only（`"type": "module"`），本地相对导入带 `.ts`/`.js` 后缀按构建工具要求统一 |
| 运行时 | Node 22 LTS（Electron 内置版本为准）；浏览器侧代码不得引用 Node API |
| 包管理 | pnpm workspace |
| 测试 | vitest（单元/行为）+ 打包产物冒烟脚本（Node 脚本，非 vitest） |
| 格式化 | 由工具统一（oxlint/prettier 任一，配置进仓库后不得手动偏离） |

## 2. 目录与包命名

```
packages/<group>/<name>/
```

- 目录、包名小写，用 `-` 分隔：`device-adb`、`ui-devices`。
- 包名统一前缀 `@myt/`：`@myt/device`、`@myt/myt-api-v2`。
- 一个包只承担一个角色：Service Definition / Provider / Consumer 不混在同一个包里（见 CONTEXT「能力接缝」）。
- 测试文件与被测文件同目录，命名 `*.test.ts`；测试夹具放 `fixtures/`。

## 3. 命名

| 对象 | 规则 | 例 |
|---|---|---|
| 类型 / 接口 / 类 | PascalCase | `DeviceRegistry`、`Slot` |
| 函数 / 变量 | camelCase | `probeHost`、`currentSlot` |
| 常量 | UPPER_SNAKE_CASE（仅真正的常量） | `ADB_PORT_BASE` |
| 事件名 | `domain/verb` 小写 | `device/online`、`run/step-start` |
| ctx 服务键 | camelCase，单数优先 | `ctx.devices`、`ctx.mytHost` |
| 不透明 ID | branded 类型，禁止裸 `string` | `DeviceId`、`HostId` |

**禁止的标识符**（来自 CONTEXT 禁用词）：`device_serial`、`machineId`、`task` 表示流程、`workflow` 表示运行。

## 4. 注释与文档

- 标识符英文，注释中文。
- 导出符号必须有 TSDoc：一句话说明契约；有参数/返回值时写 `@param` / `@returns`。
- 注释只写「为什么」和「契约」，不复述代码。
- 每个包必须有 `README.md`：职责、对外契约、依赖的接缝、失效模式。
- 改行为必须同改 README 与 TSDoc；文档滞后视为未完成。

## 5. 错误处理

- 用结构化错误（错误类或带 `code` 的对象），不用裸 `throw new Error("...")` 传递语义。
- **禁止静默兜底**：SDK 响应缺字段时要么显式降级并记录事件，要么直接失败；不得 `?? 默认值` 悄悄吞掉。
- 空 `catch` 必须写明吞掉的原因。
- 失败必须可见：写事件日志 + UI 呈现，不允许只在控制台打一行。
- 重试策略集中定义：只读接口可重试；**变更接口（SDK 里大量 GET 变更）默认不重放**，超时后先回查状态。

## 6. 生命周期与状态

- 一切注册走 `ctx.effect()` / `ctx.on()`，返回 disposer；模块级全局状态禁止。
- 长连接、定时器、订阅必须绑定 owner，卸载时释放。
- 跨设备并发，设备内串行：同一 `DeviceId` 的动作通过其 mailbox 排队。
- 抢占坑位前必须确认占用者已停止，否则会打断别的设备任务。

## 7. 事件与日志

- 事件是追加日志中的不可变事实；不得修改已写事件。
- 事件字段用判别式（`type` 字段）+ 联合类型；未知事件类型不得崩溃。
- 所有对外可见的状态变化都必须有对应事件（UI 只读投影，不持有真相）。
- 日志脱敏：账号密码、SID、代理密码、卡密不得进入事件与日志。

## 8. 测试

| 层次 | 要求 |
|---|---|
| 单元 | 纯函数（解析、映射、状态机）必须有测试 |
| 适配层 | SDK 响应解析用**录制快照**做对拍（已存 `resources/sdk/probe_*.json`） |
| 行为 | 一个用户可见行为至少一条测试；不测实现细节 |
| 打包 | 冒烟脚本直接对 `dist/win-unpacked` 产物运行 |
| 迁移 | 旧 Python 流程移植时，同输入同输出对拍 |

禁止的测试：断言「函数被调用过」、断言常量等于自身、只验证不抛异常。

## 9. Git

- 一个提交只做一件事；提交信息格式：`<scope>: <中文简述>`。
- 不提交生成物（`dist/`、`node_modules/`、探测快照以外的大文件）。
- 参考资源（`reference/`）与打包产物（`resources/sdk/*.json` 探测快照）区别对待：前者 gitignore，后者保留以便对拍。

## 10. 待定（等包结构定稿后补）

- lint / format 的具体配置文件与规则集
- 包间依赖方向约束（是否启用 dependency-cruiser 一类检查）
- 构建产物形态（tsdown / tsc 组合）
