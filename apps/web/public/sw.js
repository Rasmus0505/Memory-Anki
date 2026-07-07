const CACHE_VERSION = '2026-07-07-mobile-pwa-v2'
const APP_CACHE = `memory-anki-pwa-app-${CACHE_VERSION}`
const API_CACHE = `memory-anki-pwa-api-${CACHE_VERSION}`
const CACHE_PREFIX = 'memory-anki-pwa-'
const LEGACY_CACHE_PREFIX = 'memory-anki-mobile-'
const PRECACHE_URLS = [
  '/',
  '/freestyle',
  '/pwa-reset.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/pwa-icon.svg',
]

const ZERO_COUNTS = {
  quiz_question: 0,
  review: 0,
  practice: 0,
  english: 0,
  english_reading: 0,
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map(async (url) => {
            const response = await fetch(new Request(url, { cache: 'reload' }))
            if (response.ok) {
              await cache.put(url, response)
            }
          }),
        ),
      )
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== APP_CACHE && key !== API_CACHE)
            .filter(
              (key) =>
                key.startsWith(CACHE_PREFIX) ||
                key.startsWith(LEGACY_CACHE_PREFIX),
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

function isSameOrigin(url) {
  return url.origin === self.location.origin
}

function isFreestyleFeed(url) {
  return url.pathname === '/api/v1/freestyle/feed'
}

function isStaticAsset(request, url) {
  return (
    url.pathname.startsWith('/assets/') ||
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font' ||
    request.destination === 'manifest'
  )
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

  return new Response(
    JSON.stringify({
      cards: [],
      counts: ZERO_COUNTS,
      generated_at: new Date().toISOString(),
      offline: true,
    }),
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
    },
  )
}

async function networkFirstFreestyleFeed(request) {
  const cache = await caches.open(API_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) {
      await cache.put(request, response.clone())
    }
    return response
  } catch {
    return cachedFreestyleFallback(request)
  }
}

async function cacheFirstStaticAsset(request) {
  const url = new URL(request.url)
  if (url.pathname === '/sw.js') {
    return fetch(request)
  }

  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(APP_CACHE)
    await cache.put(request, response.clone())
  }
  return response
}

async function navigationFallback(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(APP_CACHE)
      await cache.put(request, response.clone())
    }
    return response
  } catch {
    return (
      (await caches.match('/freestyle')) ||
      (await caches.match('/')) ||
      (await caches.match('/offline.html')) ||
      Response.error()
    )
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (!isSameOrigin(url)) return

  if (isFreestyleFeed(url)) {
    event.respondWith(networkFirstFreestyleFeed(request))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationFallback(request))
    return
  }

  if (isStaticAsset(request, url)) {
    event.respondWith(cacheFirstStaticAsset(request))
  }
})
