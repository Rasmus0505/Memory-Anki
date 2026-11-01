import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listQuestionNodeBindingsApi } from '@/modules/quiz/domain/quiz-entity/api'
import { useQuestionLookupFocus } from './useQuestionLookupFocus'

vi.mock('@/modules/quiz/domain/quiz-entity/api', () => ({
  listQuestionNodeBindingsApi: vi.fn(),
}))

const listBindings = vi.mocked(listQuestionNodeBindingsApi)

function question(id: number, palaceId = 85) {
  return { id, palace_id: palaceId }
}

describe('useQuestionLookupFocus', () => {
  beforeEach(() => {
    listBindings.mockReset()
  })

  it('reports pending until the current question bindings are read', async () => {
    listBindings.mockResolvedValue({
      items: [{ node_uid: 'bound-node', palace_id: 85 }],
    } as never)

    const { result } = renderHook(() => useQuestionLookupFocus(question(1), true, 85))

    expect(result.current.pending).toBe(true)
    expect(result.current.focusNodeUids).toEqual([])

    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.focusNodeUids).toEqual(['bound-node'])
    expect(result.current.palaceIdOverride).toBe(85)
    expect(listBindings).toHaveBeenCalledWith(1)
  })

  it('caches a question so reopening the lookup does not read it again', async () => {
    listBindings.mockResolvedValue({
      items: [{ node_uid: 'a', palace_id: 85 }],
    } as never)

    const { result, rerender } = renderHook(
      ({ id }: { id: number }) => useQuestionLookupFocus(question(id), true, 85),
      { initialProps: { id: 1 } },
    )
    await waitFor(() => expect(result.current.pending).toBe(false))

    rerender({ id: 2 })
    await waitFor(() => expect(result.current.pending).toBe(false))
    rerender({ id: 1 })

    expect(result.current.pending).toBe(false)
    expect(result.current.focusNodeUids).toEqual(['a'])
    expect(listBindings).toHaveBeenCalledTimes(2)
  })

  it('falls back to the question palace when the read fails', async () => {
    listBindings.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useQuestionLookupFocus(question(7, 66), true, 85))

    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.focusNodeUids).toEqual([])
    expect(result.current.palaceIdOverride).toBe(66)
  })

  it('does not read bindings while disabled', async () => {
    const { result } = renderHook(() => useQuestionLookupFocus(question(1), false, 85))

    expect(result.current.pending).toBe(false)
    await new Promise((resolve) => window.setTimeout(resolve, 200))
    expect(listBindings).not.toHaveBeenCalled()
  })
})
