export function registerServiceWorker() {
  if (typeof window === 'undefined') return
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.info('[memory-anki] PWA service worker registration skipped.', error)
    })
  })
}
