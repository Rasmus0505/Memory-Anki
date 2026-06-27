import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildTimeRecordRecoveryMutationId,
  clearPendingTimeRecordRecoveriesForTest,
  listPendingTimeRecordRecoveries,
  replayPendingTimeRecordRecoveries,
  upsertPendingTimeRecordRecovery,
} from '@/entities/session/model/time-record-recovery'
import type { TimeSessionRecord } from '@/entities/session/model/session-records'

vi.mock('@/entities/session/api/time-records', () => ({
  createTimeRecordApi: vi.fn(),
}))

const { createTimeRecordApi } = await import('@/entities/session/api/time-records')

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
    vi.mocked(createTimeRecordApi).mockReset()
  })

  afterEach(() => {
    clearPendingTimeRecordRecoveriesForTest()
  })

  it('stores a pending recovery entry keyed by record id', () => {
    upsertPendingTimeRecordRecovery(buildRecord(), {
      mutationId: buildTimeRecordRecoveryMutationId('record-1'),
    })

    expect(listPendingTimeRecordRecoveries()).toHaveLength(1)
    expect(listPendingTimeRecordRecoveries()[0]?.recordId).toBe('record-1')
  })

  it('removes the recovery entry after a successful replay', async () => {
    vi.mocked(createTimeRecordApi).mockResolvedValue({ item: buildRecord() })
    upsertPendingTimeRecordRecovery(buildRecord(), {
      mutationId: buildTimeRecordRecoveryMutationId('record-1'),
    })

    await replayPendingTimeRecordRecoveries()

    expect(listPendingTimeRecordRecoveries()).toHaveLength(0)
  })

  it('keeps the recovery entry and marks it failed after replay errors', async () => {
    vi.mocked(createTimeRecordApi).mockRejectedValue(new Error('network down'))
    upsertPendingTimeRecordRecovery(buildRecord(), {
      mutationId: buildTimeRecordRecoveryMutationId('record-1'),
    })

    await replayPendingTimeRecordRecoveries()

    expect(listPendingTimeRecordRecoveries()).toHaveLength(1)
    expect(listPendingTimeRecordRecoveries()[0]?.status).toBe('failed')
  })
})
