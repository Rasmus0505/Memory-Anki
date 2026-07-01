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

contextBridge.exposeInMainWorld('memoryAnkiDesktopTimer', {
  onDesktopFlushRequest(handler) {
    desktopFlushHandlers.add(handler)
    return () => desktopFlushHandlers.delete(handler)
  },
  onMainWindowBlur(handler) {
    const listener = () => handler()
    ipcRenderer.on('memory-anki-main-window-blur', listener)
    return () => ipcRenderer.removeListener('memory-anki-main-window-blur', listener)
  },
  onPauseActiveTimer(handler) {
    const listener = () => handler()
    ipcRenderer.on('memory-anki-desktop-pause-active-timer', listener)
    return () => ipcRenderer.removeListener('memory-anki-desktop-pause-active-timer', listener)
  },
  requestMainPause() {
    ipcRenderer.send('memory-anki-request-main-pause')
  },
  openMainTarget(path) {
    ipcRenderer.send('memory-anki-open-main-target', path)
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
