import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PalaceGroupedItem } from '@/shared/api/contracts'
import { usePalaceListCardActions } from './usePalaceListCardActions'

vi.mock('@/modules/content/domain/palace-entity/api', () => ({
  deletePalaceApi: vi.fn(),
}))

vi.mock('@/shared/components/ui/native-dialog', () => ({
  appConfirm: vi.fn(),
}))

vi.mock('@/shared/feedback/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function palace(reviewStatus: PalaceGroupedItem['review_status'], id = 101) {
  return { id, review_status: reviewStatus } as PalaceGroupedItem
}

describe('usePalaceListCardActions review entry', () => {
  it('enters freestyle with the current palace and does not create a formal session', () => {
    const navigate = vi.fn()
    const { result } = renderHook(() =>
      usePalaceListCardActions({
        fetchData: vi.fn(),
        navigate,
      }),
    )

    act(() => {
      result.current.onPalaceReview(palace('due'))
    })

    expect(navigate).toHaveBeenCalledWith('/freestyle?palaceId=101')
  })

  it('keeps permanent-mark entry separate from review', () => {
    const navigate = vi.fn()
    const { result } = renderHook(() =>
      usePalaceListCardActions({
        fetchData: vi.fn(),
        navigate,
      }),
    )

    act(() => {
      result.current.onPalaceReview(palace('marking_required', 202))
    })

    expect(navigate).toHaveBeenCalledWith('/palaces/202/edit?mode=permanent-mark')
  })

  it('does not navigate for a scheduled palace', () => {
    const navigate = vi.fn()
    const { result } = renderHook(() =>
      usePalaceListCardActions({
        fetchData: vi.fn(),
        navigate,
      }),
    )

    act(() => {
      result.current.onPalaceReview(palace('scheduled'))
    })

    expect(navigate).not.toHaveBeenCalled()
  })
})
