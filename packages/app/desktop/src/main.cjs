'use strict'

const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell, utilityProcess } = require('electron')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')
const { readConfig, resolveDataDir, writeConfig } = require('./data-dir.cjs')

const APP_ID = 'com.myt.farm'
const DEFAULT_PORT = 7788
const STARTUP_TIMEOUT_MS = 40_000
const HEALTH_INTERVAL_MS = 500

/** 单实例：抢不到锁直接退出，否则第二个实例会再起一个内核并抢端口。 */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

let mainWindow = null
let tray = null
let kernel = null
let kernelPort = null
let shuttingDown = false

/**
 * 配置目录：存放 `myt.config.json`（用户选择的数据目录）与主进程日志。
 *
 * 仍在 Electron 默认位置——它是「指向数据目录的指针」，
 * 本质是设置而非数据，跟着系统走是合理的。
 */
function getConfigDir() {
  return app.getPath('userData')
}

/** 解析后的数据目录（首次调用时计算并缓存）。 */
let resolvedData = null

/**
 * 数据目录：流程、设备状态、日志等实际用户数据。
 *
 * 优先级见 `data-dir.ts`：env → 配置 → 用户选择 → 安装目录 → userData。
 * **默认不落 C 盘**：便携版用安装目录，否则建议非系统盘。
 */
function getDataDir() {
  if (resolvedData) return resolvedData.dir
  resolvedData = resolveDataDir({
    configDir: getConfigDir(),
    installDir: app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..'),
    fallbackDir: getConfigDir(),
  })
  logMain(`[data] dir=${resolvedData.dir} source=${resolvedData.source} systemDrive=${resolvedData.onSystemDrive}`)
  if (resolvedData.onSystemDrive) {
    logMain('[data] 警告：数据目录在系统盘，建议在设置里改到其它盘')
  }
  return resolvedData.dir
}

/** 兼容旧调用点：日志写到配置目录（与数据分开，避免数据目录换了日志丢失）。 */
function getUserDataDir() {
  return getConfigDir()
}

function logMain(line) {
  const stamp = new Date().toISOString()
  try {
    fs.mkdirSync(getUserDataDir(), { recursive: true })
    fs.appendFileSync(path.join(getUserDataDir(), 'desktop-main.log'), `${stamp} ${line}\n`)
  } catch {
    // 日志失败不应影响应用运行
  }
}

function parsePort(value) {
  const port = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null
}

function isPortAvailable(port, host = '127.0.0.1') {
  const { promise, resolve } = Promise.withResolvers()
  const server = net.createServer()
  server.once('error', () => resolve(false))
  server.once('listening', () => server.close(() => resolve(true)))
  server.listen(port, host)
  return promise
}

/** 首选端口被占用时改用临时端口；端口是运行时事实，不写死在配置里。 */
async function choosePort(preferred) {
  if (await isPortAvailable(preferred)) return preferred
  const { promise, resolve, reject } = Promise.withResolvers()
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : preferred
    server.close(() => resolve(port))
  })
  return promise
}

function kernelEntry() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'host', 'startup.mjs')
  }
  return path.join(__dirname, '..', '..', 'desktop-host', 'lib', 'startup.js')
}

function startKernel(port) {
  const entry = kernelEntry()
  if (!fs.existsSync(entry)) {
    throw new Error(`宿主入口不存在：${entry}（先执行 pnpm build:host）`)
  }
  // 工具链随包分发：发布版取 resources/tools，开发版回落到旧项目的 apk 目录。
  const toolsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'tools')
    : path.join(__dirname, '..', 'resources', 'tools')
  const pick = (name, fallback) => {
    const candidate = path.join(toolsDir, name)
    return fs.existsSync(candidate) ? candidate : fallback
  }
  const child = utilityProcess.fork(entry, [], {
    cwd: path.dirname(entry),
    stdio: 'pipe',
    env: {
      ...process.env,
      MYT_PORT: String(port),
      MYT_SDK_BASE: process.env.MYT_SDK_BASE ?? 'http://127.0.0.1:7878',
      MYT_HOSTS: process.env.MYT_HOSTS ?? '192.168.0.113',
      // 设备状态属于用户数据，跟随数据目录（不是配置目录）。
      MYT_STATE_FILE: path.join(getDataDir(), 'devices.json'),
      MYT_UI_DIR: app.isPackaged
        ? path.join(process.resourcesPath, 'ui')
        : path.join(__dirname, '..', '..', '..', 'client', 'ui'),
      MYT_ADB_PATH: pick('adb.exe', process.env.MYT_ADB_PATH ?? 'adb'),
      MYT_YADB_PATH: pick('yadb', process.env.MYT_YADB_PATH ?? ''),
      MYT_ADB_KEYBOARD_APK: pick('ADBKeyboard.apk', process.env.MYT_ADB_KEYBOARD_APK ?? ''),
      // 机型库（static/devices.json 移植，15 品牌 / 291 机型）。
      MYT_DEVICES_JSON: pick('devices.json', process.env.MYT_DEVICES_JSON ?? ''),
    },
  })
  child.stdout?.on('data', (chunk) => logMain(`[kernel] ${chunk.toString().trim()}`))
  child.stderr?.on('data', (chunk) => logMain(`[kernel:err] ${chunk.toString().trim()}`))
  child.on('exit', (code) => {
    // utilityProcess 的 code 是 uint32，异常退出会给出 4294967295 一类大值。
    const shown = code > 0x7fffffff ? `异常(${code})` : String(code)
    logMain(`[kernel] exited code=${shown}`)
    if (!shuttingDown) {
      kernel = null
      showCrashBanner(`内核已退出（code=${shown}），请查看日志或重启应用。`)
    }
  })
  return child
}

function waitForHealth(port) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  const { promise, resolve, reject } = Promise.withResolvers()
  const attempt = () => {
    if (Date.now() > deadline) {
      reject(new Error('内核启动超时'))
      return
    }
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, (res) => {
      res.resume()
      if (res.statusCode === 200) resolve()
      else setTimeout(attempt, HEALTH_INTERVAL_MS)
    })
    req.on('error', () => setTimeout(attempt, HEALTH_INTERVAL_MS))
    req.on('timeout', () => {
      req.destroy()
      setTimeout(attempt, HEALTH_INTERVAL_MS)
    })
  }
  attempt()
  return promise
}

function showCrashBanner(message) {
  logMain(message)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app/fatal', message)
  }
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#f7f8fa',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    logMain('[ui] ready-to-show')
    mainWindow.show()
  })
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    logMain(`[ui] did-fail-load ${code} ${description} ${url}`)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logMain(`[ui] render-process-gone ${JSON.stringify(details)}`)
  })
  mainWindow.on('close', (event) => {
    if (shuttingDown) return
    event.preventDefault()
    mainWindow.hide()
    if (process.platform !== 'darwin') ensureTray()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 外部链接交给系统浏览器，应用内不导航到站外。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const url = `http://127.0.0.1:${port}/`
  void loadWithRetry(mainWindow, url, 5)
}

async function loadWithRetry(win, url, attempts) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await win.loadURL(url)
      return
    } catch (error) {
      logMain(`[ui] load failed attempt=${attempt} ${String(error)}`)
      if (attempt === attempts) {
        await win.loadURL(
          'data:text/html;charset=utf-8,' +
            encodeURIComponent(
              `<body style="font-family:sans-serif;padding:40px">
                 <h2>界面加载失败</h2>
                 <p>内核地址：${url}</p>
                 <p>请查看 %APPDATA%/myt-desktop 下的日志。</p>
               </body>`,
            ),
        )
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
  }
}

function ensureTray() {
  if (tray) return
  const iconPath = path.join(__dirname, 'icon.png')
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('MYT 设备农场')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示窗口',
        click: () => {
          if (mainWindow) {
            mainWindow.show()
            mainWindow.focus()
          }
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          void quit()
        },
      },
    ]),
  )
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

async function quit() {
  shuttingDown = true
  kernel?.postMessage({ type: 'kernel/shutdown' })
  await new Promise((resolve) => setTimeout(resolve, 300))
  if (kernel) {
    try {
      kernel.kill()
    } catch {
      // 进程可能已退出
    }
  }
  app.quit()
}

/**
 * 首次运行：让用户选数据目录。
 *
 * 用户明确要求不默认存 C 盘，所以默认预填**第一个非系统盘**。
 * 用户可以直接确认、浏览选其它目录，或者选择「使用安装目录」（便携式）。
 * 关闭对话框视为跳过：记下 `skipped`，以后不再打扰，可在设置里改。
 */
async function promptDataDirIfNeeded() {
  if (!resolvedData) getDataDir()
  if (!resolvedData.needsPrompt) return

  const options = {
    type: 'question',
    title: '选择数据存放位置',
    message: '流程、设备状态、日志会保存在这里',
    detail: [
      `建议选择非系统盘，重装系统时数据不受影响。`,
      ``,
      `当前将使用：${resolvedData.dir}`,
      `建议路径：${resolvedData.suggested}`,
      ``,
      `点「使用安装目录」＝便携模式；点「选择其它位置」可自选。`,
    ].join('\n'),
    buttons: ['使用安装目录', '选择其它位置', '取消'],
    defaultId: 0,
    cancelId: 2,
  }

  const picked = await dialog.showMessageBox(options)
  const configDir = getConfigDir()

  if (picked.response === 2) {
    // 跳过：记下来，以后不再弹
    writeConfig(configDir, { ...readConfig(configDir), skipped: true })
    logMain('[data] 用户跳过选择，沿用当前目录')
    return
  }

  if (picked.response === 1) {
    const result = await dialog.showOpenDialog({
      title: '选择数据目录',
      defaultPath: resolvedData.suggested,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      writeConfig(configDir, { ...readConfig(configDir), skipped: true })
      logMain('[data] 用户取消选目录')
      return
    }
    const chosen = result.filePaths[0]
    writeConfig(configDir, { dataDir: chosen })
    resolvedData = resolveDataDir({
      configDir,
      installDir: app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..'),
      fallbackDir: configDir,
    })
    logMain(`[data] 用户选择 ${chosen}`)
    return
  }

  // 使用安装目录：清掉之前的选择，让解析回落到 install
  writeConfig(configDir, { skipped: true })
  logMain('[data] 用户选择安装目录（便携模式）')
}

async function bootstrap() {
  logMain('[app] starting')
  try {
    await promptDataDirIfNeeded()
    const preferred = parsePort(process.env.MYT_PORT) ?? DEFAULT_PORT
    const port = await choosePort(preferred)
    logMain(`[app] port=${port}`)
    kernelPort = port
    kernel = startKernel(port)
    try {
      await waitForHealth(port)
      logMain('[app] health ok')
    } catch (error) {
      logMain(`[app] health failed: ${String(error)}`)
      showCrashBanner('内核未能启动，请查看日志。')
    }
    createWindow(port)
    logMain('[app] window created')
  } catch (error) {
    logMain(`[app] bootstrap failed: ${String(error?.stack ?? error)}`)
    throw error
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
  Menu.setApplicationMenu(null)
  void bootstrap()
})

app.on('window-all-closed', () => {
  logMain(`[app] window-all-closed shuttingDown=${shuttingDown}`)
  if (shuttingDown) app.quit()
})

app.on('before-quit', () => {
  shuttingDown = true
  if (kernel) {
    try {
      kernel.kill()
    } catch {
      // 已退出
    }
  }
})

app.on('activate', () => {
  if (mainWindow) mainWindow.show()
  else if (kernelPort) createWindow(kernelPort)
})
