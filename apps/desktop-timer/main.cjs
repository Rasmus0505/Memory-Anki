const electron = require('electron')
const { app, BrowserWindow, ipcMain, shell, session } = typeof electron === 'object' ? electron : {}
const fs = require('node:fs')
const path = require('node:path')

if (!app) {
  throw new Error('Memory Anki desktop must run under Electron, not Node.js.')
}

const APP_URL = process.env.MEMORY_ANKI_DESKTOP_URL || 'http://127.0.0.1:8012/'
const READY_FILE = process.env.MEMORY_ANKI_DESKTOP_READY_FILE || ''

// Electron 39 on some Windows GPU stacks aborts before ready-to-show with
// STATUS_BREAKPOINT (0x80000003 / unsigned 2147483651). Software rendering
// is enough for this local study window and avoids that crash.
if (process.platform === 'win32') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

function resolveDesktopUserData() {
  const candidates = []
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'MemoryAnki', 'desktop'))
  }
  candidates.push(path.join(__dirname, '..', '..', 'logs', 'electron-user-data'))
  candidates.push(path.join(require('node:os').tmpdir(), 'memory-anki-desktop'))
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, '.writable'), '')
      return dir
    } catch {
      // Controlled-folder or ACL blocks some AppData paths on this machine.
    }
  }
  return candidates[candidates.length - 1]
}

const desktopUserData = resolveDesktopUserData()
app.setPath('userData', desktopUserData)

let mainWindow = null
let pendingFlush = null
let allowMainWindowClose = false
let desktopReadyWritten = false
let mainWindowLoaded = false

const FLUSH_TIMEOUT_MS = 1800
const hasSingleInstanceLock = app.requestSingleInstanceLock()

function writeDesktopReady() {
  if (desktopReadyWritten || !READY_FILE || !mainWindowLoaded) return
  fs.mkdirSync(path.dirname(READY_FILE), { recursive: true })
  fs.writeFileSync(READY_FILE, JSON.stringify({ readyAt: new Date().toISOString(), pid: process.pid }))
  desktopReadyWritten = true
}

if (!hasSingleInstanceLock) {
  // Another desktop is already running (and will focus via 'second-instance').
  // Still write the ready file so a second launcher can detach cleanly
  // instead of treating this intentional exit as "Desktop startup failed".
  if (READY_FILE) {
    try {
      fs.mkdirSync(path.dirname(READY_FILE), { recursive: true })
      fs.writeFileSync(
        READY_FILE,
        JSON.stringify({
          readyAt: new Date().toISOString(),
          pid: process.pid,
          reusedExistingInstance: true,
        }),
      )
    } catch {
      // Best-effort signal for the launcher; focus still happens in the first instance.
    }
  }
  app.quit()
} else {
  app.on('second-instance', () => {
    ensureMainWindow()
  })
}

function requestMainWindowFlush(reason) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ ok: true, skipped: true })
  }
  if (pendingFlush) return pendingFlush.promise

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  let timeout = null
  let resolveFlush = () => {}
  const promise = new Promise((resolve) => {
    resolveFlush = resolve
  })
  timeout = setTimeout(() => {
    pendingFlush = null
    resolveFlush({ ok: false, timedOut: true })
  }, FLUSH_TIMEOUT_MS)
  pendingFlush = {
    requestId,
    promise,
    resolve: (result) => {
      clearTimeout(timeout)
      pendingFlush = null
      resolveFlush(result)
    },
  }
  mainWindow.webContents.send('memory-anki-desktop-flush-request', {
    requestId,
    reason,
    requestedAt: Date.now(),
  })
  return promise
}

function closeMainWindowAfterFlush(reason, options = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  void requestMainWindowFlush(reason).finally(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    allowMainWindowClose = true
    mainWindow.close()
    if (options.quitApp) {
      app.quit()
    }
  })
}

function publishMainWindowFullscreen(active) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('memory-anki-main-window-fullscreen-change', Boolean(active))
}

function publishMainWindowFocus(active) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('memory-anki-main-window-focus-change', Boolean(active))
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: 'Memory Anki',
    backgroundColor: '#fffaf2',
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  // Parent launchers sometimes start Electron with SW_HIDE; force the main
  // window onto the desktop as soon as Chromium has a surface ready.
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  const loadingPage =
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(
      '<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#fffaf2;color:#6b5b4b;font:20px sans-serif">Memory Anki 正在连接后台，请稍等…（会自动重试）</body>',
    )
  let loadRetries = 0
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, _desc, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || !String(validatedUrl).startsWith(APP_URL)) return
    loadRetries += 1
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    if (loadRetries === 1) win.loadURL(loadingPage)
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.loadURL(APP_URL)
    }, 2000)
  })
  mainWindow.loadURL(APP_URL)
  mainWindow.webContents.on('did-finish-load', () => {
    if (!String(mainWindow.webContents.getURL()).startsWith(APP_URL)) return
    mainWindowLoaded = true
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      publishMainWindowFocus(mainWindow.isFocused())
    }
    writeDesktopReady()
  })
  mainWindow.on('close', (event) => {
    if (allowMainWindowClose) return
    event.preventDefault()
    closeMainWindowAfterFlush('main_window_close', { quitApp: true })
  })
  mainWindow.on('enter-full-screen', () => publishMainWindowFullscreen(true))
  mainWindow.on('leave-full-screen', () => publishMainWindowFullscreen(false))
  mainWindow.on('focus', () => publishMainWindowFocus(true))
  mainWindow.on('blur', () => publishMainWindowFocus(false))
  mainWindow.on('closed', () => {
    allowMainWindowClose = false
    mainWindow = null
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function ensureMainWindow() {
  if (!mainWindow) createMainWindow()
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  // Desktop always reads the current server build and must never remain controlled by a PWA worker.
  await session.defaultSession.clearCache()
  await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] })
  createMainWindow()
})

ipcMain.on('memory-anki-desktop-flush-complete', (_event, result) => {
  if (!pendingFlush || result?.requestId !== pendingFlush.requestId) return
  pendingFlush.resolve({
    ok: Boolean(result.ok),
    errors: Array.isArray(result.errors) ? result.errors : [],
  })
})

ipcMain.on('memory-anki-main-window-focused', (event) => {
  event.returnValue = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused())
})

ipcMain.on('memory-anki-main-window-fullscreen', (event, active) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return
  const next = Boolean(active)
  if (mainWindow.isFullScreen() === next) {
    publishMainWindowFullscreen(next)
    return
  }
  mainWindow.setFullScreen(next)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (!mainWindow || mainWindow.isDestroyed() || allowMainWindowClose) return
  event.preventDefault()
  closeMainWindowAfterFlush('app_before_quit', { quitApp: true })
})

app.on('activate', () => {
  ensureMainWindow()
})
