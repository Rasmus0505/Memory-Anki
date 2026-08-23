import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const publicSwPath = resolve(process.cwd(), 'public/sw.js')
const publicResetPath = resolve(process.cwd(), 'public/pwa-reset.html')
const registerServiceWorkerPath = resolve(process.cwd(), 'src/pwa/registerServiceWorker.ts')

type FetchEventHandler = (event: {
  request: ServiceWorkerRequest
  respondWith: (response: Promise<Response> | Response) => void
}) => void

type ServiceWorkerRequest = Pick<Request, 'url' | 'method' | 'mode' | 'destination'>
type ServiceWorkerListener = (event: unknown) => void

type CacheStore = {
  match: (request: Request | string) => Promise<Response | undefined>
  put: (request: Request | string, response: Response) => Promise<void>
  keys: () => Promise<Request[]>
}

function createServiceWorkerHarness(fetchImpl?: (request: Request) => Promise<Response>) {
  const sw = readFileSync(publicSwPath, 'utf8')
  const listeners = new Map<string, ServiceWorkerListener[]>()
  const stores = new Map<string, Map<string, Response>>()
  const cacheKey = (request: Request | string) =>
    typeof request === 'string' ? new URL(request, 'https://memory.test').href : request.url
  const makeStore = (name: string): CacheStore => {
    let entries = stores.get(name)
    if (!entries) {
      entries = new Map()
      stores.set(name, entries)
    }
    return {
      async match(request) {
        const response = entries.get(cacheKey(request))
        return response?.clone()
      },
      async put(request, response) {
        entries.set(cacheKey(request), response.clone())
      },
      async keys() {
        return Array.from(entries.keys()).map((url) => new Request(url))
      },
    }
  }
  const cachesMock = {
    open: async (name: string) => makeStore(name),
    match: async (request: Request | string) => {
      const key = cacheKey(request)
      for (const entries of stores.values()) {
        const response = entries.get(key)
        if (response) return response.clone()
      }
      return undefined
    },
    keys: async () => Array.from(stores.keys()),
    delete: async (name: string) => stores.delete(name),
  }
  const selfMock = {
    location: new URL('https://memory.test/sw.js'),
    skipWaiting: () => undefined,
    clients: {
      claim: () => undefined,
    },
    addEventListener(type: string, handler: ServiceWorkerListener) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler])
    },
  }
  // Browser service workers resolve `new Request('/path')` against their own
  // origin. Node's Request implementation used by Vitest requires an absolute
  // URL, so preserve browser semantics in the harness.
  function ScopedRequest(input: RequestInfo | URL, init?: RequestInit) {
    const resolved = typeof input === 'string'
      ? new URL(input, selfMock.location.origin).href
      : input instanceof URL
        ? input.href
        : 'url' in input && typeof input.url === 'string'
          ? input.url
          : input
    // Vitest's jsdom AbortController and Node's undici Request use different
    // AbortSignal realms. Preserve the signal on the request while avoiding a
    // cross-realm Web IDL rejection in the test-only constructor.
    if (init?.signal) {
      const { signal, ...requestInit } = init
      const request = new Request(resolved, requestInit)
      Object.defineProperty(request, 'signal', { configurable: true, value: signal })
      return request
    }
    return new Request(resolved, init)
  }
  const fetchMock = fetchImpl
    ?? (async () => {
      throw new TypeError('offline')
    })

  Function('self', 'caches', 'fetch', 'Response', 'Request', 'URL', sw)(
    selfMock,
    cachesMock,
    fetchMock,
    Response,
    ScopedRequest,
    URL,
  )

  const fetchHandler = listeners.get('fetch')?.[0] as FetchEventHandler | undefined
  if (!fetchHandler) throw new Error('Service worker fetch handler was not registered')

  async function dispatchInstall() {
    const installHandler = listeners.get('install')?.[0] as ((event: {
      waitUntil: (promise: Promise<unknown>) => void
    }) => void) | undefined
    if (!installHandler) throw new Error('Service worker install handler was not registered')
    let installPromise: Promise<unknown> | null = null
    installHandler({
      waitUntil(promise) {
        installPromise = promise
      },
    })
    if (!installPromise) throw new Error('Service worker install did not register waitUntil')
    await installPromise
  }

  async function dispatchActivate() {
    const activateHandler = listeners.get('activate')?.[0] as ((event: {
      waitUntil: (promise: Promise<unknown>) => void
    }) => void) | undefined
    if (!activateHandler) throw new Error('Service worker activate handler was not registered')
    let activatePromise: Promise<unknown> | null = null
    activateHandler({
      waitUntil(promise) {
        activatePromise = promise
      },
    })
    if (!activatePromise) throw new Error('Service worker activate did not register waitUntil')
    await activatePromise
  }

  async function dispatchFetch(request: ServiceWorkerRequest) {
    let responsePromise: Promise<Response> | Response | null = null
    fetchHandler({
      request,
      respondWith(response) {
        responsePromise = response
      },
    })
    if (!responsePromise) throw new Error('Service worker did not handle the request')
    return responsePromise
  }

  return {
    caches: cachesMock,
    dispatchActivate,
    dispatchFetch,
    dispatchInstall,
  }
}

describe('PWA service worker contract', () => {
  it('uses a fresh cache namespace and bounds retained Memory Anki PWA caches', () => {
    const sw = readFileSync(publicSwPath, 'utf8')

    expect(sw).toContain("const RELEASE_ID = '__MEMORY_ANKI_RELEASE_ID__'")
    expect(sw).toContain('memory-anki-pwa-app-${RELEASE_ID}')
    expect(sw).toContain('memory-anki-pwa-api-${RELEASE_ID}')
    expect(sw).toContain("const CACHE_PREFIX = 'memory-anki-pwa-'")
    expect(sw).toContain("const LEGACY_CACHE_PREFIX = 'memory-anki-mobile-'")
    expect(sw).toContain('key.startsWith(CACHE_PREFIX)')
    expect(sw).toContain('key.startsWith(LEGACY_CACHE_PREFIX)')
    expect(sw).toContain("new Request(url, { cache: 'reload' })")
    expect(sw).toContain('Promise.allSettled')
    expect(sw).toContain('precacheCurrentRelease')
    expect(sw).toContain("'/pwa-reset.html'")
    expect(sw).toContain("'/freestyle'")
    expect(sw).toContain("'/release.json'")
    expect(sw).not.toContain('emptyStyleRecoveryResponse')
    expect(sw).not.toContain('caches.match(request)')
  })

  it('precaches the complete current release and activates only after core assets succeed', () => {
    const sw = readFileSync(publicSwPath, 'utf8')

    expect(sw).toContain('const CORE_PRECACHE_URLS = [')
    expect(sw).toContain('const AUXILIARY_PRECACHE_URLS = [')
    expect(sw).toContain('const PRECACHE_CONCURRENCY = 6')
    expect(sw).toContain('await runWithConcurrency(coreUrls, cacheUrl)')
    expect(sw).toContain('await caches.delete(APP_CACHE)')
    expect(sw).toContain("'/icons/icon-192.png'")
    expect(sw).toContain("'/icons/icon-512.png'")
    expect(sw).toContain("'/icons/maskable-512.png'")
    expect(sw).toContain("'/icons/apple-touch-icon.png'")
    // 构建时被 releaseArtifactsPlugin 替换为 JSON 数组；源文件保持字符串占位。
    expect(sw).toContain("const PRECACHE_RELEASE_ASSETS = '__MEMORY_ANKI_PRECACHE_ASSETS__'")
    expect(sw).toContain('Array.isArray(PRECACHE_RELEASE_ASSETS)')
  })

  it('limits release installation fan-out on constrained mobile links', async () => {
    vi.useFakeTimers()
    try {
      let active = 0
      let maximumActive = 0
      const fetchMock = vi.fn(async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await Promise.resolve()
        active -= 1
        return new Response('ok', { status: 200 })
      })
      const harness = createServiceWorkerHarness(fetchMock)

      await harness.dispatchInstall()

      // The source placeholder has three core URLs and nine optional URLs.
      expect(fetchMock).toHaveBeenCalledTimes(12)
      expect(maximumActive).toBeLessThanOrEqual(6)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retains the immediately previous app cache for an active older page', async () => {
    const harness = createServiceWorkerHarness()
    await harness.caches.open('memory-anki-pwa-app-20260809-expired')
    const previousAppCache = await harness.caches.open('memory-anki-pwa-app-20260810-previous')
    await previousAppCache.put(
      '/assets/InsightsPage-previous.js',
      new Response('previous insight chunk', { status: 200 }),
    )
    await harness.caches.open('memory-anki-pwa-app-__MEMORY_ANKI_RELEASE_ID__')
    await harness.caches.open('memory-anki-pwa-api-20260810-previous')

    await harness.dispatchActivate()

    expect(await harness.caches.keys()).toContain('memory-anki-pwa-app-20260810-previous')
    expect(await harness.caches.keys()).not.toContain('memory-anki-pwa-app-20260809-expired')
    expect(await harness.caches.keys()).not.toContain('memory-anki-pwa-api-20260810-previous')

    const response = await harness.dispatchFetch(
      new Request('https://memory.test/assets/InsightsPage-previous.js', { method: 'GET' }),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('previous insight chunk')
  })

  it('focuses an existing window when a break notification is clicked', () => {
    const sw = readFileSync(publicSwPath, 'utf8')

    expect(sw).toContain("self.addEventListener('notificationclick'")
    expect(sw).toContain('event.notification.close()')
    // includeUncontrolled matters: a freshly activated worker has not claimed
    // the open study tab yet, and without it a second window would be opened.
    expect(sw).toContain("self.clients.matchAll({ type: 'window', includeUncontrolled: true })")
    expect(sw).toContain('client.focus()')
    expect(sw).toContain('self.clients.openWindow')
  })

  it('limits offline API fallback to the allowlist and navigation cache to entry paths', () => {
    const sw = readFileSync(publicSwPath, 'utf8')

    expect(sw).toContain("const OFFLINE_API_ALLOWLIST = ['/api/v1/freestyle/feed']")
    expect(sw).toContain("const NAVIGATION_CACHE_PATHS = ['/', '/freestyle']")
    expect(sw).toContain('NAVIGATION_CACHE_PATHS.includes(new URL(request.url).pathname)')
  })

  it('skips release polling while the tab is hidden', () => {
    const registration = readFileSync(registerServiceWorkerPath, 'utf8')

    expect(registration).toContain("if (document.visibilityState === 'visible') runCheck()")
  })

  it('lets newly installed PWA workers take control without interrupting an active session', () => {
    const sw = readFileSync(publicSwPath, 'utf8')
    const registration = readFileSync(registerServiceWorkerPath, 'utf8')

    expect(sw).toContain("event.data?.type === 'SKIP_WAITING'")
    expect(registration).toContain("register('/sw.js', { updateViaCache: 'none' })")
    expect(registration).toContain('registration.update()')
    expect(registration).toContain('controllerchange')
    expect(registration).toContain('lastInteractionAt')
    expect(registration).toContain("fetch('/release.json', { cache: 'no-store' })")
    expect(registration).toContain('isDesktopClient()')
    expect(registration).toContain('window.location.reload()')
  })

  it('ships a standalone reset page for clearing stubborn iOS PWA caches', () => {
    const resetPage = readFileSync(publicResetPath, 'utf8')

    expect(resetPage).toContain('navigator.serviceWorker.getRegistrations()')
    expect(resetPage).toContain('registration.unregister()')
    expect(resetPage).toContain('caches.keys()')
    expect(resetPage).toContain('href="/freestyle"')
    expect(resetPage).toContain("key.startsWith('memory-anki-pwa-')")
    expect(resetPage).toContain("key.startsWith('memory-anki-mobile-')")
  })

  it('serves the cached freestyle shell when a navigation is opened offline', async () => {
    const harness = createServiceWorkerHarness()
    const appCache = await harness.caches.open('memory-anki-pwa-app-__MEMORY_ANKI_RELEASE_ID__')
    await appCache.put('/freestyle', new Response('<main>cached freestyle shell</main>'))

    const response = await harness.dispatchFetch({
      url: 'https://memory.test/freestyle?palaceId=42',
      method: 'GET',
      mode: 'navigate',
      destination: '',
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('cached freestyle shell')
  })

  it('serves the latest cached freestyle feed when the API is offline', async () => {
    const harness = createServiceWorkerHarness()
    const apiCache = await harness.caches.open(
      'memory-anki-pwa-api-__MEMORY_ANKI_RELEASE_ID__',
    )
    await apiCache.put(
      'https://memory.test/api/v1/freestyle/feed?range=due',
      new Response(JSON.stringify({ cards: [{ id: 'cached-card' }], counts: { review: 1 } }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const response = await harness.dispatchFetch(
      new Request('https://memory.test/api/v1/freestyle/feed?range=all', { method: 'GET' }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.cards).toEqual([{ id: 'cached-card' }])
  })

  it('returns an explicit empty offline freestyle feed when no cached feed exists', async () => {
    const harness = createServiceWorkerHarness()

    const response = await harness.dispatchFetch(
      new Request('https://memory.test/api/v1/freestyle/feed?range=all', { method: 'GET' }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(body).toMatchObject({
      cards: [],
      counts: {
        quiz_question: 0,
        review: 0,
        practice: 0,
        english: 0,
        english_reading: 0,
      },
      offline: true,
    })
    expect(typeof body.generated_at).toBe('string')
  })

  it('bounds every network path so a half-open connection cannot hang the worker', () => {
    const sw = readFileSync(publicSwPath, 'utf8')

    expect(sw).toContain('const NAVIGATION_TIMEOUT_MS')
    expect(sw).toContain('const NAVIGATION_COLD_START_TIMEOUT_MS')
    expect(sw).toContain('function startFetch(request, signal)')
    expect(sw).toContain('function fetchWithin(request, timeoutMs)')
    expect(sw).toContain('waitForResponseWithin(network.response, NAVIGATION_TIMEOUT_MS)')
    expect(sw).toContain('controller.abort()')
    // 裸 fetch 只允许出现在 startFetch 内部；其他任何地方都会重新引入永挂的可能。
    expect(sw.match(/[^.\w]fetch\(/g)).toHaveLength(1)
  })

  it('keeps waiting on a cold-start navigation instead of erroring at the short budget', async () => {
    vi.useFakeTimers()
    try {
      let release: ((response: Response) => void) | null = null
      // 空缓存 + 慢链路：4s 预算到点时无壳可退，必须继续等这一个请求，且不得重发。
      const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
        release = resolve
      }))
      const harness = createServiceWorkerHarness(fetchMock)

      const pending = harness.dispatchFetch({
        url: 'https://memory.test/freestyle',
        method: 'GET',
        mode: 'navigate',
        destination: '',
      })
      await vi.advanceTimersByTimeAsync(6_000)
      release?.(new Response('<main>slow first load</main>', { status: 200 }))
      const response = await pending

      expect(response.status).toBe(200)
      expect(await response.text()).toContain('slow first load')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to the cached shell when a navigation fetch never settles', async () => {
    vi.useFakeTimers()
    try {
      const harness = createServiceWorkerHarness(() => new Promise<Response>(() => {}))
      const appCache = await harness.caches.open(
        'memory-anki-pwa-app-__MEMORY_ANKI_RELEASE_ID__',
      )
      await appCache.put('/freestyle', new Response('<main>cached freestyle shell</main>'))

      const pending = harness.dispatchFetch({
        url: 'https://memory.test/freestyle',
        method: 'GET',
        mode: 'navigate',
        destination: '',
      })
      await vi.advanceTimersByTimeAsync(5_000)
      const response = await pending

      expect(response.status).toBe(200)
      expect(await response.text()).toContain('cached freestyle shell')
    } finally {
      vi.useRealTimers()
    }
  })

  it('answers a hung asset request with 504 instead of rejecting respondWith', async () => {
    vi.useFakeTimers()
    try {
      const harness = createServiceWorkerHarness(() => new Promise<Response>(() => {}))

      const pending = harness.dispatchFetch(
        new Request('https://memory.test/assets/InsightsPage-abc123.js', { method: 'GET' }),
      )
      await vi.advanceTimersByTimeAsync(10_000)
      const response = await pending

      expect(response.status).toBe(504)
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts a hung asset request when its bounded fetch budget expires', async () => {
    vi.useFakeTimers()
    try {
      let aborted = false
      const harness = createServiceWorkerHarness((request) => new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          aborted = true
          reject(request.signal.reason)
        })
      }))

      const pending = harness.dispatchFetch(
        new Request('https://memory.test/assets/InsightsPage-abc123.js', { method: 'GET' }),
      )
      await vi.advanceTimersByTimeAsync(10_000)
      const response = await pending

      expect(response.status).toBe(504)
      expect(aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts an asset response whose headers arrive but body never completes', async () => {
    vi.useFakeTimers()
    try {
      let aborted = false
      const harness = createServiceWorkerHarness((request) => {
        const body = new ReadableStream({
          start(controller) {
            request.signal.addEventListener('abort', () => {
              aborted = true
              controller.error(request.signal.reason)
            }, { once: true })
          },
        })
        return Promise.resolve(new Response(body, { status: 200 }))
      })

      const pending = harness.dispatchFetch(
        new Request('https://memory.test/assets/InsightsPage-abc123.js', { method: 'GET' }),
      )
      await vi.advanceTimersByTimeAsync(10_000)
      const response = await pending

      expect(response.status).toBe(504)
      expect(aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
