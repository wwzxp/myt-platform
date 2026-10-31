# ADR-0003 桌面交付：Electron 壳 + Node 内核

- 状态：已接受（2026-10-23）
- 关联：ADR-0001 D3
- 影响范围：打包、启动流程、崩溃隔离、签名与更新

## 背景

客户需要双击即用的 Windows 安装包。参考项目 `WeChatDataAnalysis` 用「Electron 壳 + PyInstaller 打包的 Python 后端」交付，工程范式（单实例、端口协商、健康检查、托盘、更新、签名、产物冒烟）已在其客户环境中验证。

## 决策

| 层 | 选择 | 说明 |
|---|---|---|
| 壳 | Electron 33 + electron-builder 25 + NSIS | 与参考项目同款；不引入 Tauri/WebView2 |
| 内核 | Node，跑在 Electron `utilityProcess` | 独立进程，崩溃不拖垮窗口；无需 PyInstaller |
| 内核产物 | esbuild 打成单文件 `host.mjs`（ESM，`platform=node`） | 77KB，目标机不需要 node_modules |
| 前端 | 静态文件，作为 `extraResources/ui` | 首期单文件 HTML，不做构建步骤；后续可换 Vite |
| 进程通信 | `process.parentPort` 消息（就绪/关闭）+ 本机 HTTP | 与参考项目的 `/api/health` 轮询同构 |

## 启动顺序

```
app.requestSingleInstanceLock()      抢不到锁直接退出
  └─ choosePort(7788)                首选端口被占则取临时端口
       └─ utilityProcess.fork(host.mjs, env=PORT/STATE/UI)
            └─ waitForHealth(/api/health, 40s)
                 └─ createWindow(loadWithRetry 5 次)
```

失败路径：内核缺失 → 报错并写 `desktop-main.log`；健康检查超时 → 窗口仍打开但显示诊断页；内核退出 → 向渲染进程推 `app/fatal`。

## 与参考项目的差异

| 项 | WeChatDataAnalysis | 本项目 |
|---|---|---|
| 后端 | Python exe（PyInstaller） | Node 单文件（esbuild） |
| 后端日志 | `backend-stdio.log` | 同一思路，写 `desktop-main.log` 的 `[kernel]` 前缀 |
| 前端构建 | Nuxt 静态生成 | 首期免构建；页面直接用 |
| 自动更新 | electron-updater + 私有 PKI | 首期关闭，预留可配置更新源 |

## 后果

- 安装体积预计 150–250MB（Electron 运行时占主要部分）。
- **必须代码签名**，否则 SmartScreen 拦截；签名证书未就绪前只发内部未签名版。
- 壳的 12 项客户机工程（单实例/端口/健康检查/托盘/自启/更新/日志/NSIS/卸载/Worker/设置持久化/重试）逐项对照参考项目实现，不重新发明。
- 内核与壳之间只有两条契约：`PORT` 环境变量与 `/api/health`；其余通过 HTTP，便于将来把内核换成独立服务。

## 未做（明确延后）

托盘图标资源、开机自启、自动更新、代码签名、打包产物冒烟脚本。上述在切片 A 之后按 `docs/plan/slice-a-acceptance.md` 的 A9/A10 补齐。

## 构建环境坑（2026-10-23 实测）

| 现象 | 原因 | 处理 |
|---|---|---|
| `electron` 二进制下载卡住 / 无 `dist/electron.exe` | 官方 CDN 在国内不可达 | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后重跑 `node install.js` |
| `electron-builder` 报 `Cannot compute electron version` | 依赖声明在 workspace 根，desktop 包内没有 | 在 desktop 的 `devDependencies` 里写死精确版本 `electron: 33.4.11` |
| `app-builder.exe process failed ERR_ELECTRON_BUILDER_CANNOT_EXECUTE` | NSIS / winCodeSign 工具链从 GitHub 下载失败 | `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/` |
| `extraResources` 路径找不到 | 相对路径以 desktop 包目录为基准 | `../../client/ui`、`../kernel/dist` |

结论：Windows 内网/受限网络下打包必须在环境里固定这两个镜像变量，并写进构建脚本，不能依赖开发者手动设置。
