import { describe, expect, it } from 'vitest'
import type { ReviewScheduleSummary } from '@/shared/api/contracts'
import {
  sanitizeReviewQueueViewSettings,
  sortReviewQueueItems,
} from './reviewQueueSort'

function item(
  partial: Partial<ReviewScheduleSummary> & Pick<ReviewScheduleSummary, 'palace_id' | 'next_due_at'>,
): ReviewScheduleSummary {
  return {
    id: partial.palace_id,
    palace_id: partial.palace_id,
    algorithm_used: 'FSRS',
    completed: false,
    review_type: 'fsrs',
    due_at: partial.next_due_at,
    next_due_at: partial.next_due_at,
    due_node_count: partial.due_node_count ?? 1,
    overdue_node_count: partial.overdue_node_count ?? 0,
    schedule_count: partial.due_node_count ?? 1,
    overdue_schedule_count: partial.overdue_node_count ?? 0,
    next_due_date: (partial.next_due_at ?? '').slice(0, 10),
    palace: partial.palace ?? {
      id: partial.palace_id,
      title: `Palace ${partial.palace_id}`,
      description: '',
      archived: false,
      editor_doc: null,
      pegs: [],
      attachments: [],
      chapters: [],
    },
  }
}

describe('sortReviewQueueItems', () => {
  const rows = [
    item({
      palace_id: 3,
      next_due_at: '2026-07-20T12:00:00+00:00',
      due_node_count: 2,
      overdue_node_count: 0,
      palace: {
        id: 3,
        title: 'Charlie',
        description: '',
        archived: false,
        editor_doc: null,
        pegs: [],
        attachments: [],
        chapters: [],
      },
    }),
    item({
      palace_id: 1,
      next_due_at: '2026-07-10T08:00:00',
      due_node_count: 5,
      overdue_node_count: 4,
      palace: {
        id: 1,
        title: 'Alpha',
        description: '',
        archived: false,
        editor_doc: null,
        pegs: [],
        attachments: [],
        chapters: [],
      },
    }),
    item({
      palace_id: 2,
      next_due_at: '2026-07-15T10:00:00Z',
      due_node_count: 1,
      overdue_node_count: 1,
      palace: {
        id: 2,
        title: 'Bravo',
        description: '',
        archived: false,
        editor_doc: null,
        pegs: [],
        attachments: [],
        chapters: [],
      },
    }),
  ]

  it('puts earliest due first by default (long-overdue first)', () => {
    expect(sortReviewQueueItems(rows).map((row) => row.palace_id)).toEqual([1, 2, 3])
  })

  it('sorts by due node count descending with due as tie-breaker', () => {
    expect(sortReviewQueueItems(rows, 'due_nodes_desc').map((row) => row.palace_id)).toEqual([1, 3, 2])
  })

  it('sorts by overdue node count descending', () => {
    expect(sortReviewQueueItems(rows, 'overdue_desc').map((row) => row.palace_id)).toEqual([1, 2, 3])
  })

  it('sorts by title ascending', () => {
    expect(sortReviewQueueItems(rows, 'title_asc').map((row) => row.palace?.title)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ])
  })
})

describe('sanitizeReviewQueueViewSettings', () => {
  it('falls back to due_asc for unknown modes', () => {
    expect(sanitizeReviewQueueViewSettings({ sortMode: 'nope' })).toEqual({ sortMode: 'due_asc' })
    expect(sanitizeReviewQueueViewSettings({ sortMode: 'due_nodes_desc' })).toEqual({
      sortMode: 'due_nodes_desc',
    })
  })
})
