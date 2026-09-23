import { describe, expect, it } from 'vitest'
import type { FreestyleCard, FreestyleFeedConfig } from '@/shared/api/contracts'
import { sanitizeFreestyleFeedConfig } from './feedConfig'
import {
  applyCompletedIdsToRoundPlan,
  syncCompletedIdsToRoundPlan,
  countIncompletePalaceUnits,
  createRoundPlan,
  isSequentialPalaceBlocked,
  planCardStatus,
  reorderRoundPlan,
  sanitizeRoundPlan,
  stampRestudyPlan,
  updateRoundPlanCard,
} from './roundPlan'
import {
  cardPalaceId,
  createRetryOccurrence,
  insertRetryOccurrenceAfterGap,
  removeRetryOccurrencesForSource,
} from './queueState'

const config = {
  content: { mindmap_branch: true, anki_card: false, quiz_question: false },
  mix_mode: 'sequential_map_quiz',
  mix_ratio: { mindmap: 1, quiz: 1 },
  palace_order: 'finish_palace_then_next',
  due_policy: 'due_only',
  quiz_scope: 'cross_palace_random',
  question_type: 'all',
  quiz_mastery_buckets: ['unseen'],
  specific_palace_ids: [],
  queue_length: 50,
  seed: 17,
} as unknown as FreestyleFeedConfig

function card(id: string, palaceId: number): FreestyleCard {
  return {
    id,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: palaceId,
    palace_title: `宫殿 ${palaceId}`,
    anchor_uid: `${id}-anchor`,
    context_path: [{ uid: `${id}-anchor`, text: id }],
    node_uids: [`${id}-node`],
    node_count: 1,
    unit_id: `${id}-unit`,
    unit_revision: 1,
  }
}

describe('round plan reducer', () => {
  it('creates an immediate retry occurrence after three usable cards', () => {
    const cards = [card('a', 1), card('b', 1), card('c', 1), card('d', 1), card('e', 1)]
    const retry = createRetryOccurrence(cards[0], 'round-1', 1, 3)
    const next = insertRetryOccurrenceAfterGap(cards, retry, 0)
    expect(next.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd', retry.id, 'e'])
    expect(next[4].source_card_id).toBe('a')
    expect(removeRetryOccurrencesForSource(next, 'a').map((item) => item.id)).toEqual(cards.map((item) => item.id))
    const plan = createRoundPlan('round-1', cards, config)
    const retryPlan = createRoundPlan('round-1', next, config, undefined, plan)
    expect(retryPlan.orderIds).toEqual(['a', 'b', 'c', 'd', retry.id, 'e'])
    expect(retryPlan.cardsById[retry.id].retryAfterCards).toBe(3)
  })

  it('stamps a weak rating onto the source and the inserted retry without waiting for leave', () => {
    const cards = [card('a', 1), card('b', 1), card('c', 1), card('d', 1), card('e', 1)]
    const prior = createRoundPlan('round-1', cards, config)
    const retry = createRetryOccurrence(cards[0], 'round-1', 1, 3)
    const next = insertRetryOccurrenceAfterGap(cards, retry, 0)
    const stamped = stampRestudyPlan(prior, next, 'round-1', config, [{
      cardId: 'a',
      rating: 1,
      retryAfterCards: 3,
      attempt: 1,
    }])
    expect(stamped).not.toBeNull()
    expect(stamped!.orderIds).toEqual(['a', 'b', 'c', 'd', retry.id, 'e'])
    expect(stamped!.cardsById.a).toMatchObject({
      status: 'retry',
      lastRating: 1,
      retryAfterCards: 3,
      attemptCount: 1,
    })
    expect(stamped!.cardsById[retry.id]).toMatchObject({
      status: 'retry',
      occurrenceKind: 'retry',
      sourceCardId: 'a',
      retryAttempt: 1,
      retryAfterCards: 3,
      lastRating: null,
    })
  })

  it('keeps a retry glance blank until that glance is rated', () => {
    const cards = [card('a', 1), card('b', 1)]
    const prior = createRoundPlan('round-1', cards, config)
    const retry = createRetryOccurrence(cards[0], 'round-1', 1, 3)
    const inserted = insertRetryOccurrenceAfterGap(cards, retry, 0)
    const scheduled = stampRestudyPlan(prior, inserted, 'round-1', config, [{
      cardId: 'a',
      rating: 2,
      retryAfterCards: 3,
      attempt: 1,
    }])
    expect(scheduled!.cardsById.a.lastRating).toBe(2)
    expect(scheduled!.cardsById[retry.id].lastRating).toBeNull()

    const ratedRetry = stampRestudyPlan(scheduled, inserted, 'round-1', config, [{
      cardId: retry.id,
      rating: 3,
      retryAfterCards: 0,
      attempt: 1,
    }])
    expect(ratedRetry!.cardsById.a.lastRating).toBe(2)
    expect(ratedRetry!.cardsById[retry.id].lastRating).toBe(3)
  })

  it('replaces an existing retry for the same source instead of stacking a second copy', () => {
    const cards = [card('a', 1), card('b', 1), card('c', 1), card('d', 1), card('e', 1)]
    const first = createRetryOccurrence(cards[0], 'round-1', 1, 3)
    const withFirst = insertRetryOccurrenceAfterGap(cards, first, 0, 3)
    const next = insertRetryOccurrenceAfterGap(
      withFirst,
      { ...first, retry_attempt: 2 },
      withFirst.findIndex((item) => item.id === first.id),
      3,
    )
    expect(next.filter((item) => item.occurrence_kind === 'retry').map((item) => item.id)).toEqual([first.id])
    expect(next.find((item) => item.id === first.id)?.retry_attempt).toBe(2)
  })

  it('keeps only one retry plan row per source unit', () => {
    const cards = [card('a', 1), card('b', 1)]
    const first = createRetryOccurrence(cards[0], 'round-1', 1, 3)
    const second = createRetryOccurrence(cards[0], 'round-1', 2, 3)
    const plan = createRoundPlan('round-1', [...cards, first, second], config)
    const retryIds = plan.orderIds.filter((id) => plan.cardsById[id]?.occurrenceKind === 'retry')
    expect(retryIds).toHaveLength(1)
    const sanitized = sanitizeRoundPlan({
      ...plan,
      orderIds: [...plan.orderIds, first.id, second.id],
      cardsById: {
        ...plan.cardsById,
        [first.id]: { ...plan.cardsById[retryIds[0]], cardId: first.id, retryAttempt: 1, status: 'completed' },
        [second.id]: { ...plan.cardsById[retryIds[0]], cardId: second.id, retryAttempt: 2, status: 'retry' },
      },
    })
    const sanitizedRetry = sanitized?.orderIds.filter((id) => sanitized.cardsById[id]?.occurrenceKind === 'retry') ?? []
    expect(sanitizedRetry).toHaveLength(1)
  })

  it('repairs a retry row that was persisted with 0张后', () => {
    const cards = [card('a', 1), card('b', 1), card('c', 1)]
    const retry = createRetryOccurrence(cards[0], 'round-1', 1, 0)
    const next = [...cards, { ...retry, retry_after_cards: 0 }]
    const previous = createRoundPlan('round-1', next, config)
    previous.cardsById[retry.id] = { ...previous.cardsById[retry.id], retryAfterCards: 0 }
    const repaired = createRoundPlan('round-1', next, config, undefined, previous)
    expect(repaired.cardsById[retry.id].retryAfterCards).toBe(3)
  })

  it('keeps a retry occurrence in its original palace near the next palace', () => {
    const cards = [card('a', 1), card('b', 1), card('c', 2), card('d', 2)]
    const retry = createRetryOccurrence(cards[1], 'round-1', 1, 3)
    const next = insertRetryOccurrenceAfterGap(cards, retry, 1, 3)

    expect(next.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd', retry.id])
    expect(cardPalaceId(next[4])).toBe(1)

    const rebuilt = createRoundPlan('round-1', next, config, undefined, createRoundPlan('round-1', cards, config))
    expect(rebuilt.orderIds).toEqual(['a', 'b', 'c', 'd', retry.id])

    const stalePlan = updateRoundPlanCard(
      createRoundPlan('round-1', next, config),
      retry.id,
      { status: 'retry' },
    )
    stalePlan.orderIds = ['a', 'b', retry.id, 'c', 'd']
    const repaired = createRoundPlan('round-1', next, config, undefined, stalePlan)
    expect(repaired.orderIds).toEqual(['a', 'b', 'c', 'd', retry.id])
  })

  it.each([
    [0, ['a', 'b', 'c', 'd', 'retry', 'next']],
    [1, ['a', 'b', 'retry', 'c', 'd', 'next']],
    [2, ['a', 'b', 'c', 'retry', 'd', 'next']],
    [3, ['a', 'b', 'c', 'd', 'retry', 'next']],
  ])('places a retry after at most %i presented cards', (gap, expected) => {
    const cards = [card('a', 1), card('b', 1), card('c', 1), card('d', 1), card('next', 2)]
    const retry = createRetryOccurrence(cards[0], 'round-1', 1, gap)
    const next = insertRetryOccurrenceAfterGap(cards, retry, 0, gap)
    const expectedIds = expected.map((id) => id === 'retry' ? retry.id : id)
    expect(next.map((item) => item.id)).toEqual(expectedIds)
  })

  it('counts quiz cards toward the retry gap', () => {
    const quiz = (id: string): FreestyleCard =>
      ({ id, type: 'quiz_question' }) as FreestyleCard
    const cards = [card('a', 1), quiz('q1'), quiz('q2'), quiz('q3'), card('b', 2)]
    const retry = createRetryOccurrence(cards[0], 'round-1', 1, 3)
    const next = insertRetryOccurrenceAfterGap(cards, retry, 0, 3)
    expect(next.map((item) => item.id)).toEqual(['a', 'q1', 'q2', 'q3', retry.id, 'b'])
    expect(cardPalaceId(next[4])).toBe(1)
  })

  it('reorders unstarted cards when palace_order or unit_order changes', () => {
    const sequential = sanitizeFreestyleFeedConfig({
      training_mode: 'memory_palace',
      streams: {
        memory_palace: {
          due_policy: 'due_only',
          palace_order: 'finish_palace_then_next',
          unit_order: 'structured',
        },
      },
    })
    const interleaved = sanitizeFreestyleFeedConfig({
      ...sequential,
      streams: {
        ...sequential.streams,
        memory_palace: {
          ...sequential.streams.memory_palace,
          palace_order: 'interleave_palaces',
          unit_order: 'random',
        },
      },
    })
    const first = createRoundPlan(
      'round-1',
      [card('a1', 1), card('a2', 1), card('b1', 2), card('b2', 2)],
      sequential,
    )
    const completed = updateRoundPlanCard(first, 'a1', { status: 'completed' })
    const rebuilt = createRoundPlan(
      'round-1',
      [card('a1', 1), card('b1', 2), card('a2', 1), card('b2', 2)],
      interleaved,
      undefined,
      completed,
    )
    expect(rebuilt.orderIds).toEqual(['a1', 'b1', 'a2', 'b2'])
    expect(rebuilt.cardsById.a1.status).toBe('completed')
  })

  it('keeps stable order and metadata across queue rebuilds', () => {
    const first = createRoundPlan(
      'round-1',
      [card('a', 1), card('b', 1), card('c', 2)],
      config,
      { candidate_count: 9, scheduled_count: 3, queue_limit: 50, limit_reached: false },
    )
    const completed = updateRoundPlanCard(first, 'a', { status: 'completed', lastRating: 3 })
    const rebuilt = createRoundPlan(
      'round-1',
      [card('c', 2), card('b', 1)],
      config,
      { candidate_count: 8, scheduled_count: 2, queue_limit: 50, limit_reached: false },
      completed,
    )
    expect(rebuilt.orderIds).toEqual(['a', 'b', 'c'])
    expect(rebuilt.cardsById.a.status).toBe('completed')
    expect(rebuilt.candidateCount).toBe(8)
  })

  it('preserves terminal and retry entries when a rebuild omits them', () => {
    const first = createRoundPlan('round-1', [card('a', 1), card('b', 1)], config)
    const retry = updateRoundPlanCard(first, 'a', { status: 'retry', retryAfterCards: 3 })
    const stale = updateRoundPlanCard(retry, 'b', { status: 'stale' })
    const rebuilt = createRoundPlan('round-1', [], config, undefined, stale)
    expect(rebuilt.orderIds).toEqual(['a'])
    expect(rebuilt.cardsById.a.status).toBe('retry')
    expect(rebuilt.cardsById.b).toBeUndefined()
  })

  it('does not inherit another roundId plan ledger into a new round', () => {
    const previous = updateRoundPlanCard(
      createRoundPlan('round-old', [card('a', 1), card('b', 1)], config),
      'a',
      { status: 'retry', lastRating: 2, retryAfterCards: 3 },
    )
    const next = createRoundPlan('round-new', [card('a', 1)], config, undefined, previous)
    expect(next.roundId).toBe('round-new')
    expect(next.cardsById.a.status).toBe('pending')
    expect(next.cardsById.a.lastRating).toBeNull()
    expect(next.orderIds).toEqual(['a'])
  })

  it('drops foreign retry occurrence ids even when previous.roundId matches', () => {
    const first = createRoundPlan('round-1', [card('a', 1)], config)
    const polluted = {
      ...first,
      cardsById: {
        ...first.cardsById,
        'retry:other-round:a:1': {
          cardId: 'retry:other-round:a:1',
          sourceCardId: 'a',
          occurrenceKind: 'retry' as const,
          retryAttempt: 1,
          palaceId: 1,
          palaceTitle: '',
          label: 'a',
          kind: 'mindmap_branch',
          status: 'retry' as const,
          lastRating: 2,
          retryAfterCards: 3,
          attemptCount: 1,
          updatedAt: Date.now(),
        },
      },
      orderIds: [...first.orderIds, 'retry:other-round:a:1'],
    }
    const rebuilt = createRoundPlan('round-1', [card('a', 1)], config, undefined, polluted)
    expect(rebuilt.cardsById['retry:other-round:a:1']).toBeUndefined()
    expect(rebuilt.orderIds).toEqual(['a'])
  })

  it('lets a freshly rebuilt card replace an old stale entry with the same id', () => {
    const first = createRoundPlan('round-1', [card('a', 1)], config)
    const stale = updateRoundPlanCard(first, 'a', { status: 'stale' })
    const rebuilt = createRoundPlan('round-1', [card('a', 1)], config, undefined, stale)

    expect(rebuilt.orderIds).toEqual(['a'])
    expect(rebuilt.cardsById.a.status).toBe('pending')
  })

  it('does not allow moving to another palace before all current units pass', () => {
    const cards = [card('a', 1), card('b', 1), card('c', 2)]
    expect(isSequentialPalaceBlocked(cards, 0, 2, [], config.palace_order)).toBe(true)
    expect(isSequentialPalaceBlocked(cards, 0, 2, ['a', 'b'], config.palace_order)).toBe(false)
  })

  it('never blocks looking back at a previous palace', () => {
    const cards = [card('a', 1), card('b', 1), card('c', 2)]
    expect(isSequentialPalaceBlocked(cards, 2, 1, [], config.palace_order)).toBe(false)
    expect(isSequentialPalaceBlocked(cards, 2, 0, [], config.palace_order)).toBe(false)
  })

  it('counts incomplete units per palace including retry occurrences', () => {
    const cards = [card('a', 1), card('b', 1), card('c', 2)]
    expect(countIncompletePalaceUnits(cards, 1, [])).toBe(2)
    expect(countIncompletePalaceUnits(cards, 1, ['a'])).toBe(1)
    expect(countIncompletePalaceUnits(cards, 1, ['a', 'b'])).toBe(0)
    expect(countIncompletePalaceUnits(cards, 2, [])).toBe(1)
    expect(countIncompletePalaceUnits(cards, null, [])).toBe(0)
    const retry = createRetryOccurrence(card('a', 1), 'round-1', 2, 3)
    const withRetry = [...cards, retry]
    expect(countIncompletePalaceUnits(withRetry, 1, ['a', 'b'])).toBe(1)
  })

  it('reorders only known plan entries and sanitizes corrupt persisted state', () => {
    const first = createRoundPlan('round-1', [card('a', 1), card('b', 1), card('c', 2)], config)
    const completed = updateRoundPlanCard(first, 'a', { status: 'completed' })
    const reordered = reorderRoundPlan(completed, ['c', 'missing', 'b'])
    expect(reordered.orderIds).toEqual(['a', 'c', 'b'])
    expect(sanitizeRoundPlan({ roundId: 'round-1', orderIds: ['a'], cardsById: {} })?.orderIds).toEqual([])
  })

  it('removes persisted stale entries before the next queue build', () => {
    const plan = sanitizeRoundPlan({
      roundId: 'round-1',
      orderIds: ['a', 'b'],
      cardsById: {
        a: { cardId: 'a', status: 'stale', kind: 'mindmap_branch' },
        b: { cardId: 'b', status: 'pending', kind: 'mindmap_branch' },
      },
    })

    expect(plan?.orderIds).toEqual(['b'])
    expect(plan?.cardsById.a).toBeUndefined()
  })

  it('reports active, retry and excluded status from the round state', () => {
    const first = createRoundPlan('round-1', [card('a', 1)], config)
    const retry = updateRoundPlanCard(first, 'a', { status: 'retry' })
    expect(planCardStatus(card('a', 1), retry, [], [], 'a')).toBe('active')
    expect(planCardStatus(card('a', 1), retry, [], [], null)).toBe('retry')
    expect(planCardStatus(card('a', 1), retry, [], ['a'], null)).toBe('excluded')
  })

  it('keeps completed ticks from the plan when completedIds were not yet restored', () => {
    const first = createRoundPlan('round-1', [card('a', 1), card('b', 1)], config)
    const done = applyCompletedIdsToRoundPlan(first, ['a'])
    expect(planCardStatus(card('a', 1), done, [], [], 'b')).toBe('completed')
    expect(planCardStatus(card('b', 1), done, [], [], 'b')).toBe('active')
  })

  it('drops a cancelled rating from completed ticks when hydrating the server set', () => {
    const first = createRoundPlan('round-1', [card('a', 1), card('b', 1)], config)
    const done = applyCompletedIdsToRoundPlan(first, ['a', 'b'])
    const synced = syncCompletedIdsToRoundPlan(done, ['b'])
    expect(planCardStatus(card('a', 1), synced, [], [], 'a')).toBe('active')
    expect(planCardStatus(card('b', 1), synced, ['b'], [], 'a')).toBe('completed')
  })
})
