import { describe, expect, it } from 'vitest'
import { deriveReviewFeedbackTransition } from '@/features/review/model/review-feedback'

const root = {
  id: 'root',
  text: 'root',
  note: '',
  parentId: null,
  children: [
    {
      id: 'parent',
      text: 'parent',
      note: '',
      parentId: 'root',
      children: [
        { id: 'child-a', text: 'a', note: '', parentId: 'parent', children: [] },
        { id: 'child-b', text: 'b', note: '', parentId: 'parent', children: [] },
      ],
    },
  ],
}

describe('deriveReviewFeedbackTransition', () => {
  it('treats hidden to placeholder as a category expand event with the placeholder node as primary', () => {
    const transition = deriveReviewFeedbackTransition({
      previousRevealMap: {
        root: 'revealed',
        parent: 'revealed',
        'child-a': 'hidden',
      },
      nextRevealMap: {
        root: 'revealed',
        parent: 'revealed',
        'child-a': 'placeholder',
      },
      root,
    })

    expect(transition.events).toContain('next_level_expand')
    expect(transition.expandedNodeIds).toEqual(['child-a'])
    expect(transition.primaryNodeId).toBe('child-a')
  })

  it('captures the last revealed node as primaryNodeId for card reveal', () => {
    const transition = deriveReviewFeedbackTransition({
      previousRevealMap: {
        parent: 'placeholder',
        'child-a': 'placeholder',
      },
      nextRevealMap: {
        parent: 'revealed',
        'child-a': 'revealed',
      },
      root,
    })

    expect(transition.events).toContain('card_reveal')
    expect(transition.primaryNodeId).toBe('child-a')
  })

  it('prefers cleared branch node id as primaryNodeId for branch clear', () => {
    const transition = deriveReviewFeedbackTransition({
      previousRevealMap: {
        parent: 'placeholder',
        'child-a': 'placeholder',
        'child-b': 'hidden',
      },
      nextRevealMap: {
        parent: 'placeholder',
        'child-a': 'revealed',
        'child-b': 'placeholder',
      },
      root,
    })

    expect(transition.events).toContain('branch_clear')
    expect(transition.branchClearNodeIds).toEqual(['parent'])
    expect(transition.primaryNodeId).toBe('parent')
  })
})
