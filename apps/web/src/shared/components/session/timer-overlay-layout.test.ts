import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readTimerOverlayMemory, resetWindowLayoutMemoryForTest } from '@/shared/preferences/windowLayoutMemory'
import {
  DEFAULT_TIMER_OVERLAY_LAYOUT,
  readTimerOverlayLayout,
  sanitizeTimerOverlayLayout,
  saveTimerOverlayLayout,
} from '@/shared/components/session/timer-overlay-layout'

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
}

describe('sanitizeTimerOverlayLayout', () => {
  it('defaults hidden to false when omitted from old layouts', () => {
    expect(
      sanitizeTimerOverlayLayout({
        x: 40,
        y: 80,
        width: 320,
        height: 208,
        collapsed: true,
      }),
    ).toEqual({
      x: 40,
      y: 80,
      width: 320,
      height: 208,
      collapsed: true,
      hidden: false,
    })
  })

  it('preserves hidden=true when present', () => {
    expect(
      sanitizeTimerOverlayLayout({
        ...DEFAULT_TIMER_OVERLAY_LAYOUT,
        hidden: true,
      }),
    ).toMatchObject({ hidden: true })
  })

  it('coerces non-boolean hidden values', () => {
    expect(sanitizeTimerOverlayLayout({ hidden: 1 }).hidden).toBe(true)
    expect(sanitizeTimerOverlayLayout({ hidden: 0 }).hidden).toBe(false)
    expect(sanitizeTimerOverlayLayout(null)).toMatchObject({
      ...DEFAULT_TIMER_OVERLAY_LAYOUT,
      hidden: false,
    })
  })
})

describe('timer overlay ratio memory', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetWindowLayoutMemoryForTest()
    setViewport(1200, 800)
  })

  afterEach(() => {
    window.localStorage.clear()
    resetWindowLayoutMemoryForTest()
    setViewport(1024, 768)
  })

  it('keeps the size ratio when hide saves a smaller box', () => {
    saveTimerOverlayLayout({
      x: 40,
      y: 80,
      width: 900,
      height: 400,
      collapsed: false,
      hidden: false,
    })
    setViewport(480, 360)
    saveTimerOverlayLayout(
      { ...readTimerOverlayLayout(), width: 220, height: 176, hidden: true },
      { size: false, position: false },
    )

    expect(readTimerOverlayMemory()).toMatchObject({ widthRatio: 0.75, heightRatio: 0.5, hidden: true })
    setViewport(1200, 800)
    expect(readTimerOverlayLayout()).toMatchObject({ width: 900, height: 400, hidden: true })
  })
})
