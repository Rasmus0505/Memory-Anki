import { toast } from '@/shared/feedback/toast'

const PWA_CONTROLLER_RELOAD_KEY = 'memory-anki-pwa-controller-reload'
const RELEASE_CHECK_MS = 60_000
let updateReady = false
let reloadScheduled = false

function isDesktopClient() { return window.memoryAnkiDesktopTimer?.isDesktop === true }
function requestSkipWaiting(worker: ServiceWorker | null) { worker?.postMessage({ type: 'SKIP_WAITING' }) }

function reloadOnce() {
  if (reloadScheduled) return
  reloadScheduled = true
  try {
    if (window.sessionStorage.getItem(PWA_CONTROLLER_RELOAD_KEY) === __MEMORY_ANKI_RELEASE_ID__) return
    window.sessionStorage.setItem(PWA_CONTROLLER_RELOAD_KEY, __MEMORY_ANKI_RELEASE_ID__)
  } catch { /* prefer one reload when storage is unavailable */ }
  window.location.reload()
}

/**
 * A ready update never reloads the page on its own.
 *
 * Reloading in place throws away everything the learner is holding: the open
 * quiz, the half-rated card, the palace map they are reading. Because "idle"
 * (no touch for 30s) looked exactly like reading a palace, the old policy could
 * reload the moment the user opened 查看宫殿 and stopped touching the screen —
 * the page flashed back to 随心. The new release is picked up by the next launch
 * of the installed app (a fresh document gets the new worker's shell), or when
 * the learner taps 立即刷新 on the update notice.
 */
export function shouldAutoReloadForControllerChange(_input: {
  pathname?: string
  userInteracted: boolean
}): boolean {
  return false
}

function announceReadyUpdate() {
  if (updateReady) return
  updateReady = true
  toast.info('新版本已准备好', {
    description: '当前学习不会被打断；下次打开应用时生效，也可以点「立即刷新」。',
    duration: Infinity,
    action: { label: '立即刷新', onClick: reloadOnce },
  })
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
      // 后台标签页跳过轮询（省电省流量）；回到前台时 visibilitychange 会立即补查。
      window.setInterval(() => {
        if (document.visibilityState === 'visible') runCheck()
      }, RELEASE_CHECK_MS)
      window.addEventListener('online', runCheck)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') runCheck()
      })
    }).catch((error) => console.info('[memory-anki] PWA service worker registration skipped.', error))
  })
}
