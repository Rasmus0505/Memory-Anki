const { contextBridge, ipcRenderer } = require('electron')

const desktopFlushHandlers = new Set()

ipcRenderer.on('memory-anki-desktop-flush-request', async (_event, request) => {
  const requestId = request?.requestId
  if (!requestId) return
  const results = await Promise.allSettled(
    Array.from(desktopFlushHandlers).map((handler) => handler(request)),
  )
  ipcRenderer.send('memory-anki-desktop-flush-complete', {
    requestId,
    ok: results.every((result) => result.status === 'fulfilled'),
    errors: results
      .filter((result) => result.status === 'rejected')
      .map((result) => String(result.reason instanceof Error ? result.reason.message : result.reason)),
  })
})

const focusHandlers = new Set()
let mainWindowFocused = true

function readMainWindowFocused() {
  try {
    return Boolean(ipcRenderer.sendSync('memory-anki-main-window-focused'))
  } catch {
    return mainWindowFocused
  }
}

ipcRenderer.on('memory-anki-main-window-focus-change', (_event, active) => {
  mainWindowFocused = Boolean(active)
  for (const handler of focusHandlers) handler(mainWindowFocused)
})

contextBridge.exposeInMainWorld('memoryAnkiDesktopTimer', {
  isDesktop: true,
  onMainWindowFocusChange(handler) {
    focusHandlers.add(handler)
    handler(readMainWindowFocused())
    return () => focusHandlers.delete(handler)
  },
  setMainWindowFullscreen(active) {
    ipcRenderer.send('memory-anki-main-window-fullscreen', Boolean(active))
  },
  onMainWindowFullscreenChange(handler) {
    const listener = (_event, active) => handler(Boolean(active))
    ipcRenderer.on('memory-anki-main-window-fullscreen-change', listener)
    return () => ipcRenderer.removeListener('memory-anki-main-window-fullscreen-change', listener)
  },
  onDesktopFlushRequest(handler) {
    desktopFlushHandlers.add(handler)
    return () => desktopFlushHandlers.delete(handler)
  },
  setOverlayCollapsed(collapsed) {
    ipcRenderer.send('memory-anki-timer-collapse', Boolean(collapsed))
  },
  publishTimerSnapshot(snapshot) {
    ipcRenderer.send('memory-anki-timer-snapshot', snapshot)
  },
  onTimerSnapshot(handler) {
    const listener = (_event, snapshot) => handler(snapshot)
    ipcRenderer.on('memory-anki-timer-snapshot', listener)
    return () => ipcRenderer.removeListener('memory-anki-timer-snapshot', listener)
  },
  sendTimerCommand(command) {
    ipcRenderer.send('memory-anki-timer-command', command)
  },
  onTimerCommand(handler) {
    const listener = (_event, command) => handler(command)
    ipcRenderer.on('memory-anki-timer-command', listener)
    return () => ipcRenderer.removeListener('memory-anki-timer-command', listener)
  },
})
