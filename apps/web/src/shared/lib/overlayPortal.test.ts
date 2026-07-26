import { afterEach, describe, expect, it } from 'vitest'
import { resolveOverlayPortalContainer } from './overlayPortal'

describe('resolveOverlayPortalContainer', () => {
  afterEach(() => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => null,
    })
  })

  it('uses document.body when nothing is fullscreen', () => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => null,
    })
    expect(resolveOverlayPortalContainer()).toBe(document.body)
  })

  it('uses the native fullscreen element when active', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => host,
    })

    expect(resolveOverlayPortalContainer()).toBe(host)
    host.remove()
  })

  it('prefers an explicit preferred container', () => {
    const preferred = document.createElement('div')
    const host = document.createElement('div')
    document.body.appendChild(host)
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => host,
    })

    expect(resolveOverlayPortalContainer(preferred)).toBe(preferred)
    host.remove()
  })
})
