import { describe, expect, it } from 'vitest'
import { normalizeReviewSessionContainerSession } from '@/widgets/mindmap-review-flow/ReviewSessionContainer'

describe('ReviewSession FSRS normalization', () => {
  it('preserves the stable UUID and frozen due scope', () => {
    const result = normalizeReviewSessionContainerSession({
      id: 'review-uuid', palace_id: 9, algorithm_used: 'FSRS', review_type: 'fsrs', review_number: 0,
      frozen_due_node_uids: ['a', 'b'], due_node_count: 2,
      palace: { id: 9, title: '宫殿', description: '', archived: false, editor_doc: null, pegs: [], attachments: [], chapters: [] },
    })
    expect(result.id).toBe('review-uuid')
    expect(result.frozen_due_node_uids).toEqual(['a', 'b'])
    expect(result.due_node_count).toBe(2)
  })
})
