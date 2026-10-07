import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimeSessionRecord } from '@/modules/session/public'

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
  pending: vi.fn(), remove: vi.fn(), serialize: vi.fn(),
}))
vi.mock('@/shared/api/http', () => ({ API_BASE: '/api/v1' }))
vi.mock('@/shared/api/apiToken', () => ({ getApiToken: () => 'test-token' }))
vi.mock('@/shared/persistence/mutationQueue', () => ({ enqueueMutation: mocks.enqueue }))
vi.mock('@/modules/session/public', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/session/public')>()
  return {
    // Keep the real (pure) attribution serializer so the unload body is covered.
    attributionToMetadata: actual.attributionToMetadata,
    buildTimeRecordRecoveryMutationId: (id: string) => `recovery:${id}`,
    removePendingTimeRecordRecovery: mocks.remove,
    serializeStudySessionRecordPayload: mocks.serialize,
    upsertPendingTimeRecordRecovery: mocks.pending,
  }
})
import { fireAndQueueTimeRecordOnUnload } from './timedSessionRecovery'

const record: TimeSessionRecord = {
  id: 'session-a', kind: 'custom', palaceId: null, title: '学习',
  startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:05:00.000Z',
  effectiveSeconds: 300, pauseCount: 0, completionMethod: 'saved', durationEdited: false,
  clientSource: 'desktop', events: [],
  activityIntervals: [{ startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:01:00.000Z' }],
}

describe('confirmed timer unload recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })
  it('queues and sends only confirmed intervals through the ledger endpoint', async () => {
    await fireAndQueueTimeRecordOnUnload(record)
    const queued = mocks.enqueue.mock.calls[0][0]
    expect(queued.url).toBe('/api/v1/study-sessions/time-ledger')
    const payload = JSON.parse(queued.body)
    expect(payload.intervals).toHaveLength(1)
    expect(payload.intervals[0].ended_at).toBe('2026-01-01T10:01:00.000Z')
    expect(payload.intervals[0].session_id).toBe('session-a')
    expect(fetch).toHaveBeenCalledWith(queued.url, expect.objectContaining({ body: queued.body, keepalive: true }))
    expect(mocks.serialize).not.toHaveBeenCalled()
  })

  it('carries subject/chapter/unit attribution through the unload path', async () => {
    // A closed tab used to drop exactly this: the interval reached the ledger
    // with no way to tell which subject the time belonged to.
    await fireAndQueueTimeRecordOnUnload({
      ...record,
      attribution: {
        subjectId: 4,
        subjectName: '中国教育史',
        chapterId: 6,
        chapterName: '第一节 民国初年的教育改革',
        unitLabel: '夸美纽斯宫殿',
        palaceId: 12,
        scene: 'freestyle',
        behavior: 'flip',
      },
    })
    const payload = JSON.parse(mocks.enqueue.mock.calls[0][0].body)
    expect(payload.intervals[0].metadata).toMatchObject({
      subject_id: 4,
      subject_name: '中国教育史',
      chapter_id: 6,
      chapter_name: '第一节 民国初年的教育改革',
      unit_label: '夸美纽斯宫殿',
      palace_id: 12,
      scene: 'freestyle',
      behavior: 'flip',
    })
  })
})
