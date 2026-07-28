import { describe, expect, it } from 'vitest'
import { buildNextUnitQueue, buildUnitReviewEditorState } from './ReviewSession'
import type { ReviewUnitDto, UnitReviewSessionDto } from '@/modules/practice/public'

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

function baseSession(overrides: Partial<UnitReviewSessionDto> = {}): UnitReviewSessionDto {
  return {
    id: 'review-uuid',
    palace_id: 9,
    title: '宫殿',
    status: 'active',
    pending_unit_count: 1,
    completed_unit_count: 0,
    units: [],
    palace: {
      id: 9,
      title: '宫殿',
      editor_doc: fullDoc,
    },
    ...overrides,
  }
}

describe('ReviewSession unit behavior', () => {
  it('keeps the full palace document while unit membership controls rating scope', () => {
    const editorState = buildUnitReviewEditorState(baseSession())
    const doc = editorState.editor_doc as typeof fullDoc
    expect(doc.root.children.map((child) => child.data.uid)).toEqual(['branch-a', 'branch-b'])
    expect(doc).toEqual(fullDoc)
  })

  it('requeues failed units after at most three other units', () => {
    const current = {
      id: 'a',
      session_status: 'retry',
    } as ReviewUnitDto
    expect(buildNextUnitQueue(['a', 'b', 'c', 'd', 'e'], current)).toEqual(['b', 'c', 'd', 'a', 'e'])
  })

  it('requeues a single failed unit immediately', () => {
    const current = {
      id: 'a',
      session_status: 'retry',
    } as ReviewUnitDto
    expect(buildNextUnitQueue(['a'], current)).toEqual(['a'])
  })
})
