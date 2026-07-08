const PWA_CACHE_PREFIXES = ['memory-anki-pwa-', 'memory-anki-mobile-'] as const
const ROOT_SERVICE_WORKER_SCOPE_PATH = '/'

export interface PwaResetResult {
  unregisteredServiceWorkers: number
  deletedCaches: number
}

function isTargetPwaCache(cacheName: string) {
  return PWA_CACHE_PREFIXES.some((prefix) => cacheName.startsWith(prefix))
}

function isRootScopedRegistration(registration: ServiceWorkerRegistration) {
  return new URL(registration.scope).pathname === ROOT_SERVICE_WORKER_SCOPE_PATH
}

export async function resetPwaRuntime(): Promise<PwaResetResult> {
  let unregisteredServiceWorkers = 0
  let deletedCaches = 0

  if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    const unregisterResults = await Promise.all(
      registrations.filter(isRootScopedRegistration).map((registration) => registration.unregister()),
    )
    unregisteredServiceWorkers = unregisterResults.filter(Boolean).length
  }

  if ('caches' in window) {
    const cacheNames = await window.caches.keys()
    const deleteResults = await Promise.all(
      cacheNames.filter(isTargetPwaCache).map((cacheName) => window.caches.delete(cacheName)),
    )
    deletedCaches = deleteResults.filter(Boolean).length
  }

  return {
    unregisteredServiceWorkers,
    deletedCaches,
  }
}
