const RELEASE_ID = '__MEMORY_ANKI_RELEASE_ID__'
const APP_CACHE = `memory-anki-pwa-app-${RELEASE_ID}`
const API_CACHE = `memory-anki-pwa-api-${RELEASE_ID}`
const CACHE_PREFIX = 'memory-anki-pwa-'
const LEGACY_CACHE_PREFIX = 'memory-anki-mobile-'
const APP_CACHE_PREFIX = `${CACHE_PREFIX}app-`
const API_CACHE_PREFIX = `${CACHE_PREFIX}api-`
const RETAINED_APP_CACHE_GENERATIONS = 2
// The shell and every release asset are required before this worker may take
// control. Activating a partial generation leaves a cached HTML shell whose
// module graph cannot start after a network interruption.
const CORE_PRECACHE_URLS = [
  '/',
  '/freestyle',
  '/offline.html',
]
// Recovery affordances are useful, but an icon or metadata timeout must not
// prevent an otherwise complete application release from activating.
const AUXILIARY_PRECACHE_URLS = [
  '/pwa-reset.html',
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
// 网络超时预算。没有超时的 fetch 在半开连接（手机休眠、Tailscale 重连）下会永久挂住，
// 于是导航永远等不到网络、也永远走不到缓存兜底 —— 表现为 PWA 一直打不开，且清缓存无效。
// 导航给最短预算：有缓存外壳时，宁可先显示上一版，也不要白屏。
const NAVIGATION_TIMEOUT_MS = 4_000
// 缓存为空的冷启动没有外壳可显示，只能继续等网络；4s 会把慢链路上的首次安装判死刑。
const NAVIGATION_COLD_START_TIMEOUT_MS = 20_000
const ASSET_TIMEOUT_MS = 8_000
const API_TIMEOUT_MS = 8_000
// iOS Safari and Tailscale Serve can queue a large burst of requests behind a
// single connection. Keep release installation bounded without making it
// serial, so one slow asset cannot starve every other startup request.
const PRECACHE_CONCURRENCY = 6
const NAVIGATION_TIMED_OUT = { timedOut: true }

/** 全文件唯一的裸 fetch 出口：永不 reject，失败即 null。 */
async function startFetch(request, signal) {
  const input = signal ? new Request(request, { signal }) : request
  try {
    const response = await fetch(input)
    // Fetch resolves as soon as response headers arrive. Read a clone before
    // returning so the caller's deadline also covers a half-open response body.
    await response.clone().arrayBuffer()
    return response
  } catch {
    return null
  }
}

/**
 * 有界 fetch：返回响应，或在失败/超时时返回 null。永远不 reject，
 * 让每个调用方都能明确地回退到缓存，而不是把异常抛进 respondWith。
 */
function fetchWithin(request, timeoutMs) {
  const controller = new AbortController()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      controller.abort()
      resolve(null)
    }, timeoutMs)
    startFetch(request, controller.signal).then((response) => {
      clearTimeout(timer)
      resolve(response)
    })
  })
}

function waitForResponseWithin(response, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(NAVIGATION_TIMED_OUT), timeoutMs)
    response.then((value) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

function startAbortableFetch(request) {
  const controller = new AbortController()
  return {
    response: startFetch(request, controller.signal),
    abort: () => controller.abort(),
  }
}

function cachePutWithin(cache, request, response, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    const settle = (stored) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(stored)
    }
    const timer = setTimeout(() => settle(false), timeoutMs)
    try {
      Promise.resolve(cache.put(request, response)).then(() => settle(true), () => settle(false))
    } catch {
      settle(false)
    }
  })
}

function cacheRuntimeResponse(cache, request, response) {
  // Cache writes must never turn an already-valid network response into a
  // failed page load. Safari may reject these under storage pressure.
  void cachePutWithin(cache, request, response.clone(), ASSET_TIMEOUT_MS)
}

function releaseAssetUrls() {
  if (!Array.isArray(PRECACHE_RELEASE_ASSETS)) return []
  return PRECACHE_RELEASE_ASSETS.filter((url) => typeof url === 'string' && url.startsWith('/assets/'))
}

function appCacheNamesToKeep(cacheNames) {
  const previous = cacheNames
    .filter((name) => name.startsWith(APP_CACHE_PREFIX) && name !== APP_CACHE)
    .sort((left, right) => right.localeCompare(left))
    .slice(0, RETAINED_APP_CACHE_GENERATIONS - 1)
  return new Set([APP_CACHE, ...previous])
}

async function cachedCurrentOrPreviousAsset(cache, request) {
  const current = await cache.match(request)
  if (current) return current
  const cacheNamesToKeep = appCacheNamesToKeep(await caches.keys())
  for (const cacheName of cacheNamesToKeep) {
    if (cacheName === APP_CACHE) continue
    const previous = await (await caches.open(cacheName)).match(request)
    if (previous) return previous
  }
  return null
}

async function runWithConcurrency(urls, worker) {
  if (!urls.length) return
  let cursor = 0
  const workerCount = Math.min(PRECACHE_CONCURRENCY, urls.length)
  const results = await Promise.allSettled(Array.from({ length: workerCount }, async () => {
    while (cursor < urls.length) {
      const index = cursor
      cursor += 1
      await worker(urls[index])
    }
  }))
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
}

async function precacheCurrentRelease() {
  const cache = await caches.open(APP_CACHE)
  const cacheUrl = async (url) => {
    // 有界抓取：否则单个挂住的请求会把新 worker 永久钉在 installing 状态。
    const response = await fetchWithin(new Request(url, { cache: 'reload' }), ASSET_TIMEOUT_MS)
    if (!response || !response.ok) throw new Error(`Precache failed: ${url} (${response ? response.status : 'timeout'})`)
    if (!await cachePutWithin(cache, url, response, ASSET_TIMEOUT_MS)) {
      throw new Error(`Precache cache write failed: ${url}`)
    }
  }
  const coreUrls = [...CORE_PRECACHE_URLS, ...releaseAssetUrls()]
  try {
    // Do not replace a working release with an incomplete cache generation.
    await runWithConcurrency(coreUrls, cacheUrl)
  } catch (error) {
    await caches.delete(APP_CACHE)
    throw error
  }
  // Recovery links and icons are best-effort; the shell must remain installable
  // when one optional asset is unavailable on a constrained mobile network.
  await runWithConcurrency(AUXILIARY_PRECACHE_URLS, cacheUrl).catch(() => undefined)
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheCurrentRelease().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => {
    const retainedAppCaches = appCacheNamesToKeep(keys)
    return Promise.all(keys
      .filter((key) => {
        if (key.startsWith(APP_CACHE_PREFIX)) return !retainedAppCaches.has(key)
        if (key.startsWith(API_CACHE_PREFIX)) return key !== API_CACHE
        return key.startsWith(CACHE_PREFIX) || key.startsWith(LEGACY_CACHE_PREFIX)
      })
      .map((key) => caches.delete(key)))
  }).then(() => self.clients.claim()))
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
function isLiveStudyStream(url) { return url.pathname.startsWith('/api/v1/session/live') }
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
  const response = await fetchWithin(request, API_TIMEOUT_MS)
  if (!response) return cachedFreestyleFallback(request)
  if (response.ok) cacheRuntimeResponse(cache, request, response)
  return response
}

async function currentReleaseAsset(request) {
  const cache = await caches.open(APP_CACHE)
  const cached = await cachedCurrentOrPreviousAsset(cache, request)
  if (cached) return cached
  // `cache: 'reload'` 绕过浏览器 HTTP 缓存。APP_CACHE 按 RELEASE_ID 分代只保证必然 miss，
  // 不保证 miss 之后拿到的是新字节：这里的文件名不是内容寻址，且 /assets/* 没有 cache-control，
  // 旧字节会被 cache.put 洗进新一代缓存里。precacheCurrentRelease 早已这么做，此处对齐。
  const response = await fetchWithin(new Request(request, { cache: 'reload' }), ASSET_TIMEOUT_MS)
  // 不再抛异常：抛进 respondWith 会让 import() 直接失败并炸掉整条路由。
  // 有响应就原样返回（哪怕 404），让 lazyWithRetry / RouteErrorBoundary 拿到可读的错误。
  if (!response) {
    return new Response('', {
      status: 504,
      statusText: 'Asset fetch timed out',
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  if (response.ok) cacheRuntimeResponse(cache, request, response)
  return response
}

async function navigationFallback(request) {
  const cache = await caches.open(APP_CACHE)
  // 这里原来是裸 fetch：网络挂住时它永不 settle，缓存外壳永远轮不到，PWA 白屏到底。
  const network = startAbortableFetch(request)
  const settle = async (response) => {
    if (response.ok && NAVIGATION_CACHE_PATHS.includes(new URL(request.url).pathname)) {
      cacheRuntimeResponse(cache, request, response)
    }
    return response
  }

  const first = await waitForResponseWithin(network.response, NAVIGATION_TIMEOUT_MS)
  if (first !== NAVIGATION_TIMED_OUT) {
    if (first) return settle(first)
    return (await cachedShell(cache)) || Response.error()
  }

  // 超时了：有外壳就先把上一版显示出来，这条网络请求继续跑，只是不再等它。
  const shell = await cachedShell(cache)
  if (shell) {
    // 尽力把迟到的响应写回缓存，否则慢链路上的手机会一直启动旧外壳。
    void waitForResponseWithin(network.response, NAVIGATION_COLD_START_TIMEOUT_MS)
      .then((late) => {
        if (late && late !== NAVIGATION_TIMED_OUT) return settle(late)
        network.abort()
        return null
      })
      .catch(() => null)
    return shell
  }

  // 冷启动，无壳可退，只能把预算放宽继续等。
  const late = await waitForResponseWithin(network.response, NAVIGATION_COLD_START_TIMEOUT_MS)
  if (late && late !== NAVIGATION_TIMED_OUT) return settle(late)
  network.abort()
  return Response.error()
}

function cachedShell(cache) {
  return cache.match('/freestyle')
    .then((hit) => hit || cache.match('/'))
    .then((hit) => hit || cache.match('/offline.html'))
}

/**
 * /release.json 永不缓存，但也不能永不 settle：registerServiceWorker 每 60s 轮询一次，
 * 挂住的请求会一直堆积。超时就报 504，让轮询这一轮明确失败并等下一轮。
 */
async function versionMetadata(request) {
  const response = await fetchWithin(new Request(request, { cache: 'no-store' }), API_TIMEOUT_MS)
  if (response) return response
  return new Response('', {
    status: 504,
    statusText: 'Release metadata fetch timed out',
    headers: { 'Cache-Control': 'no-store' },
  })
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (!isSameOrigin(url)) return
  // Never buffer the live study SSE body through startFetch().arrayBuffer().
  if (isLiveStudyStream(url)) return
  if (request.mode === 'navigate') { event.respondWith(navigationFallback(request)); return }
  if (isVersionMetadata(url)) { event.respondWith(versionMetadata(request)); return }
  if (isOfflineCapableApi(url)) { event.respondWith(networkFirstOfflineApi(request)); return }
  if (isStaticAsset(request, url)) event.respondWith(currentReleaseAsset(request))
})
