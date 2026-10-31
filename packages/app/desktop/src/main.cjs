'use strict'

const { app, BrowserWindow, Menu, Tray, nativeImage, shell, utilityProcess } = require('electron')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')

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

function getUserDataDir() {
  return app.getPath('userData')
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
    return path.join(process.resourcesPath, 'kernel', 'host.mjs')
  }
  return path.join(__dirname, '..', '..', 'kernel', 'dist', 'host.mjs')
}

function startKernel(port) {
  const entry = kernelEntry()
  if (!fs.existsSync(entry)) {
    throw new Error(`内核入口不存在：${entry}（先执行 pnpm build:kernel）`)
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
      MYT_STATE_FILE: path.join(getUserDataDir(), 'devices.json'),
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

async function bootstrap() {
  logMain('[app] starting')
  try {
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
