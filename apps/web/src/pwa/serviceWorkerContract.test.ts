import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const publicSwPath = resolve(process.cwd(), 'public/sw.js')
const publicResetPath = resolve(process.cwd(), 'public/pwa-reset.html')
const registerServiceWorkerPath = resolve(process.cwd(), 'src/pwa/registerServiceWorker.ts')

describe('PWA service worker contract', () => {
  it('uses a fresh cache namespace and removes old Memory Anki PWA caches', () => {
    const sw = readFileSync(publicSwPath, 'utf8')

    expect(sw).toContain("const CACHE_VERSION = '2026-07-06-desktop-pwa-v1'")
    expect(sw).toContain("const CACHE_PREFIX = 'memory-anki-pwa-'")
    expect(sw).toContain("const LEGACY_CACHE_PREFIX = 'memory-anki-mobile-'")
    expect(sw).toContain('key.startsWith(CACHE_PREFIX)')
    expect(sw).toContain('key.startsWith(LEGACY_CACHE_PREFIX)')
    expect(sw).toContain("new Request(url, { cache: 'reload' })")
    expect(sw).toContain("'/pwa-reset.html'")
    expect(sw).toContain("'/freestyle'")
  })

  it('lets newly installed PWA workers take control without interrupting an active session', () => {
    const sw = readFileSync(publicSwPath, 'utf8')
    const registration = readFileSync(registerServiceWorkerPath, 'utf8')

    expect(sw).toContain("event.data.type === 'SKIP_WAITING'")
    expect(registration).toContain("register('/sw.js', { updateViaCache: 'none' })")
    expect(registration).toContain('registration.update()')
    expect(registration).toContain('controllerchange')
    expect(registration).toContain('hasUserInteracted')
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
})
