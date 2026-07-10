import { toast } from '@/shared/feedback/toast'

const PWA_CONTROLLER_RELOAD_KEY = 'memory-anki-pwa-controller-reload'
const USER_IDLE_MS = 30_000
const RELEASE_CHECK_MS = 60_000
let lastInteractionAt = 0
let updateReady = false
let reloadScheduled = false

function isDesktopClient() { return window.memoryAnkiDesktopTimer?.isDesktop === true }
function requestSkipWaiting(worker: ServiceWorker | null) { worker?.postMessage({ type: 'SKIP_WAITING' }) }
function isUserActive(now = Date.now()) { return document.visibilityState === 'visible' && now - lastInteractionAt < USER_IDLE_MS }

export function shouldAutoReloadForControllerChange({ userInteracted }: { pathname?: string; userInteracted: boolean }) {
  return !userInteracted
}

function reloadOnce() {
  if (reloadScheduled) return
  reloadScheduled = true
  try {
    if (window.sessionStorage.getItem(PWA_CONTROLLER_RELOAD_KEY) === __MEMORY_ANKI_RELEASE_ID__) return
    window.sessionStorage.setItem(PWA_CONTROLLER_RELOAD_KEY, __MEMORY_ANKI_RELEASE_ID__)
  } catch { /* prefer one reload when storage is unavailable */ }
  window.location.reload()
}

function applyReadyUpdateWhenIdle() {
  if (!updateReady || isUserActive()) return
  reloadOnce()
}

function announceReadyUpdate() {
  updateReady = true
  if (!isUserActive()) { reloadOnce(); return }
  toast.info('新版本已准备好', {
    description: '当前操作不会被打断；停止操作 30 秒后自动刷新。',
    duration: Infinity,
    action: { label: '立即刷新', onClick: reloadOnce },
  })
}

function installActivityTracking() {
  const markActivity = () => { lastInteractionAt = Date.now() }
  window.addEventListener('pointerdown', markActivity, { passive: true })
  window.addEventListener('touchstart', markActivity, { passive: true })
  window.addEventListener('keydown', markActivity)
  window.setInterval(applyReadyUpdateWhenIdle, 5_000)
}

async function checkRelease(registration: ServiceWorkerRegistration) {
  try {
    const response = await fetch('/release.json', { cache: 'no-store' })
    if (!response.ok) return
    const release = await response.json() as { releaseId?: string }
    if (release.releaseId && release.releaseId !== __MEMORY_ANKI_RELEASE_ID__) {
      await registration.update()
      requestSkipWaiting(registration.waiting)
    }
  } catch { /* offline checks are retried later */ }
}

export function registerServiceWorker() {
  if (typeof window === 'undefined' || !import.meta.env.PROD || !('serviceWorker' in navigator)) return
  if (isDesktopClient()) {
    void navigator.serviceWorker.getRegistrations().then((items) => Promise.all(items.map((item) => item.unregister())))
    return
  }

  installActivityTracking()
  navigator.serviceWorker.addEventListener('controllerchange', announceReadyUpdate)

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registration) => {
      requestSkipWaiting(registration.waiting)
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) requestSkipWaiting(worker)
        })
      })
      const runCheck = () => void checkRelease(registration)
      runCheck()
      window.setInterval(runCheck, RELEASE_CHECK_MS)
      window.addEventListener('online', runCheck)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') { runCheck(); applyReadyUpdateWhenIdle() }
      })
    }).catch((error) => console.info('[memory-anki] PWA service worker registration skipped.', error))
  })
}
