const RELEASE_ID = '__MEMORY_ANKI_RELEASE_ID__'
const APP_CACHE = `memory-anki-pwa-app-${RELEASE_ID}`
const API_CACHE = `memory-anki-pwa-api-${RELEASE_ID}`
const CACHE_PREFIX = 'memory-anki-pwa-'
const LEGACY_CACHE_PREFIX = 'memory-anki-mobile-'
const PRECACHE_URLS = ['/', '/freestyle', '/pwa-reset.html', '/offline.html', '/manifest.webmanifest', '/release.json', '/favicon.svg', '/pwa-icon.svg']
const ZERO_COUNTS = { quiz_question: 0, review: 0, practice: 0, english: 0, english_reading: 0 }

async function precacheCurrentRelease() {
  const cache = await caches.open(APP_CACHE)
  await Promise.allSettled(PRECACHE_URLS.map(async (url) => {
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

function isSameOrigin(url) { return url.origin === self.location.origin }
function isFreestyleFeed(url) { return url.pathname === '/api/v1/freestyle/feed' }
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

async function networkFirstFreestyleFeed(request) {
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
    if (response.ok) await cache.put(request, response.clone())
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
  if (isFreestyleFeed(url)) { event.respondWith(networkFirstFreestyleFeed(request)); return }
  if (isStaticAsset(request, url)) event.respondWith(currentReleaseAsset(request))
})
