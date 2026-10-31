import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { progressFreestyleOverlayQuizApi } from '@/modules/practice/ui/freestyle/api'
import { useOverlayProgressPersistence } from './useOverlayProgressPersistence'

vi.mock('@/modules/practice/ui/freestyle/api', () => ({
  progressFreestyleOverlayQuizApi: vi.fn().mockResolvedValue({ version: 2 }),
}))

afterEach(() => vi.useRealTimers())

it('retains a wrong answer when it is corrected before the debounce', async () => {
  vi.useFakeTimers()
  vi.mocked(progressFreestyleOverlayQuizApi).mockClear()
  const questionStatesRef = { current: {} }
  const { result } = renderHook(() => useOverlayProgressPersistence({
    roundIdRef: { current: 'round-1' },
    prioritizeWrongRef: { current: true },
    planVersionRef: { current: 1 },
    indexRef: { current: 0 },
    questionStatesRef,
    open: true,
    onRoundSync: vi.fn(),
    setOverlay: vi.fn(),
  }))
  act(() => {
    result.current.persistProgress(0, { 11: { resolved: true, correct: false } })
    result.current.persistProgress(0, { 11: { resolved: true, correct: true } })
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(320) })
  expect(progressFreestyleOverlayQuizApi).toHaveBeenCalledWith('round-1', expect.objectContaining({
    wrong_question_ids: [11],
    states: { 11: expect.objectContaining({ correct: true }) },
    auto_prioritize_wrong_palaces: true,
  }))
})
