import { describe, expect, it } from 'vitest'
import type { FreestyleUnitEncounterState } from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  findUnscoredCompleteSeekIndices,
  isFreestyleRoundComplete,
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

describe('a blank 30 分钟回顾 after its source passed', () => {
  // 2026-10-25 的真实一轮：56 张里 42 张已评、11 张是源卡通过后自动排的
  // 「30 分钟后回顾」空白卡。源卡先通过（在 completed_ids 里），旧规则让每张
  // 空白回顾卡都继承了源卡的完成状态：进度条把它们画成待评，完成按钮却认为
  // 已经没有未评分的卡，于是整轮卡死。
  const source = card('review_unit:step-source:r1')
  const step = card('retry:round-1:step-source:1', {
    source_card_id: source.id,
    occurrence_kind: 'retry',
    retry_attempt: 1,
  } as Partial<FreestyleCard>)
  const cards = [source, step]
  const roundPlan = {
    cardsById: {
      [source.id]: { cardId: source.id, status: 'completed', lastRating: 3 },
      [step.id]: { cardId: step.id, status: 'retry', lastRating: null, occurrenceKind: 'retry' },
    },
  } as never
  const completedSource = [source.id]
  const sourceEncounter = { [source.id]: encounter({ selectedRating: 3, passed: true }) }

  it('is not complete while the step card is blank', () => {
    expect(isFreestyleRoundComplete(cards, sourceEncounter, completedSource, roundPlan)).toBe(false)
  })

  it('完成 can seek the blank step card instead of disabling itself', () => {
    expect(findUnscoredCompleteSeekIndices(cards, sourceEncounter, completedSource, roundPlan)).toEqual([1])
    expect(resolveFreestyleCompleteSeek({
      roundComplete: false,
      cardCount: cards.length,
      earliestUnhandledIndex: 1,
      visualIndex: 0,
      unscoredIndices: [1],
    })).toBe(1)
  })

  it('closes once the step card itself is scored', () => {
    const scored = {
      ...sourceEncounter,
      [step.id]: encounter({ selectedRating: 3, passed: true }),
    }
    expect(isFreestyleRoundComplete(cards, scored, [...completedSource, step.id], roundPlan)).toBe(true)
    expect(findUnscoredCompleteSeekIndices(cards, scored, [...completedSource, step.id], roundPlan)).toEqual([])
  })

  it('keeps a weak step score as a score (not a pass) for its own card', () => {
    const weakStep = {
      ...sourceEncounter,
      [step.id]: encounter({ selectedRating: 2, passed: false }),
    }
    // A weak 回顾 is still scored: it must not hold the round open.
    expect(isFreestyleRoundComplete(cards, weakStep, completedSource, roundPlan)).toBe(true)
  })
})
