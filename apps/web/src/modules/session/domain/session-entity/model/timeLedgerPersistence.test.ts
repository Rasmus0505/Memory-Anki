import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  uploadTimeLedgerApi: vi.fn(),
  createStudySessionFromTimeRecordApi: vi.fn(),
  patchTimeLedgerApi: vi.fn(),
  deleteTimeLedgerApi: vi.fn(),
  patchStudySessionApi: vi.fn(),
  deleteStudySessionApi: vi.fn(),
  bulkDeleteStudySessionsApi: vi.fn(),
}))
vi.mock('@/modules/session/domain/study-session-entity/api', async (original) => ({
  ...await original<object>(),
  ...api,
}))
import {
  persistStudySessionRecord,
  updateStudySessionRecord,
  deleteStudySessionRecord,
  bulkDeleteStudySessionRecords,
} from './session-records-store'
import type { TimeSessionRecord } from './session-records'

beforeEach(() => {
  vi.clearAllMocks()
  api.patchTimeLedgerApi.mockResolvedValue({ item: null })
  api.patchStudySessionApi.mockResolvedValue({ item: null })
})

describe('time ledger persistence contract', () => {
  it('uploads confirmed intervals without writing a second SQLite duration', async () => {
    const record = {
      id: 'session-a', kind: 'practice', title: 'Learning',
      activityIntervals: [{ startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:01:00Z' }],
    } as TimeSessionRecord
    await persistStudySessionRecord(record)
    expect(api.uploadTimeLedgerApi).toHaveBeenCalledWith([expect.objectContaining({
      interval_id: 'session-a:2026-01-01T00:00:00Z:2026-01-01T00:01:00Z',
      session_id: 'session-a',
    })])
    expect(api.createStudySessionFromTimeRecordApi).not.toHaveBeenCalled()
  })

  it('never persists a provisional duration when there are no confirmed intervals', async () => {
    await persistStudySessionRecord({ id: 'session-a', activityIntervals: [], effectiveSeconds: 299 } as unknown as TimeSessionRecord)
    expect(api.uploadTimeLedgerApi).not.toHaveBeenCalled()
    expect(api.createStudySessionFromTimeRecordApi).not.toHaveBeenCalled()
  })

  it('routes ledger edits and deletion to ledger APIs while retaining legacy deletion', async () => {
    await updateStudySessionRecord('ledger:a:b', { title: 'Corrected', effectiveSeconds: 42 })
    expect(api.patchTimeLedgerApi).toHaveBeenCalledWith('a:b', { title: 'Corrected', effective_seconds: 42 })
    expect(api.patchStudySessionApi).not.toHaveBeenCalled()
    await deleteStudySessionRecord('ledger:a:b')
    await deleteStudySessionRecord('legacy-a')
    expect(api.deleteTimeLedgerApi).toHaveBeenCalledWith('a:b')
    expect(api.deleteStudySessionApi).toHaveBeenCalledWith('legacy-a')
  })

  it('splits a mixed bulk deletion by storage source', async () => {
    await bulkDeleteStudySessionRecords(['ledger:a', 'legacy-b', 'ledger:c'])
    expect(api.deleteTimeLedgerApi).toHaveBeenCalledWith('a')
    expect(api.deleteTimeLedgerApi).toHaveBeenCalledWith('c')
    expect(api.bulkDeleteStudySessionsApi).toHaveBeenCalledWith(['legacy-b'])
  })
})
