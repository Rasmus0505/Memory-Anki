import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTimedSession } from '@/shared/hooks/useTimedSession'

describe('useTimedSession compact state contract', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.sessionStorage.clear()
    window.dispatchEvent(new Event('focus'))
  })

  afterEach(() => {
    window.dispatchEvent(new Event('focus'))
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('exposes only the four lifecycle states and a pause reason', () => {
    const { result } = renderHook(() => useTimedSession({
      sessionKey: `compact:${Date.now()}`,
      kind: 'practice',
      title: '状态',
      palaceId: 1,
    }))

    expect(result.current.status).toBe('idle')
    expect(result.current.pauseReason).toBeNull()

    act(() => result.current.start())
    expect(result.current.status).toBe('running')
    act(() => result.current.pause())
    expect(result.current.status).toBe('paused')
    expect(result.current.pauseReason).toBe('manual')
    act(() => result.current.resume())
    expect(result.current.status).toBe('running')
  })
})
