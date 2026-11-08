import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FreestyleCard } from '@/shared/api/contracts'
import { useFreestyleFeedScrollSettle } from './useFreestyleFeedScrollSettle'

function mount({ visual = 4, top = 2400, closing = true, intent = false } = {}) {
  vi.useFakeTimers()
  const node = { scrollTop: top, clientHeight: 600 } as HTMLElement
  const deps = {
    scrollRef: { current: node },
    queueRef: { current: Array.from({ length: 4 }, (_, i) => ({ id: `card-${i}` } as FreestyleCard)) },
    programmaticScrollRef: { current: false },
    touchPointersRef: { current: 0 },
    userScrollingRef: { current: false },
    visualIndexRef: { current: visual },
    currentIndexRef: { current: 3 },
    roundCompleteRef: { current: closing },
    pageHeightRef: { current: 600 },
    hasUserScrollIntent: () => intent,
    flushDeferredRestudy: vi.fn(() => 3),
    markSettled: vi.fn(),
    navigateToIndex: vi.fn(),
    scrollToIndex: vi.fn(),
    setVisualIndex: vi.fn(),
  }
  const { result } = renderHook(() => useFreestyleFeedScrollSettle(deps))
  const settle = () => act(() => {
    result.current.scheduleScrollSettle()
    vi.advanceTimersByTime(90)
  })
  return { deps, settle }
}

afterEach(() => vi.useRealTimers())

describe('feed scroll settle', () => {
  it('keeps a programmatically opened waiting/settlement slot after native scrollend', () => {
    const { deps, settle } = mount()
    settle()
    expect(deps.visualIndexRef.current).toBe(4)
    expect(deps.scrollToIndex).not.toHaveBeenCalled()
    expect(deps.navigateToIndex).not.toHaveBeenCalled()
    expect(deps.markSettled).not.toHaveBeenCalled()
  })

  it('realigns a closing slot without committing a card cursor or page-turn cue', () => {
    const { deps, settle } = mount({ top: 1800 })
    settle()
    expect(deps.scrollToIndex).toHaveBeenCalledWith(4, 'auto')
    expect(deps.visualIndexRef.current).toBe(4)
    expect(deps.navigateToIndex).not.toHaveBeenCalled()
    expect(deps.markSettled).not.toHaveBeenCalled()
  })

  it('does not turn native drift onto the closing slot into navigation', () => {
    const { deps, settle } = mount({ visual: 3 })
    settle()
    expect(deps.visualIndexRef.current).toBe(3)
    expect(deps.scrollToIndex).toHaveBeenCalledWith(3, 'auto')
    expect(deps.navigateToIndex).not.toHaveBeenCalled()
  })

  it('returns to a real card when the closing slot no longer exists', () => {
    const { deps, settle } = mount({ closing: false })
    settle()
    expect(deps.visualIndexRef.current).toBe(3)
    expect(deps.scrollToIndex).toHaveBeenCalledWith(3, 'auto')
  })

  it('still settles a genuine gesture onto the closing slot', () => {
    const { deps, settle } = mount({ intent: true })
    settle()
    expect(deps.markSettled).toHaveBeenCalledWith(4, true)
    expect(deps.navigateToIndex).not.toHaveBeenCalled()
  })
})
