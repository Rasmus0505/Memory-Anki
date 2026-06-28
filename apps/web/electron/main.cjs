const { app, BrowserWindow, globalShortcut, shell } = require('electron')

const DEFAULT_URL = process.env.MEMORY_ANKI_DESKTOP_URL || 'http://127.0.0.1:5173/'
const OVERLAY_URL = process.env.MEMORY_ANKI_OVERLAY_URL || DEFAULT_URL

let overlayWindow = null

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 420,
    height: 360,
    x: 80,
    y: 80,
    frame: false,
    transparent: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Memory Anki 休息守护',
    backgroundColor: '#fffaf2',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.loadURL(OVERLAY_URL)
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })

  overlayWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function toggleOverlayWindow() {
  if (!overlayWindow) {
    createOverlayWindow()
    return
  }
  if (overlayWindow.isVisible()) {
    overlayWindow.hide()
    return
  }
  overlayWindow.show()
  overlayWindow.moveTop()
}

app.whenReady().then(() => {
  createOverlayWindow()
  globalShortcut.register('CommandOrControl+Shift+M', toggleOverlayWindow)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (!overlayWindow) {
    createOverlayWindow()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
