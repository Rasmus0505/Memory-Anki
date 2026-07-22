import { describe, expect, it } from 'vitest'
import type { SessionEventRecord } from '@/modules/session/domain/session-entity/model/session-records'
import { buildTimedSessionRecord } from './timedSessionRecordBuilder'

describe('timedSessionRecordBuilder', () => {
  it('builds an immutable session record from collected values', () => {
    const events: SessionEventRecord[] = [{ type: 'start', at: '2026-01-01 10:00:00' }]
    const sceneSegments = [{
      scene: 'freestyle' as const,
      kind: 'practice' as const,
      palaceId: null,
      sourceKind: null,
      englishCourseId: null,
      title: 'Memory',
      startedAt: '2026-01-01 10:00:00',
      endedAt: '2026-01-01 10:01:00',
      effectiveSeconds: 60,
    }]

    const record = buildTimedSessionRecord({
      id: 'record-1',
      kind: 'practice',
      palaceId: null,
      sourceKind: null,
      englishCourseId: null,
      title: 'Memory',
      startedAt: '2026-01-01 10:00:00',
      endedAt: '2026-01-01 10:02:00',
      effectiveSeconds: 120,
      pauseCount: 1,
      completionMethod: 'manual_complete',
      durationEdited: false,
      events,
      sceneSegments,
    })

    events.push({ type: 'pause', at: '2026-01-01 10:01:00' })
    sceneSegments.length = 0

    expect(record).toMatchObject({
      id: 'record-1',
      kind: 'practice',
      startedAt: '2026-01-01 10:00:00',
      endedAt: '2026-01-01 10:02:00',
      effectiveSeconds: 120,
      completionMethod: 'manual_complete',
      clientSource: 'desktop',
    })
    expect(record?.events).toHaveLength(1)
    expect(record?.sceneSegments).toHaveLength(1)
  })

  it('returns null without a start time', () => {
    expect(buildTimedSessionRecord({
      id: 'record-1',
      kind: 'practice',
      palaceId: null,
      sourceKind: null,
      englishCourseId: null,
      title: 'Memory',
      startedAt: null,
      endedAt: '2026-01-01 10:02:00',
      effectiveSeconds: 120,
      pauseCount: 1,
      completionMethod: 'manual_complete',
      durationEdited: false,
      events: [],
      sceneSegments: [],
    })).toBeNull()
  })
})
