import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildTimeRecordRecoveryMutationId,
  clearPendingTimeRecordRecoveriesForTest,
  listPendingTimeRecordRecoveries,
  replayPendingTimeRecordRecoveries,
  upsertPendingTimeRecordRecovery,
  usePendingTimeRecordRecoveryAutoSync,
} from '@/modules/session/domain/session-entity/model/time-record-recovery'
import type { TimeSessionRecord } from '@/modules/session/domain/session-entity/model/session-records'

vi.mock('@/modules/session/domain/study-session-entity/api', () => ({
  createStudySessionRecordApi: vi.fn(),
}))

const { createStudySessionRecordApi } = await import('@/modules/session/domain/study-session-entity/api')

const REMOVED_TIME_RECORD_RECOVERY_EVENT = ['memory-anki', 'time-record-recovery:changed'].join('-')

function buildRecord(overrides: Partial<TimeSessionRecord> = {}): TimeSessionRecord {
  return {
    id: 'record-1',
    kind: 'practice',
    palaceId: 1,
    title: '测试',
    startedAt: '2026-06-18T10:00:00',
    endedAt: '2026-06-18T10:00:05',
    effectiveSeconds: 5,
    pauseCount: 0,
    completionMethod: 'left_page',
    durationEdited: false,
    events: [],
    ...overrides,
  }
}

describe('time-record recovery store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    clearPendingTimeRecordRecoveriesForTest()
    vi.mocked(createStudySessionRecordApi).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    clearPendingTimeRecordRecoveriesForTest()
  })

  it('stores a pending recovery entry keyed by record id', () => {
    upsertPendingTimeRecordRecovery(buildRecord(), {
      mutationId: buildTimeRecordRecoveryMutationId('record-1'),
    })

    expect(listPendingTimeRecordRecoveries()).toHaveLength(1)
    expect(listPendingTimeRecordRecoveries()[0]?.recordId).toBe('record-1')
  })

  it('does not dispatch the removed time record recovery change event', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    upsertPendingTimeRecordRecovery(buildRecord(), {
      mutationId: buildTimeRecordRecoveryMutationId('record-1'),
    })

    expect(dispatchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: REMOVED_TIME_RECORD_RECOVERY_EVENT }),
    )
  })

  it('removes the recovery entry after a successful replay', async () => {
    vi.mocked(createStudySessionRecordApi).mockResolvedValue({ item: null })
    upsertPendingTimeRecordRecovery(buildRecord(), {
      mutationId: buildTimeRecordRecoveryMutationId('record-1'),
    })

    await replayPendingTimeRecordRecoveries()

    expect(listPendingTimeRecordRecoveries()).toHaveLength(0)
  })

  it('automatically retries recovery on mount, online, and foreground return', async () => {
    vi.useFakeTimers()
    vi.mocked(createStudySessionRecordApi).mockResolvedValue({ item: null })
    upsertPendingTimeRecordRecovery(buildRecord(), {
      mutationId: buildTimeRecordRecoveryMutationId('record-1'),
    })

    renderHook(() => usePendingTimeRecordRecoveryAutoSync())
    await act(async () => {
      await Promise.resolve()
    })
    expect(createStudySessionRecordApi).toHaveBeenCalledTimes(1)

    upsertPendingTimeRecordRecovery(buildRecord({ id: 'record-2' }), {
      mutationId: buildTimeRecordRecoveryMutationId('record-2'),
    })
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await Promise.resolve()
    })
    expect(createStudySessionRecordApi).toHaveBeenCalledTimes(2)

    upsertPendingTimeRecordRecovery(buildRecord({ id: 'record-3' }), {
      mutationId: buildTimeRecordRecoveryMutationId('record-3'),
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(createStudySessionRecordApi).toHaveBeenCalledTimes(3)
  })

  it('keeps the recovery entry and marks it failed after replay errors', async () => {
    vi.mocked(createStudySessionRecordApi).mockRejectedValue(new Error('network down'))
    upsertPendingTimeRecordRecovery(buildRecord(), {
      mutationId: buildTimeRecordRecoveryMutationId('record-1'),
    })

    await replayPendingTimeRecordRecoveries()

    expect(listPendingTimeRecordRecoveries()).toHaveLength(1)
    expect(listPendingTimeRecordRecoveries()[0]?.status).toBe('failed')
  })
})
