import { describe, expect, it } from 'vitest'
import type { FreestyleLearningInterval } from '@/shared/api/contracts'
import {
  acknowledgeFreestyleLearningBatch,
  beginFreestyleLearningBatch,
  emptyFreestyleLearningOutbox,
  enqueueFreestyleLearningInterval,
  migrateLegacyFreestylePending,
  parseFreestyleLearningOutbox,
} from './freestyleLearningOutbox'

function interval(id: string): FreestyleLearningInterval {
  return {
    interval_id: id,
    session_id: 'round-1',
    started_at: '2026-01-01T00:00:00.000Z',
    ended_at: '2026-01-01T00:00:02.000Z',
    bucket: 'unit',
    client_source: 'desktop',
  }
}

describe('freestyle learning outbox', () => {
  it('keeps a failed batch identity and does not double-count it while in flight', () => {
    const queued = enqueueFreestyleLearningInterval(
      emptyFreestyleLearningOutbox('backfill-1'),
      interval('a'),
    )
    const inflight = beginFreestyleLearningBatch(queued, 'op-1')
    const retried = beginFreestyleLearningBatch(inflight, 'op-2')
    const withNewTick = enqueueFreestyleLearningInterval(retried, interval('b'))
    const acked = acknowledgeFreestyleLearningBatch(withNewTick, 'op-1')

    expect(retried.inflight?.operationId).toBe('op-1')
    expect(retried.pendingIntervals).toEqual([])
    expect(acked.pendingIntervals.map((item) => item.interval_id)).toEqual(['b'])
    expect(acked.inflight).toBeNull()
  })

  it('migrates a v1 scalar pending blob once', () => {
    const adds = migrateLegacyFreestylePending({
      unit_seconds: 4,
      quiz_seconds: 0,
      lookup_seconds: 0,
      backfilled: false,
      by_palace: {},
    })
    const parsed = parseFreestyleLearningOutbox({
      legacyAdds: adds,
      migratedV1: true,
    }, 'backfill-1')

    expect(adds).toEqual([{ bucket: 'unit', seconds: 4 }])
    expect(parsed.migratedV1).toBe(true)
    expect(parsed.legacyAdds).toEqual(adds)
  })
})
