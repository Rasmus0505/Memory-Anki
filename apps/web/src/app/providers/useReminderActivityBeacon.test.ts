import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as http from '@/shared/api/http'
import {
  ACTIVITY_BEACON_INTERVAL_MS,
  useReminderActivityBeacon,
} from '@/app/providers/useReminderActivityBeacon'

vi.mock('@/shared/api/http', () => ({
  request: vi.fn(() => Promise.resolve({ ok: true })),
}))

function tap() {
  window.dispatchEvent(new Event('pointerdown'))
}

describe('useReminderActivityBeacon', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(http.request).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends one heartbeat on mount and throttles repeated taps', () => {
    const { unmount } = renderHook(() => useReminderActivityBeacon())
    expect(http.request).toHaveBeenCalledTimes(1)

    tap()
    tap()
    expect(http.request).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(ACTIVITY_BEACON_INTERVAL_MS + 1)
    tap()
    expect(http.request).toHaveBeenCalledTimes(2)

    expect(http.request).toHaveBeenCalledWith('/reminders/activity', {
      method: 'POST',
      persistence: false,
    })
    unmount()
  })

  it('does not count page loads or hidden tabs as activity', () => {
    let visibility: DocumentVisibilityState = 'hidden'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    })

    renderHook(() => useReminderActivityBeacon())
    tap()
    expect(http.request).not.toHaveBeenCalled()

    visibility = 'visible'
    vi.advanceTimersByTime(ACTIVITY_BEACON_INTERVAL_MS + 1)
    tap()
    expect(http.request).toHaveBeenCalledTimes(1)
  })
})
