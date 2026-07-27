const RELEASE_ID = '__MEMORY_ANKI_RELEASE_ID__'
const APP_CACHE = `memory-anki-pwa-app-${RELEASE_ID}`
const API_CACHE = `memory-anki-pwa-api-${RELEASE_ID}`
const CACHE_PREFIX = 'memory-anki-pwa-'
const LEGACY_CACHE_PREFIX = 'memory-anki-mobile-'
const PRECACHE_URLS = [
  '/',
  '/freestyle',
  '/pwa-reset.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/release.json',
  '/favicon.svg',
  '/pwa-icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
]
// 构建时由 releaseArtifactsPlugin 注入本次发布的入口链路资产（JS/CSS），
// 使离线冷启动不依赖运行时缓存。未注入（dev/测试）时保持为空数组。
const PRECACHE_RELEASE_ASSETS = '__MEMORY_ANKI_PRECACHE_ASSETS__'
// 离线可回退的只读 API 白名单；除 freestyle feed 外暂不扩展，
// 避免 SRS 调度数据离线陈旧误导复习决策。
const OFFLINE_API_ALLOWLIST = ['/api/v1/freestyle/feed']
// 导航响应只回写这两个入口路径，避免 APP_CACHE 积累任意页面路径。
const NAVIGATION_CACHE_PATHS = ['/', '/freestyle']
const ZERO_COUNTS = { quiz_question: 0, review: 0, practice: 0, english: 0, english_reading: 0 }

function releaseAssetUrls() {
  if (!Array.isArray(PRECACHE_RELEASE_ASSETS)) return []
  return PRECACHE_RELEASE_ASSETS.filter((url) => typeof url === 'string' && url.startsWith('/assets/'))
}

async function precacheCurrentRelease() {
  const cache = await caches.open(APP_CACHE)
  const urls = [...PRECACHE_URLS, ...releaseAssetUrls()]
  await Promise.allSettled(urls.map(async (url) => {
    const response = await fetch(new Request(url, { cache: 'reload' }))
    if (!response.ok) throw new Error(`Precache failed: ${url} (${response.status})`)
    await cache.put(url, response)
  }))
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheCurrentRelease().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key !== APP_CACHE && key !== API_CACHE)
    .filter((key) => key.startsWith(CACHE_PREFIX) || key.startsWith(LEGACY_CACHE_PREFIX))
    .map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

// Break reminders are shown via registration.showNotification so they survive
// the page being backgrounded (the only path that works in an installed PWA).
// Clicking one must focus the existing window rather than opening a second copy.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || '/'
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clientList) {
      if ('focus' in client) return client.focus()
    }
    if (self.clients.openWindow) return self.clients.openWindow(target)
  })())
})

function isSameOrigin(url) { return url.origin === self.location.origin }
function isOfflineCapableApi(url) { return OFFLINE_API_ALLOWLIST.includes(url.pathname) }
function isVersionMetadata(url) { return url.pathname === '/release.json' || url.pathname === '/sw.js' }
function isStaticAsset(request, url) {
  return url.pathname.startsWith('/assets/') || request.destination === 'script' || request.destination === 'style' || request.destination === 'image' || request.destination === 'font' || request.destination === 'manifest'
}

async function cachedFreestyleFallback(request) {
  const cache = await caches.open(API_CACHE)
  const exact = await cache.match(request)
  if (exact) return exact
  const keys = await cache.keys()
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const candidate = keys[index]
    if (new URL(candidate.url).pathname === '/api/v1/freestyle/feed') {
      const response = await cache.match(candidate)
      if (response) return response
    }
  }
  return new Response(JSON.stringify({ cards: [], counts: ZERO_COUNTS, generated_at: new Date().toISOString(), offline: true }), {
    status: 200,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  })
}

async function networkFirstOfflineApi(request) {
  const cache = await caches.open(API_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch {
    return cachedFreestyleFallback(request)
  }
}

async function currentReleaseAsset(request) {
  const cache = await caches.open(APP_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (!response.ok) throw new Error(`Current release asset unavailable: ${new URL(request.url).pathname}`)
  await cache.put(request, response.clone())
  return response
}

async function navigationFallback(request) {
  const cache = await caches.open(APP_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok && NAVIGATION_CACHE_PATHS.includes(new URL(request.url).pathname)) {
      await cache.put(request, response.clone())
    }
    return response
  } catch {
    return (await cache.match('/freestyle')) || (await cache.match('/')) || (await cache.match('/offline.html')) || Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (!isSameOrigin(url)) return
  if (request.mode === 'navigate') { event.respondWith(navigationFallback(request)); return }
  if (isVersionMetadata(url)) { event.respondWith(fetch(new Request(request, { cache: 'no-store' }))); return }
  if (isOfflineCapableApi(url)) { event.respondWith(networkFirstOfflineApi(request)); return }
  if (isStaticAsset(request, url)) event.respondWith(currentReleaseAsset(request))
})
