import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FREESTYLE_AUTO_ADVANCE_MS,
  resolveFreestyleAutoAdvanceTarget,
  useFreestyleAutoAdvance,
} from './useFreestyleAutoAdvance'

type Props = Parameters<typeof useFreestyleAutoAdvance>[0]

function hookProps(overrides: Partial<Props> = {}): Props {
  return {
    enabled: true,
    viewingCardId: 'a',
    resolveTargetIndex: () => 1,
    navigateToIndex: vi.fn(),
    ...overrides,
  }
}

describe('resolveFreestyleAutoAdvanceTarget', () => {
  it('lands on the earliest unscored unit even when it sits behind the current one', () => {
    expect(resolveFreestyleAutoAdvanceTarget({
      unscoredIndices: [0, 3],
      cardCount: 5,
      roundComplete: false,
    })).toBe(0)
  })

  it('ignores indexes outside the current queue', () => {
    expect(resolveFreestyleAutoAdvanceTarget({
      unscoredIndices: [7, 2],
      cardCount: 3,
      roundComplete: false,
    })).toBe(2)
  })

  it('lands on the closing settlement slot once nothing is left unscored', () => {
    expect(resolveFreestyleAutoAdvanceTarget({
      unscoredIndices: [],
      cardCount: 4,
      roundComplete: true,
    })).toBe(4)
  })

  it('stays put while an unfinished round has nothing else to offer', () => {
    expect(resolveFreestyleAutoAdvanceTarget({
      unscoredIndices: [],
      cardCount: 4,
      roundComplete: false,
    })).toBeNull()
  })
})

describe('useFreestyleAutoAdvance', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('moves to the resolved unit once the undo window passes', () => {
    const navigateToIndex = vi.fn()
    const { result } = renderHook(
      (props: Props) => useFreestyleAutoAdvance(props),
      { initialProps: hookProps({ navigateToIndex }) },
    )

    act(() => result.current.scheduleAutoAdvance('a'))
    expect(navigateToIndex).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(FREESTYLE_AUTO_ADVANCE_MS))
    expect(navigateToIndex).toHaveBeenCalledWith(1)
  })

  it('stays put while the setting is off', () => {
    const navigateToIndex = vi.fn()
    const { result } = renderHook(
      (props: Props) => useFreestyleAutoAdvance(props),
      { initialProps: hookProps({ enabled: false, navigateToIndex }) },
    )

    act(() => result.current.scheduleAutoAdvance('a'))
    act(() => vi.advanceTimersByTime(FREESTYLE_AUTO_ADVANCE_MS))
    expect(navigateToIndex).not.toHaveBeenCalled()
  })

  it('never moves for a rating on a card that is not under the viewport', () => {
    const navigateToIndex = vi.fn()
    const { result } = renderHook(
      (props: Props) => useFreestyleAutoAdvance(props),
      { initialProps: hookProps({ viewingCardId: 'b', navigateToIndex }) },
    )

    act(() => result.current.scheduleAutoAdvance('a'))
    act(() => vi.advanceTimersByTime(FREESTYLE_AUTO_ADVANCE_MS))
    expect(navigateToIndex).not.toHaveBeenCalled()
  })

  it('cancels a pending move when the learner pages away first', () => {
    const navigateToIndex = vi.fn()
    const { result, rerender } = renderHook(
      (props: Props) => useFreestyleAutoAdvance(props),
      { initialProps: hookProps({ navigateToIndex }) },
    )

    act(() => result.current.scheduleAutoAdvance('a'))
    rerender(hookProps({ viewingCardId: 'b', navigateToIndex }))
    act(() => vi.advanceTimersByTime(FREESTYLE_AUTO_ADVANCE_MS))
    expect(navigateToIndex).not.toHaveBeenCalled()
  })

  it('resolves the target at fire time so a restudy reorder or a new skip lands correctly', () => {
    const navigateToIndex = vi.fn()
    const { result, rerender } = renderHook(
      (props: Props) => useFreestyleAutoAdvance(props),
      { initialProps: hookProps({ resolveTargetIndex: () => 1, navigateToIndex }) },
    )

    act(() => result.current.scheduleAutoAdvance('a'))
    rerender(hookProps({ resolveTargetIndex: () => 0, navigateToIndex }))
    act(() => vi.advanceTimersByTime(FREESTYLE_AUTO_ADVANCE_MS))
    expect(navigateToIndex).toHaveBeenCalledWith(0)
  })

  it('stays put when nothing is left to seek', () => {
    const navigateToIndex = vi.fn()
    const { result } = renderHook(
      (props: Props) => useFreestyleAutoAdvance(props),
      { initialProps: hookProps({ resolveTargetIndex: () => null, navigateToIndex }) },
    )

    act(() => result.current.scheduleAutoAdvance('a'))
    act(() => vi.advanceTimersByTime(FREESTYLE_AUTO_ADVANCE_MS))
    expect(navigateToIndex).not.toHaveBeenCalled()
  })

  it('drops a pending move on unmount', () => {
    const navigateToIndex = vi.fn()
    const { result, unmount } = renderHook(
      (props: Props) => useFreestyleAutoAdvance(props),
      { initialProps: hookProps({ navigateToIndex }) },
    )

    act(() => result.current.scheduleAutoAdvance('a'))
    unmount()
    act(() => vi.advanceTimersByTime(FREESTYLE_AUTO_ADVANCE_MS))
    expect(navigateToIndex).not.toHaveBeenCalled()
  })
})
