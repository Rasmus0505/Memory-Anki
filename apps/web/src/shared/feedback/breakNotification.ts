const BREAK_NOTIFICATION_TAG = 'memory-anki-break-expired'

export function canShowBreakNotification() {
  return typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
}

/**
 * `navigator.serviceWorker.ready` never settles when nothing is registered —
 * exactly the Electron case — so it must be raced against a deadline or the
 * fallback below would never run.
 */
async function readyServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1_000)),
  ])
  return registration
}

/**
 * Show the "break is over" reminder.
 *
 * Prefers `registration.showNotification`, the only path that reaches the user
 * once an installed PWA is backgrounded. Falls back to a page-level
 * `new Notification` for the Electron overlay, where the service worker is
 * deliberately unregistered (see pwa/registerServiceWorker.ts).
 */
export async function notifyBreakExpired(
  title = '休息时间到了',
  body = '准备好后手动开始下一轮学习。',
) {
  if (!canShowBreakNotification()) return false

  const options: NotificationOptions = {
    body,
    // Replaces any earlier reminder instead of stacking duplicates.
    tag: BREAK_NOTIFICATION_TAG,
    icon: '/icons/icon-192.png',
    data: { url: '/' },
  }

  try {
    const registration = await readyServiceWorker()
    if (registration?.showNotification) {
      await registration.showNotification(title, options)
      return true
    }
  } catch {
    // Fall through to the page-level notification below.
  }

  try {
    new Notification(title, options)
    return true
  } catch {
    return false
  }
}
