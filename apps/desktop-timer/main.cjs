const electron = require('electron')
const { app, BrowserWindow, globalShortcut, ipcMain, shell, session } = typeof electron === 'object' ? electron : {}
const fs = require('node:fs')
const path = require('node:path')

if (!app) {
  throw new Error('Memory Anki desktop must run under Electron, not Node.js.')
}

const APP_URL = process.env.MEMORY_ANKI_DESKTOP_URL || 'http://127.0.0.1:8012/'
const OVERLAY_URL = process.env.MEMORY_ANKI_TIMER_OVERLAY_URL || `${APP_URL.replace(/\/$/, '')}/timer-overlay`
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
let timerWindow = null
let lastTimerSnapshot = null
let pendingFlush = null
let allowMainWindowClose = false
let desktopReadyWritten = false
let mainWindowLoaded = false
let overlayDesiredVisible = false
// A hidden transparent window still composites on Windows and flashes over the
// study window whenever the timer page repaints. Keep it off-screen until the
// user actually wants the overlay, and destroy it when they hide it.
const TIMER_OFFSCREEN = { x: -32000, y: -32000 }
let timerWindowBounds = { x: 80, y: 80, width: 320, height: 196 }

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
    ensureTimerWindow()
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
      timerWindow?.close()
      app.quit()
    }
  })
}

function publishMainWindowFullscreen(active) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('memory-anki-main-window-fullscreen-change', Boolean(active))
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
  mainWindow.loadURL(APP_URL)
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindowLoaded = true
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
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
  mainWindow.on('closed', () => {
    allowMainWindowClose = false
    mainWindow = null
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function rememberTimerWindowBounds() {
  if (!timerWindow || timerWindow.isDestroyed()) return
  const bounds = timerWindow.getBounds()
  if (bounds.x <= -16000 || bounds.y <= -16000) return
  if (bounds.width <= 0 || bounds.height <= 0) return
  timerWindowBounds = bounds
}

function destroyTimerWindow() {
  if (!timerWindow || timerWindow.isDestroyed()) {
    timerWindow = null
    return
  }
  rememberTimerWindowBounds()
  const closing = timerWindow
  timerWindow = null
  try {
    closing.setAlwaysOnTop(false)
    const bounds = closing.getBounds()
    closing.setBounds({ x: TIMER_OFFSCREEN.x, y: TIMER_OFFSCREEN.y, width: bounds.width, height: bounds.height })
    closing.hide()
  } catch {
    // The surface is going away either way.
  }
  setImmediate(() => {
    if (!closing.isDestroyed()) closing.destroy()
  })
}

function presentTimerWindow(created) {
  if (!overlayDesiredVisible || !created || created.isDestroyed() || timerWindow !== created) return
  created.setBounds(timerWindowBounds)
  created.setAlwaysOnTop(true, 'screen-saver')
  created.showInactive()
  created.moveTop()
}

function createTimerWindow() {
  if (timerWindow && !timerWindow.isDestroyed()) return timerWindow
  const created = new BrowserWindow({
    width: timerWindowBounds.width,
    height: timerWindowBounds.height,
    minWidth: 280,
    minHeight: 56,
    x: TIMER_OFFSCREEN.x,
    y: TIMER_OFFSCREEN.y,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: false,
    show: false,
    title: 'Memory Anki Timer',
    backgroundColor: '#00000000',
    transparent: true,
    hasShadow: false,
    thickFrame: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  timerWindow = created

  created.loadURL(OVERLAY_URL)
  created.webContents.on('did-finish-load', () => {
    if (created.isDestroyed()) return
    if (lastTimerSnapshot) {
      created.webContents.send('memory-anki-timer-snapshot', lastTimerSnapshot)
    }
    presentTimerWindow(created)
  })
  created.on('move', () => {
    if (timerWindow === created) rememberTimerWindowBounds()
  })
  created.on('resize', () => {
    if (timerWindow === created) rememberTimerWindowBounds()
  })
  created.on('closed', () => {
    if (timerWindow === created) timerWindow = null
  })
  return created
}

function ensureMainWindow() {
  if (!mainWindow) createMainWindow()
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
}

function ensureTimerWindow() {
  if (!overlayDesiredVisible) return
  if (!timerWindow || timerWindow.isDestroyed()) {
    createTimerWindow()
    return
  }
  presentTimerWindow(timerWindow)
}

function setTimerOverlayVisible(visible) {
  overlayDesiredVisible = Boolean(visible)
  if (!overlayDesiredVisible) {
    destroyTimerWindow()
    return
  }
  if (!timerWindow || timerWindow.isDestroyed()) {
    createTimerWindow()
    return
  }
  presentTimerWindow(timerWindow)
}

function toggleTimerWindow() {
  const currentlyVisible = Boolean(timerWindow && !timerWindow.isDestroyed() && timerWindow.isVisible())
  setTimerOverlayVisible(!currentlyVisible)
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  // Desktop always reads the current server build and must never remain controlled by a PWA worker.
  await session.defaultSession.clearCache()
  await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] })
  createMainWindow()
  globalShortcut.register('CommandOrControl+Shift+M', toggleTimerWindow)
})

ipcMain.on('memory-anki-timer-collapse', (_event, collapsed) => {
  const width = collapsed ? 280 : 320
  const height = collapsed ? 64 : 196
  timerWindowBounds = { ...timerWindowBounds, width, height }
  if (!timerWindow || timerWindow.isDestroyed()) return
  timerWindow.setSize(width, height)
})

ipcMain.on('memory-anki-timer-snapshot', (_event, snapshot) => {
  lastTimerSnapshot = snapshot
  if (!timerWindow || timerWindow.isDestroyed()) return
  timerWindow.webContents.send('memory-anki-timer-snapshot', snapshot)
})

ipcMain.on('memory-anki-timer-command', (_event, command) => {
  const supportedCommands = new Set(['start', 'pause', 'resume', 'collapse', 'closeOverlay', 'showOverlay', 'openTimerSettings'])
  if (!command || typeof command.type !== 'string' || !supportedCommands.has(command.type)) return
  if (command?.type === 'closeOverlay') {
    setTimerOverlayVisible(false)
    return
  }
  if (command?.type === 'showOverlay') {
    setTimerOverlayVisible(true)
    return
  }
  if (command?.type === 'collapse') {
    const collapsed = Boolean(command.collapsed)
    const width = collapsed ? 280 : 320
    const height = collapsed ? 64 : 196
    timerWindowBounds = { ...timerWindowBounds, width, height }
    if (timerWindow && !timerWindow.isDestroyed()) {
      timerWindow.setSize(width, height)
    }
    return
  }
  if (command?.type === 'openTimerSettings') {
    ensureMainWindow()
  }
  mainWindow?.webContents.send('memory-anki-timer-command', command)
})

ipcMain.on('memory-anki-desktop-flush-complete', (_event, result) => {
  if (!pendingFlush || result?.requestId !== pendingFlush.requestId) return
  pendingFlush.resolve({
    ok: Boolean(result.ok),
    errors: Array.isArray(result.errors) ? result.errors : [],
  })
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
  ensureTimerWindow()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
