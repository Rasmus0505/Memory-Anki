import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMER_OVERLAY_LAYOUT,
  sanitizeTimerOverlayLayout,
} from '@/shared/components/session/timer-overlay-layout'

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
