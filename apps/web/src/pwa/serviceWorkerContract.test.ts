import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

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

function createServiceWorkerHarness() {
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
  const fetchMock = async () => {
    throw new TypeError('offline')
  }

  Function('self', 'caches', 'fetch', 'Response', 'Request', 'URL', sw)(
    selfMock,
    cachesMock,
    fetchMock,
    Response,
    Request,
    URL,
  )

  const fetchHandler = listeners.get('fetch')?.[0] as FetchEventHandler | undefined
  if (!fetchHandler) throw new Error('Service worker fetch handler was not registered')

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
    dispatchFetch,
  }
}

describe('PWA service worker contract', () => {
  it('uses a fresh cache namespace and removes old Memory Anki PWA caches', () => {
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
      url: 'https://memory.test/review/session/42',
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
})
