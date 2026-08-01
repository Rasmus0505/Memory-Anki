import { describe, expect, it } from 'vitest'
import type { FreestyleCard, FreestyleFeedConfig } from '@/shared/api/contracts'
import {
  countIncompletePalaceUnits,
  createRoundPlan,
  isSequentialPalaceBlocked,
  planCardStatus,
  reorderRoundPlan,
  sanitizeRoundPlan,
  updateRoundPlanCard,
} from './roundPlan'
import {
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
    expect(rebuilt.orderIds).toEqual(['a', 'b'])
    expect(rebuilt.cardsById.a.status).toBe('retry')
    expect(rebuilt.cardsById.b.status).toBe('stale')
  })

  it('does not allow moving to another palace before all current units pass', () => {
    const cards = [card('a', 1), card('b', 1), card('c', 2)]
    expect(isSequentialPalaceBlocked(cards, 0, 2, [], config.palace_order)).toBe(true)
    expect(isSequentialPalaceBlocked(cards, 0, 2, ['a', 'b'], config.palace_order)).toBe(false)
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
    expect(sanitizeRoundPlan({ roundId: 'round-1', orderIds: ['a'], cardsById: {} })?.orderIds).toEqual(['a'])
  })

  it('reports active, retry and excluded status from the round state', () => {
    const first = createRoundPlan('round-1', [card('a', 1)], config)
    const retry = updateRoundPlanCard(first, 'a', { status: 'retry' })
    expect(planCardStatus(card('a', 1), retry, [], [], 'a')).toBe('active')
    expect(planCardStatus(card('a', 1), retry, [], [], null)).toBe('retry')
    expect(planCardStatus(card('a', 1), retry, [], ['a'], null)).toBe('excluded')
  })
})
