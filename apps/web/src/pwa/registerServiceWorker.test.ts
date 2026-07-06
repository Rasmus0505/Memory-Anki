import { describe, expect, it } from 'vitest'
import { shouldAutoReloadForControllerChange } from './registerServiceWorker'

describe('registerServiceWorker controllerchange policy', () => {
  it('auto-reloads inactive PWA routes so the new worker takes control', () => {
    expect(
      shouldAutoReloadForControllerChange({
        pathname: '/freestyle',
        userInteracted: false,
      }),
    ).toBe(true)
  })

  it('does not interrupt an active learning session', () => {
    expect(
      shouldAutoReloadForControllerChange({
        pathname: '/freestyle',
        userInteracted: true,
      }),
    ).toBe(false)
  })

  it('treats the full desktop app as the PWA surface', () => {
    expect(
      shouldAutoReloadForControllerChange({
        pathname: '/palaces',
        userInteracted: false,
      }),
    ).toBe(true)
  })
})
