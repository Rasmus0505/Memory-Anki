import { afterEach, describe, expect, it } from 'vitest'
import { resolveFloatingTimerLayout } from './globalTimerModel'

const originalWidth = window.innerWidth
const originalHeight = window.innerHeight

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight })
})

describe('resolveFloatingTimerLayout', () => {
  it('moves the legacy desktop default away from the application sidebar', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })

    expect(resolveFloatingTimerLayout({
      x: 24,
      y: 96,
      width: 320,
      height: 208,
      collapsed: false,
    })).toEqual({
      x: 1096,
      y: 24,
      width: 320,
      height: 208,
      collapsed: false,
    })
  })

  it('preserves a user-positioned desktop overlay', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })

    expect(resolveFloatingTimerLayout({
      x: 40,
      y: 120,
      width: 320,
      height: 208,
      collapsed: false,
    })).toMatchObject({ x: 40, y: 120 })
  })
})
