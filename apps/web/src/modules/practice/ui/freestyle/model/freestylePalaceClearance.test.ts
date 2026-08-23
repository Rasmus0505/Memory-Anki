import { describe, expect, it } from 'vitest'
import { createRoundPlan, updateRoundPlanCard } from '@/modules/practice/domain/roundPlan'
import { DEFAULT_FREESTYLE_FEED_CONFIG } from '@/modules/practice/domain/feedConfig'
import { createRetryOccurrence } from '@/modules/practice/domain/queueState'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  buildPalaceClearance,
  isPalaceRoundCleared,
  leftoverDueForPalace,
  palaceClearanceCopy,
} from './freestylePalaceClearance'

function unit(id: string, palaceId: number, title = `宫殿 ${palaceId}`): FreestyleCard {
  return {
    id,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: palaceId,
    palace_title: title,
    anchor_uid: `${id}-anchor`,
    context_path: [{ uid: `${id}-anchor`, text: id }],
    node_uids: [`${id}-node`],
    node_count: 1,
    unit_id: `${id}-unit`,
    unit_revision: 1,
  }
}

function quiz(id: string, palaceId: number): FreestyleCard {
  return {
    id,
    type: 'quiz_question',
    content_type: 'quiz_question',
    palace_context: { id: palaceId, title: '宫殿', resolved_title: '宫殿' },
    group_key: `palace:${palaceId}`,
    question: {
      id: 1,
      palace_id: palaceId,
      question_type: 'multiple_choice',
      stem: id,
      options: [],
    },
  } as FreestyleCard
}

describe('isPalaceRoundCleared', () => {
  it('is false until every review unit of that palace is handled', () => {
    const cards = [unit('a', 1, '卢梭'), unit('b', 1, '卢梭'), unit('c', 2)]
    expect(isPalaceRoundCleared({
      cards,
      palaceId: 1,
      plan: createRoundPlan('r', cards, DEFAULT_FREESTYLE_FEED_CONFIG),
      encountersByCardId: { a: { selectedRating: 3 } as never },
      completedIds: ['a'],
    })).toBe(false)
    expect(isPalaceRoundCleared({
      cards,
      palaceId: 1,
      plan: createRoundPlan('r', cards, DEFAULT_FREESTYLE_FEED_CONFIG),
      encountersByCardId: {
        a: { selectedRating: 3 } as never,
        b: { selectedRating: 4 } as never,
      },
      completedIds: ['a', 'b'],
    })).toBe(true)
  })

  it('ignores quiz cards when deciding palace clearance', () => {
    const cards = [unit('a', 1, '卢梭'), quiz('q', 1)]
    expect(isPalaceRoundCleared({
      cards,
      palaceId: 1,
      plan: createRoundPlan('r', cards, DEFAULT_FREESTYLE_FEED_CONFIG),
      encountersByCardId: { a: { selectedRating: 3 } as never },
      completedIds: ['a'],
    })).toBe(true)
  })

  it('treats a pending restudy as unfinished even if the source was just rated', () => {
    const cards = [unit('a', 1, '卢梭')]
    expect(isPalaceRoundCleared({
      cards,
      palaceId: 1,
      plan: createRoundPlan('r', cards, DEFAULT_FREESTYLE_FEED_CONFIG),
      encountersByCardId: { a: { selectedRating: 1 } as never },
      pendingRestudyIds: ['a'],
    })).toBe(false)
  })

  it('treats an unrated retry occurrence as unfinished', () => {
    const source = unit('a', 1, '卢梭')
    const retry = createRetryOccurrence(source, 'r', 1, 3)
    const cards = [source, retry]
    expect(isPalaceRoundCleared({
      cards,
      palaceId: 1,
      plan: createRoundPlan('r', cards, DEFAULT_FREESTYLE_FEED_CONFIG),
      encountersByCardId: { a: { selectedRating: 1 } as never },
      completedIds: [],
    })).toBe(false)
    expect(isPalaceRoundCleared({
      cards,
      palaceId: 1,
      plan: createRoundPlan('r', cards, DEFAULT_FREESTYLE_FEED_CONFIG),
      encountersByCardId: {
        a: { selectedRating: 1 } as never,
        [retry.id]: { selectedRating: 3 } as never,
      },
      completedIds: [retry.id],
    })).toBe(true)
  })

  it('does not treat excluded unrated units as a finished palace', () => {
    const cards = [unit('a', 1, '卢梭'), unit('b', 1, '卢梭')]
    const plan = updateRoundPlanCard(
      createRoundPlan('r', cards, DEFAULT_FREESTYLE_FEED_CONFIG),
      'b',
      { status: 'excluded' },
    )
    expect(isPalaceRoundCleared({
      cards: [cards[0]],
      palaceId: 1,
      plan,
      encountersByCardId: { a: { selectedRating: 3 } as never },
      completedIds: ['a'],
      hiddenIds: ['b'],
    })).toBe(false)
  })
})

describe('palaceClearanceCopy', () => {
  it('says today is clear when nothing was left out of the round', () => {
    expect(palaceClearanceCopy({ palaceId: 1, palaceTitle: '卢梭', leftoverDue: 0 }))
      .toBe('《卢梭》今日安排已清')
  })

  it('keeps leftover due honest when the queue limit cut the palace', () => {
    expect(palaceClearanceCopy({ palaceId: 2, palaceTitle: '康德', leftoverDue: 3 }))
      .toBe('《康德》本轮已清，今日还剩 3')
  })
})

describe('leftoverDueForPalace / buildPalaceClearance', () => {
  it('reads leftover by palace id and builds the banner payload', () => {
    const cards = [unit('a', 7, '卢梭')]
    expect(leftoverDueForPalace({ 7: 2 }, 7)).toBe(2)
    expect(leftoverDueForPalace({}, 7)).toBe(0)
    expect(buildPalaceClearance(cards, 7, 2)).toEqual({
      palaceId: 7,
      palaceTitle: '卢梭',
      leftoverDue: 2,
    })
  })
})
