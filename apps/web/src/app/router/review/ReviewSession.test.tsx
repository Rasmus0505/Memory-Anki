import { describe, expect, it } from 'vitest'
import { normalizeReviewSessionContainerSession } from '@/widgets/mindmap-review-flow/ReviewSessionContainer'
import {
  buildReviewEditorState,
  buildReviewEyebrow,
  buildReviewTitle,
  toContainerSession,
} from './ReviewSession'
import type { ReviewScheduleSummary } from '@/shared/api/contracts'

const fullDoc = {
  root: {
    data: { uid: 'root', text: 'Root' },
    children: [
      {
        data: { uid: 'branch-a', text: 'Branch A' },
        children: [{ data: { uid: 'a1', text: 'A1' }, children: [] }],
      },
      {
        data: { uid: 'branch-b', text: 'Branch B' },
        children: [{ data: { uid: 'b1', text: 'B1' }, children: [] }],
      },
    ],
  },
}

function baseSession(overrides: Partial<ReviewScheduleSummary> = {}): ReviewScheduleSummary {
  return {
    id: 'review-uuid',
    palace_id: 9,
    algorithm_used: 'FSRS',
    review_type: 'fsrs',
    completed: false,
    due_at: null,
    due_node_count: 2,
    overdue_node_count: 0,
    schedule_count: 2,
    overdue_schedule_count: 0,
    next_due_date: '2026-01-01',
    frozen_due_node_uids: ['branch-a', 'a1'],
    review_entry_mode: 'node',
    review_entry_label: '节点复习',
    primary_branch_uid: 'branch-a',
    primary_branch_title: 'Branch A',
    palace: {
      id: 9,
      title: '宫殿',
      description: '',
      archived: false,
      editor_doc: fullDoc,
      pegs: [],
      attachments: [],
      chapters: [],
    },
    ...overrides,
  }
}

describe('ReviewSession FSRS normalization', () => {
  it('preserves the stable UUID and frozen due scope', () => {
    const result = normalizeReviewSessionContainerSession({
      id: 'review-uuid',
      palace_id: 9,
      algorithm_used: 'FSRS',
      review_type: 'fsrs',
      review_number: 0,
      frozen_due_node_uids: ['a', 'b'],
      due_node_count: 2,
      palace: {
        id: 9,
        title: '宫殿',
        description: '',
        archived: false,
        editor_doc: null,
        pegs: [],
        attachments: [],
        chapters: [],
      },
    })
    expect(result.id).toBe('review-uuid')
    expect(result.frozen_due_node_uids).toEqual(['a', 'b'])
    expect(result.due_node_count).toBe(2)
  })

  it('maps entry metadata through toContainerSession', () => {
    const result = toContainerSession(baseSession())
    expect(result.review_entry_mode).toBe('node')
    expect(result.primary_branch_uid).toBe('branch-a')
    expect(result.primary_branch_title).toBe('Branch A')
    expect(result.frozen_due_node_uids).toEqual(['branch-a', 'a1'])
  })

  it('clips the flip-card document to the primary branch in node mode', () => {
    const session = toContainerSession(baseSession())
    const editorState = buildReviewEditorState(session)
    const doc = editorState.editor_doc as typeof fullDoc
    expect(doc.root.children.map((child) => child.data.uid)).toEqual(['branch-a'])
    expect(doc.root.children[0].children[0].data.uid).toBe('a1')
  })

  it('keeps the full document for palace mode', () => {
    const session = toContainerSession(
      baseSession({
        review_entry_mode: 'palace',
        primary_branch_uid: null,
        primary_branch_title: null,
        review_entry_label: '开始复习',
      }),
    )
    const editorState = buildReviewEditorState(session)
    expect(editorState.editor_doc).toEqual(fullDoc)
  })

  it('labels node sessions with branch context', () => {
    const session = toContainerSession(baseSession())
    expect(buildReviewEyebrow(session)).toBe('节点复习')
    expect(buildReviewTitle(session)).toBe('宫殿 · Branch A')
  })
})
