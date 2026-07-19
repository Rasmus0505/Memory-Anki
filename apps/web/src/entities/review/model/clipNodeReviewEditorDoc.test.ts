import { describe, expect, it } from 'vitest'
import { clipEditorDocToTopLevelBranch } from './clipNodeReviewEditorDoc'

const fullDoc = {
  root: {
    data: { uid: 'root', text: 'Root' },
    children: [
      {
        data: { uid: 'branch-a', text: 'A' },
        children: [{ data: { uid: 'a1', text: 'A1' }, children: [] }],
      },
      {
        data: { uid: 'branch-b', text: 'B' },
        children: [{ data: { uid: 'b1', text: 'B1' }, children: [] }],
      },
    ],
  },
}

describe('clipEditorDocToTopLevelBranch', () => {
  it('keeps only the requested top-level branch under root', () => {
    const clipped = clipEditorDocToTopLevelBranch(fullDoc, 'branch-a') as typeof fullDoc
    expect(clipped.root.children.map((child) => child.data.uid)).toEqual(['branch-a'])
    expect(clipped.root.children[0].children[0].data.uid).toBe('a1')
    // source document must stay intact
    expect(fullDoc.root.children).toHaveLength(2)
  })

  it('returns the original document when branch is missing or empty', () => {
    expect(clipEditorDocToTopLevelBranch(fullDoc, 'missing')).toBe(fullDoc)
    expect(clipEditorDocToTopLevelBranch(fullDoc, null)).toBe(fullDoc)
    expect(clipEditorDocToTopLevelBranch(fullDoc, '')).toBe(fullDoc)
  })

  it('accepts JSON string editor docs', () => {
    const clipped = clipEditorDocToTopLevelBranch(JSON.stringify(fullDoc), 'branch-b') as {
      root: { children: Array<{ data: { uid: string } }> }
    }
    expect(clipped.root.children.map((child) => child.data.uid)).toEqual(['branch-b'])
  })
})
