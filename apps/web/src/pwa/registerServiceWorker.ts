import { toast } from 'sonner'

const PWA_CONTROLLER_RELOAD_KEY = 'memory-anki-pwa-controller-reload'

let hasUserInteracted = false

function requestSkipWaiting(worker: ServiceWorker | null) {
  worker?.postMessage({ type: 'SKIP_WAITING' })
}

export function shouldAutoReloadForControllerChange({
  userInteracted,
}: {
  pathname?: string
  userInteracted: boolean
}) {
  return !userInteracted
}

function installUserInteractionTracking() {
  const markInteracted = () => {
    hasUserInteracted = true
  }
  window.addEventListener('pointerdown', markInteracted, { once: true, passive: true })
  window.addEventListener('touchstart', markInteracted, { once: true, passive: true })
  window.addEventListener('keydown', markInteracted, { once: true })
}

function installControllerChangeReload() {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (
      !shouldAutoReloadForControllerChange({
        pathname: window.location.pathname,
        userInteracted: hasUserInteracted,
      })
    ) {
      if (hasUserInteracted) {
        console.info(
          '[memory-anki] PWA update installed. Restart the PWA to apply it without interrupting the current session.',
        )
        toast.info('新版本已准备好', {
          description: '当前学习不会被打断；空闲时刷新即可切换到新版。',
          duration: 12_000,
          action: {
            label: '立即刷新',
            onClick: () => window.location.reload(),
          },
        })
      }
      return
    }
    try {
      if (window.sessionStorage.getItem(PWA_CONTROLLER_RELOAD_KEY) === '1') return
      window.sessionStorage.setItem(PWA_CONTROLLER_RELOAD_KEY, '1')
    } catch {
      // If sessionStorage is unavailable, prefer one refresh over leaving an old iOS PWA shell active.
    }
    window.location.reload()
  })
}

export function registerServiceWorker() {
  if (typeof window === 'undefined') return
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  installUserInteractionTracking()
  installControllerChangeReload()

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        requestSkipWaiting(registration.waiting)

        registration.addEventListener('updatefound', () => {
          const worker = registration.installing
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              requestSkipWaiting(worker)
            }
          })
        })

        return registration.update()
      })
      .catch((error) => {
        console.info('[memory-anki] PWA service worker registration skipped.', error)
      })
  })
}
