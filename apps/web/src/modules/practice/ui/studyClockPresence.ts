/**
 * Whether the person is still with this study window.
 *
 * A visible page counts even when document.hasFocus() is false. The desktop
 * window often fails that flag while the person is looking at the card.
 * The desktop shell's own window focus is the reliable signal when it is
 * present. A short leave still counts; a longer absence is not backfilled.
 */

export const STUDY_AWAY_GRACE_MS = 3 * 60 * 1000

type Listener = () => void

const listeners = new Set<Listener>()
let started = false
let desktopFocused: boolean | null = null
let awaySinceMs: number | null = null
let stopDesktop: (() => void) | null = null
let graceTimer = 0

function desktopBridge() {
  if (typeof window === 'undefined') return null
  return window.memoryAnkiDesktopTimer ?? null
}

function documentVisible() {
  return typeof document !== 'undefined' && document.visibilityState !== 'hidden'
}

/** The window is the one they are using right now, not merely inside the grace. */
export function isStudyWindowPresent() {
  if (!documentVisible()) return false
  if (desktopFocused === false) return false
  return true
}

function noteAbsence(now = Date.now()) {
  if (isStudyWindowPresent()) {
    awaySinceMs = null
    window.clearTimeout(graceTimer)
    graceTimer = 0
    return true
  }
  if (awaySinceMs == null) awaySinceMs = now
  const remain = STUDY_AWAY_GRACE_MS - (now - awaySinceMs)
  window.clearTimeout(graceTimer)
  graceTimer = remain > 0
    ? window.setTimeout(() => {
      graceTimer = 0
      emit()
    }, remain)
    : 0
  return remain >= 0
}

/** Pure snapshot for React. Absence is recorded by events and clock ticks. */
export function readStudyClockCounting() {
  if (isStudyWindowPresent()) return true
  if (awaySinceMs == null) return false
  return Date.now() - awaySinceMs <= STUDY_AWAY_GRACE_MS
}

export function isStudyClockCounting(now = Date.now()) {
  return noteAbsence(now)
}

function emit() {
  for (const listener of listeners) listener()
}

function onBrowserChange() {
  noteAbsence()
  emit()
}

function attachDesktop() {
  stopDesktop?.()
  stopDesktop = null
  const bridge = desktopBridge()
  if (!bridge?.onMainWindowFocusChange) return
  stopDesktop = bridge.onMainWindowFocusChange((active) => {
    desktopFocused = Boolean(active)
    onBrowserChange()
  })
}

function ensureStarted() {
  if (started || typeof document === 'undefined') return
  started = true
  document.addEventListener('visibilitychange', onBrowserChange)
  window.addEventListener('pagehide', onBrowserChange)
  window.addEventListener('focus', onBrowserChange)
  window.addEventListener('blur', onBrowserChange)
  attachDesktop()
}

export function subscribeStudyClockPresence(listener: Listener) {
  ensureStarted()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetStudyClockPresenceForTests() {
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onBrowserChange)
    window.removeEventListener('pagehide', onBrowserChange)
    window.removeEventListener('focus', onBrowserChange)
    window.removeEventListener('blur', onBrowserChange)
  }
  window.clearTimeout(graceTimer)
  graceTimer = 0
  stopDesktop?.()
  stopDesktop = null
  listeners.clear()
  awaySinceMs = null
  desktopFocused = null
  started = false
}

export function setStudyClockDesktopFocusedForTests(focused: boolean | null) {
  desktopFocused = focused
  onBrowserChange()
}
