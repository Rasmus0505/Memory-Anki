import { describe, expect, it } from 'vitest'
import type { FreestyleRoundProgress, FreestyleRoundProgressItem } from '@/shared/api/contracts/freestyle'
import type { FreestyleProgressSummary } from './freestyleProgressSegments'
import { applyServerRoundProgress } from './freestyleProgressFromServer'

function item(overrides: Partial<FreestyleRoundProgressItem> & { card_id: string }): FreestyleRoundProgressItem {
  return {
    source_card_id: overrides.card_id,
    occurrence_kind: 'source',
    retry_attempt: 0,
    unit_id: `unit-${overrides.card_id}`,
    palace_id: 1,
    kind: 'mindmap_branch',
    entered_on: '2026-11-01',
    is_new: false,
    bedtime: false,
    is_quiz: false,
    status: 'pending',
    tone: 'pending',
    scored: false,
    own_rating: null,
    waiting_retry: false,
    available_at: null,
    servable: true,
    wrong: false,
    ...overrides,
  }
}

function serverProgress(overrides: Partial<FreestyleRoundProgress> = {}): FreestyleRoundProgress {
  return {
    plan_version: 3,
    current_card_id: 'b',
    current_index: 1,
    position: 2,
    position_base: 2,
    total: 2,
    scheduled_base: 2,
    done_count: 1,
    retry_count: 0,
    retry_inserted: 0,
    passed_count: 1,
    next_unfinished_id: 'b',
    fully_handled: false,
    waiting: { count: 0, next_ready_at: null },
    compressible_ids: [],
    wrong_unit_ids: ['unit-a'],
    items: [
      item({ card_id: 'a', status: 'done', tone: 'done', scored: true, own_rating: 3 }),
      item({ card_id: 'b', unit_id: 'unit-b' }),
    ],
    ...overrides,
  }
}

function localSummary(): FreestyleProgressSummary {
  return {
    segments: [
      { cardId: 'a', tone: 'done', palaceId: 1, palaceDone: false },
      { cardId: 'b', tone: 'current', palaceId: 1, palaceDone: false },
      { cardId: 'local-only', tone: 'pending', palaceId: 1, palaceDone: false },
    ],
    position: 3,
    total: 3,
    doneCount: 2,
    retryCount: 1,
    scheduledBase: 3,
    positionBase: 3,
    retryInserted: 1,
    passedCount: 2,
  }
}

describe('applyServerRoundProgress', () => {
  it('takes every count and position from the server', () => {
    const applied = applyServerRoundProgress(localSummary(), serverProgress())

    expect(applied.position).toBe(2)
    expect(applied.positionBase).toBe(2)
    expect(applied.total).toBe(2)
    expect(applied.scheduledBase).toBe(2)
    expect(applied.doneCount).toBe(1)
    expect(applied.retryCount).toBe(0)
    expect(applied.retryInserted).toBe(0)
    expect(applied.passedCount).toBe(1)
  })

  it('applies wrong and waiting flags to matching segments only', () => {
    const applied = applyServerRoundProgress(
      localSummary(),
      serverProgress({
        items: [
          item({ card_id: 'a', wrong: true }),
          item({ card_id: 'b', waiting_retry: true, retry_attempt: 2 }),
        ],
      }),
    )

    expect(applied.segments[0].wrong).toBe(true)
    expect(applied.segments[1].waitingRetry).toBe(true)
    expect(applied.segments[1].retryAttempt).toBe(2)
    const localOnly = applied.segments[2]
    expect(localOnly.cardId).toBe('local-only')
    expect(localOnly.wrong).toBeUndefined()
    expect(localOnly.waitingRetry).toBeUndefined()
  })

  it('maps all-correct question state from the server', () => {
    const applied = applyServerRoundProgress(localSummary(), serverProgress({
      items: [item({ card_id: 'a', quiz_all_correct: true }), item({ card_id: 'b' })],
    }))
    expect(applied.segments[0].quizAllCorrect).toBe(true)
    expect(applied.segments[1].quizAllCorrect).toBe(false)
  })

  it('keeps the local fill so an unsaved tap does not flicker', () => {
    const applied = applyServerRoundProgress(
      localSummary(),
      serverProgress({
        items: [item({ card_id: 'a', status: 'pending', tone: 'pending' })],
      }),
    )

    expect(applied.segments[0].tone).toBe('done')
  })

  it('returns the local summary unchanged without a server projection', () => {
    const local = localSummary()
    expect(applyServerRoundProgress(local, null)).toBe(local)
    expect(applyServerRoundProgress(local, undefined)).toBe(local)
  })
})
