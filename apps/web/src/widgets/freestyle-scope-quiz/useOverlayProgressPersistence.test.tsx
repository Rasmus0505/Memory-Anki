import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { FreestyleRoundStatePayload } from '@/shared/api/contracts'
import { progressFreestyleOverlayQuizApi } from '@/modules/practice/ui/freestyle/api'
import { useOverlayProgressPersistence } from './useOverlayProgressPersistence'

vi.mock('@/modules/practice/ui/freestyle/api', () => ({
  progressFreestyleOverlayQuizApi: vi.fn().mockResolvedValue({ version: 2 }),
}))

afterEach(() => vi.useRealTimers())

it('retains a wrong priority event while persisting the corrected answer', async () => {
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

it('does not adopt a stale wrong response after reset', async () => {
  vi.useFakeTimers()
  let finishFirst: ((value: FreestyleRoundStatePayload) => void) | undefined
  const api = vi.mocked(progressFreestyleOverlayQuizApi)
  api.mockReset()
  api.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
  api.mockResolvedValue({ version: 3 } as FreestyleRoundStatePayload)
  const sync = vi.fn()
  const { result } = renderHook(() => useOverlayProgressPersistence({
    roundIdRef: { current: 'round-1' },
    prioritizeWrongRef: { current: false },
    planVersionRef: { current: 1 },
    indexRef: { current: 0 },
    questionStatesRef: { current: {} },
    open: true,
    onRoundSync: sync,
    setOverlay: vi.fn(),
  }))
  act(() => result.current.persistProgress(0, { 11: { resolved: true, correct: false } }))
  await act(async () => { await vi.advanceTimersByTimeAsync(320) })
  act(() => result.current.persistProgress(0, {}))
  await act(async () => { finishFirst?.({ version: 2 } as FreestyleRoundStatePayload); await Promise.resolve() })
  expect(sync).not.toHaveBeenCalled()
  await act(async () => { await vi.advanceTimersByTimeAsync(320) })
  expect(api).toHaveBeenLastCalledWith('round-1', expect.objectContaining({ states: {}, expected_version: 2 }))
})
