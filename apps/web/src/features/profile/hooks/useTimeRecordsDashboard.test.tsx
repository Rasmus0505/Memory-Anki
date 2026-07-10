import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTimeRecordsDashboard } from './useTimeRecordsDashboard'

const mocks = vi.hoisted(() => ({
  listRecords: vi.fn(),
  analytics: vi.fn(),
}))

vi.mock('@/entities/session/model', () => ({
  listStudySessionRecords: mocks.listRecords,
  getStudySessionRecordAnalytics: mocks.analytics,
  createStudySessionRecord: vi.fn(),
  updateStudySessionRecord: vi.fn(),
  deleteStudySessionRecord: vi.fn(),
  bulkDeleteStudySessionRecords: vi.fn(),
}))

vi.mock('@/shared/feedback/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/shared/components/ui/native-dialog', () => ({
  appConfirm: vi.fn(),
}))

describe('useTimeRecordsDashboard', () => {
  beforeEach(() => {
    mocks.listRecords.mockReset().mockResolvedValue({
      items: [],
      total: 100,
      limit: 20,
      offset: 0,
    })
    mocks.analytics.mockReset().mockResolvedValue({ trend: [], breakdown: [] })
  })

  it('debounces keyword requests', async () => {
    const { result } = renderHook(() => useTimeRecordsDashboard())
    await waitFor(() => expect(mocks.listRecords).toHaveBeenCalledTimes(1))

    act(() => result.current.setKeyword('alpha'))
    expect(mocks.listRecords).toHaveBeenCalledTimes(1)

    await waitFor(
      () => expect(mocks.listRecords).toHaveBeenCalledTimes(2),
      { timeout: 700 },
    )
    expect(mocks.listRecords.mock.calls.at(-1)?.[0]).toMatchObject({
      keyword: 'alpha',
      offset: 0,
    })
  })

  it('resets to page one when sorting changes', async () => {
    const { result } = renderHook(() => useTimeRecordsDashboard())
    await waitFor(() => expect(mocks.listRecords).toHaveBeenCalledTimes(1))

    act(() => result.current.setPage(3))
    await waitFor(() =>
      expect(mocks.listRecords.mock.calls.at(-1)?.[0]).toMatchObject({ offset: 40 }),
    )

    act(() => result.current.setSortBy('effective_seconds'))
    await waitFor(() =>
      expect(mocks.listRecords.mock.calls.at(-1)?.[0]).toMatchObject({
        offset: 0,
        sortBy: 'effective_seconds',
      }),
    )
    expect(result.current.page).toBe(1)
  })

  it('ignores a stale list response after a newer request completes', async () => {
    const { result } = renderHook(() => useTimeRecordsDashboard())
    await waitFor(() => expect(mocks.listRecords).toHaveBeenCalledTimes(1))

    let resolveSlow: ((value: unknown) => void) | undefined
    const slowResponse = new Promise((resolve) => {
      resolveSlow = resolve
    })
    mocks.listRecords
      .mockImplementationOnce(() => slowResponse)
      .mockResolvedValueOnce({
        items: [{ id: 'latest', title: 'Latest' }],
        total: 1,
        limit: 20,
        offset: 0,
      })

    act(() => result.current.setSortBy('effective_seconds'))
    await waitFor(() => expect(mocks.listRecords).toHaveBeenCalledTimes(2))
    act(() => result.current.setSortBy('title'))
    await waitFor(() => expect(result.current.visibleRecords[0]?.id).toBe('latest'))

    await act(async () => {
      resolveSlow?.({
        items: [{ id: 'stale', title: 'Stale' }],
        total: 1,
        limit: 20,
        offset: 0,
      })
      await slowResponse
    })
    expect(result.current.visibleRecords[0]?.id).toBe('latest')
  })
})
