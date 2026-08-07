import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTimeRecordsDashboard } from './useTimeRecordsDashboard'

const mocks = vi.hoisted(() => ({
  readUnified: vi.fn(),
}))

vi.mock('@/modules/session/domain/session-entity/model', () => ({
  readUnifiedTimeRecords: mocks.readUnified,
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

vi.mock('@/shared/preferences/clientPreferences', () => ({
  CLIENT_PREFERENCES_UPDATED_EVENT: 'client-preferences-updated',
  getCachedClientPreference: vi.fn(() => []),
  getClientPreferenceCacheStatus: vi.fn(() => ({ hasEntry: false, value: null })),
  saveClientPreference: vi.fn(async (_key: string, value: unknown) => ({
    value,
    persisted: true,
  })),
}))

vi.mock('@/shared/events/appEvents', () => ({
  APP_EVENT_NAMES: {
    timerAutomationUpdated: 'memory-anki:timer-automation-updated',
  },
  onAppEvent: vi.fn(() => () => undefined),
  emitAppEvent: vi.fn(),
}))

function response(overrides: Record<string, unknown> = {}) {
  return {
    items: [],
    total: 100,
    limit: 20,
    offset: 0,
    range: {
      mode: 'month',
      month: '2026-07',
      rollingDays: null,
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    },
    sourceSummary: {
      totalEffectiveSeconds: 3600,
      desktopEffectiveSeconds: 2400,
      pwaEffectiveSeconds: 1200,
      unknownEffectiveSeconds: 0,
    },
    recordCount: 100,
    trend: [{ dateKey: '2026-07-01', label: '7/1', seconds: 3600, records: 2 }],
    breakdown: [{ kind: 'review', label: '复习', seconds: 3600, sessions: 2 }],
    ...overrides,
  }
}

describe('useTimeRecordsDashboard', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mocks.readUnified.mockReset().mockResolvedValue(response())
  })

  it('defaults to today and hydrates every region from one response', async () => {
    const { result } = renderHook(() => useTimeRecordsDashboard())

    await waitFor(() => expect(mocks.readUnified).toHaveBeenCalledTimes(1))
    expect(mocks.readUnified.mock.calls[0]?.[0]).toMatchObject({
      rangeMode: 'today',
      offset: 0,
    })
    await waitFor(() =>
      expect(result.current.sourceSummary.totalEffectiveSeconds).toBe(3600),
    )
    expect(result.current.trend[0]?.seconds).toBe(3600)
    expect(result.current.breakdown[0]?.seconds).toBe(3600)
    expect(result.current.totalRecords).toBe(100)
  })

  it('debounces keyword and applies the same keyword and kind to the unified request', async () => {
    const { result } = renderHook(() => useTimeRecordsDashboard())
    await waitFor(() => expect(mocks.readUnified).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.setKeyword('alpha')
      result.current.setKindFilter('english')
    })
    expect(mocks.readUnified).toHaveBeenCalledTimes(2)
    expect(mocks.readUnified.mock.calls.at(-1)?.[0]).toMatchObject({
      keyword: '',
      kind: 'english',
    })

    await waitFor(
      () => expect(mocks.readUnified).toHaveBeenCalledTimes(3),
      { timeout: 700 },
    )
    expect(mocks.readUnified.mock.calls.at(-1)?.[0]).toMatchObject({
      keyword: 'alpha',
      kind: 'english',
      offset: 0,
    })
  })

  it('resets pagination when sorting changes without maintaining separate summaries', async () => {
    const { result } = renderHook(() => useTimeRecordsDashboard())
    await waitFor(() => expect(mocks.readUnified).toHaveBeenCalledTimes(1))

    act(() => result.current.setPage(3))
    await waitFor(() =>
      expect(mocks.readUnified.mock.calls.at(-1)?.[0]).toMatchObject({ offset: 40 }),
    )

    act(() => result.current.setSortBy('effective_seconds'))
    await waitFor(() =>
      expect(mocks.readUnified.mock.calls.at(-1)?.[0]).toMatchObject({
        offset: 0,
        sortBy: 'effective_seconds',
      }),
    )
    expect(result.current.page).toBe(1)
    expect(result.current.sourceSummary.totalEffectiveSeconds).toBe(3600)
  })

  it('ignores a stale response after a newer filter request completes', async () => {
    const { result } = renderHook(() => useTimeRecordsDashboard())
    await waitFor(() => expect(mocks.readUnified).toHaveBeenCalledTimes(1))

    let resolveSlow: ((value: unknown) => void) | undefined
    const slowResponse = new Promise((resolve) => {
      resolveSlow = resolve
    })
    mocks.readUnified
      .mockImplementationOnce(() => slowResponse)
      .mockResolvedValueOnce(response({
        items: [{ id: 'latest', title: 'Latest' }],
        total: 1,
      }))

    act(() => result.current.setSortBy('effective_seconds'))
    await waitFor(() => expect(mocks.readUnified).toHaveBeenCalledTimes(2))
    act(() => result.current.setSortBy('title'))
    await waitFor(() => expect(result.current.visibleRecords[0]?.id).toBe('latest'))

    await act(async () => {
      resolveSlow?.(response({
        items: [{ id: 'stale', title: 'Stale' }],
        total: 1,
      }))
      await slowResponse
    })
    expect(result.current.visibleRecords[0]?.id).toBe('latest')
  })
})
