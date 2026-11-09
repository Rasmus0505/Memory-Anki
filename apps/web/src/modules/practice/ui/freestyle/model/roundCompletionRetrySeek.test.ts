import { describe, expect, it } from 'vitest'
import type { FreestyleUnitEncounterState } from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  findEarliestCompleteSeekIndex,
  findUnscoredCompleteSeekIndices,
  prioritizeRetrySeekIndices,
  resolveFreestyleCompleteSeek,
} from './roundCompletion'

function card(
  id: string,
  overrides: Partial<FreestyleCard> = {},
): FreestyleCard {
  return {
    id,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: 1,
    palace_title: '宫殿 A',
    anchor_uid: `${id}-anchor`,
    context_path: [{ uid: `${id}-anchor`, text: id }],
    node_uids: [`${id}-node`],
    node_count: 1,
    unit_id: `${id}-unit`,
    unit_revision: 1,
    ...overrides,
  } as FreestyleCard
}

function encounter(
  overrides: Partial<FreestyleUnitEncounterState> = {},
): FreestyleUnitEncounterState {
  return {
    encounterId: 'e-1',
    roundId: 'round-1',
    unitRevision: 1,
    status: 'closed',
    sessionId: 's-1',
    selectedRating: 3,
    passed: true,
    retryAfterCards: 0,
    ...overrides,
  }
}

function retryOf(sourceId: string, attempt = 1) {
  return card(`retry:round-1:${sourceId}:${attempt}`, {
    source_card_id: sourceId,
    occurrence_kind: 'retry',
    retry_attempt: attempt,
  } as Partial<FreestyleCard>)
}

describe('完成 prefers blank 重练 over unscored cards', () => {
  // 2026-11-09：用户要求 ✔ 先回最早重练，再轮到最早未评分。
  it('seeks the blank 重练 before an earlier unscored source card', () => {
    const retry = retryOf('two')
    // `two` is answered by its blank 重练, so the unscored list is [one, retry].
    expect(findUnscoredCompleteSeekIndices(
      [card('one'), card('two'), retry],
      {},
      [],
      null,
    )).toEqual([0, 2])
    expect(findEarliestCompleteSeekIndex(
      [card('one'), card('two'), retry],
      {},
      [],
      null,
    )).toBe(2)
  })

  it('walks every blank 重练 before the earliest unscored card', () => {
    expect(prioritizeRetrySeekIndices(
      [0, 1, 2, 3],
      [card('one'), card('two'), retryOf('one'), retryOf('two')],
      null,
    )).toEqual([2, 3, 0, 1])
  })

  it('falls back to queue order when no blank 重练 exists', () => {
    expect(prioritizeRetrySeekIndices(
      [0, 2],
      [card('one'), card('two'), card('three')],
      null,
    )).toEqual([0, 2])
  })

  it('keeps a scored 重练 out of the target list', () => {
    const retry = retryOf('two')
    expect(findEarliestCompleteSeekIndex(
      [card('one'), card('two'), retry],
      {
        one: encounter({ selectedRating: 3, passed: true }),
        two: encounter({ selectedRating: 1, passed: false }),
        [retry.id]: encounter({ selectedRating: 3, passed: true }),
      },
    )).toBeNull()
  })
})

describe('resolveFreestyleCompleteSeek with blank 重练', () => {
  it('returns to the earliest blank 重练 even from an unscored card', () => {
    expect(resolveFreestyleCompleteSeek({
      roundComplete: false,
      cardCount: 4,
      earliestUnhandledIndex: 0,
      visualIndex: 0,
      unscoredIndices: [2, 0, 1],
      retryIndices: [2],
    })).toBe(2)
  })

  it('walks the unscored cards once the last 重练 is under the viewport', () => {
    expect(resolveFreestyleCompleteSeek({
      roundComplete: false,
      cardCount: 4,
      earliestUnhandledIndex: 0,
      visualIndex: 2,
      unscoredIndices: [2, 0, 1],
      retryIndices: [2],
    })).toBe(0)
  })

  it('does not paint a non-重练 index as a 重练 target', () => {
    expect(resolveFreestyleCompleteSeek({
      roundComplete: false,
      cardCount: 4,
      earliestUnhandledIndex: 0,
      visualIndex: 3,
      unscoredIndices: [0, 1],
      retryIndices: [2],
    })).toBe(0)
  })
})
