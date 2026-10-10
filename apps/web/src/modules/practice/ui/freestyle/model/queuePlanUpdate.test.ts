import { describe, expect, it } from 'vitest'
import { describeQueuePlanUpdate, isPalaceEditorPath } from './queuePlanUpdate'
import type { QueuePlanUpdateCard } from './queuePlanUpdate'

function card(
  id: string,
  palaceId: number,
  title: string,
  unitId = id,
): QueuePlanUpdateCard {
  return {
    id,
    type: 'mindmap_branch',
    palace_id: palaceId,
    palace_title: title,
    unit_id: unitId,
  }
}

describe('describeQueuePlanUpdate', () => {
  it('names the palace and keeps the rated-card promise', () => {
    const message = describeQueuePlanUpdate({
      before: [card('rated', 7, '进步教育运动', 'u-rated'), card('old', 7, '进步教育运动', 'u-old')],
      after: [
        card('rated', 7, '进步教育运动', 'u-rated'),
        card('new-a', 7, '进步教育运动', 'u-a'),
        card('new-b', 7, '进步教育运动', 'u-b'),
      ],
      completedIds: ['rated'],
    })
    expect(message).toBe('进步教育运动多了 2 张，少了 1 张，已评的还在')
  })

  it('does not count a newer revision of the same unit as a new card', () => {
    expect(describeQueuePlanUpdate({
      before: [card('review_unit:u1:r1', 3, '卢梭', 'u1')],
      after: [card('review_unit:u1:r2', 3, '卢梭', 'u1')],
      completedIds: [],
    })).toBe('已经是最新的')
  })

  it('says the current card moved on when it disappeared', () => {
    expect(describeQueuePlanUpdate({
      before: [card('gone', 7, '进步教育运动', 'u-gone'), card('stay', 7, '进步教育运动', 'u-stay')],
      after: [card('stay', 7, '进步教育运动', 'u-stay')],
      completedIds: [],
      currentCardGone: true,
    })).toBe('这张不在了，已换到下一张。进步教育运动少了 1 张')
  })

  it('recognises a palace editor path and ignores the shelf', () => {
    expect(isPalaceEditorPath('/palaces/30/edit')).toBe(true)
    expect(isPalaceEditorPath('/palaces/30/review')).toBe(false)
    expect(isPalaceEditorPath('/palaces')).toBe(false)
  })
})
