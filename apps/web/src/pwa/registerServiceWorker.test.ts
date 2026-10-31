import { describe, expect, it } from 'vitest'
import { shouldAutoReloadForControllerChange } from './registerServiceWorker'

describe('registerServiceWorker controllerchange policy', () => {
  // Regression: the old "reload after 30s without touching the screen" rule
  // fired while the learner was reading 查看宫殿 — the page flashed back to 随心.
  // A ready update must never reload a page the learner is looking at.
  it('never reloads the page that is on screen', () => {
    expect(
      shouldAutoReloadForControllerChange({
        pathname: '/freestyle',
        userInteracted: false,
      }),
    ).toBe(false)
  })

  it('never reloads an active learning session either', () => {
    expect(
      shouldAutoReloadForControllerChange({
        pathname: '/freestyle',
        userInteracted: true,
      }),
    ).toBe(false)
  })

  it('applies to every route, not only 随心', () => {
    expect(
      shouldAutoReloadForControllerChange({
        pathname: '/palaces',
        userInteracted: false,
      }),
    ).toBe(false)
  })
})
