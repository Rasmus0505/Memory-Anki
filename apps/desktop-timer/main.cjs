const { app, BrowserWindow, globalShortcut, ipcMain, shell } = require('electron')
const path = require('node:path')

const APP_URL = process.env.MEMORY_ANKI_DESKTOP_URL || 'http://127.0.0.1:5173/'
const OVERLAY_URL = process.env.MEMORY_ANKI_TIMER_OVERLAY_URL || `${APP_URL.replace(/\/$/, '')}/timer-overlay`

let mainWindow = null
let timerWindow = null
let lastTimerSnapshot = null
let mainBlurPromptTimer = null
let pendingFlush = null
let allowMainWindowClose = false

const FLUSH_TIMEOUT_MS = 1800

function clearMainBlurPromptTimer() {
  if (mainBlurPromptTimer == null) return
  clearTimeout(mainBlurPromptTimer)
  mainBlurPromptTimer = null
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

function scheduleExternalMainBlurPrompt() {
  clearMainBlurPromptTimer()
  mainBlurPromptTimer = setTimeout(() => {
    mainBlurPromptTimer = null
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isFocused()) return
    const focusedWindow = BrowserWindow.getFocusedWindow()
    if (focusedWindow && focusedWindow === timerWindow) return
    mainWindow.webContents.send('memory-anki-main-window-blur')
    mainWindow.webContents.send('memory-anki-timer-command', { type: 'promptBreak' })
  }, 100)
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: 'Memory Anki',
    backgroundColor: '#fffaf2',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  mainWindow.loadURL(APP_URL)
  mainWindow.on('close', (event) => {
    if (allowMainWindowClose) return
    event.preventDefault()
    closeMainWindowAfterFlush('main_window_close')
  })
  mainWindow.on('blur', () => {
    scheduleExternalMainBlurPrompt()
  })
  mainWindow.on('focus', () => {
    clearMainBlurPromptTimer()
    mainWindow?.webContents.send('memory-anki-timer-command', { type: 'returnToStudy' })
  })
  mainWindow.on('closed', () => {
    clearMainBlurPromptTimer()
    allowMainWindowClose = false
    mainWindow = null
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function createTimerWindow() {
  timerWindow = new BrowserWindow({
    width: 320,
    height: 180,
    minWidth: 220,
    minHeight: 52,
    x: 80,
    y: 80,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Memory Anki 计时器',
    backgroundColor: '#00000000',
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  timerWindow.setAlwaysOnTop(true, 'screen-saver')
  timerWindow.loadURL(OVERLAY_URL)
  timerWindow.webContents.on('did-finish-load', () => {
    if (lastTimerSnapshot) {
      timerWindow?.webContents.send('memory-anki-timer-snapshot', lastTimerSnapshot)
    }
  })
  timerWindow.on('closed', () => {
    timerWindow = null
  })
}

function ensureMainWindow() {
  if (!mainWindow) createMainWindow()
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
}

function ensureTimerWindow() {
  if (!timerWindow) createTimerWindow()
  timerWindow?.show()
  timerWindow?.moveTop()
}

function toggleTimerWindow() {
  if (!timerWindow) {
    createTimerWindow()
    return
  }
  if (timerWindow.isVisible()) {
    timerWindow.hide()
    return
  }
  ensureTimerWindow()
}

app.whenReady().then(() => {
  createMainWindow()
  createTimerWindow()
  globalShortcut.register('CommandOrControl+Shift+M', toggleTimerWindow)
})

ipcMain.on('memory-anki-timer-collapse', (_event, collapsed) => {
  if (!timerWindow) return
  if (collapsed) {
    timerWindow.setSize(230, 56)
    return
  }
  timerWindow.setSize(320, 180)
})

ipcMain.on('memory-anki-timer-snapshot', (_event, snapshot) => {
  lastTimerSnapshot = snapshot
  timerWindow?.webContents.send('memory-anki-timer-snapshot', snapshot)
})

ipcMain.on('memory-anki-timer-command', (_event, command) => {
  if (command?.type === 'collapse') {
    const collapsed = Boolean(command.collapsed)
    if (timerWindow) {
      timerWindow.setSize(collapsed ? 230 : 320, collapsed ? 56 : 180)
    }
    return
  }
  if (command?.type === 'openTarget' || (command?.type === 'finishBreak' && command.openTarget)) {
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

ipcMain.on('memory-anki-request-main-pause', () => {
  mainWindow?.webContents.send('memory-anki-desktop-pause-active-timer')
})

ipcMain.on('memory-anki-open-main-target', (_event, targetPath) => {
  const safePath = typeof targetPath === 'string' && targetPath.startsWith('/') ? targetPath : '/freestyle'
  ensureMainWindow()
  mainWindow?.loadURL(`${APP_URL.replace(/\/$/, '')}${safePath}`)
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
  clearMainBlurPromptTimer()
  globalShortcut.unregisterAll()
})
