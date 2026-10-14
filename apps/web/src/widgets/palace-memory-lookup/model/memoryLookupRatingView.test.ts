import { describe, expect, it } from 'vitest'
import {
  buildPermanentMarkRatingRows,
  descendantPermanentMarkUids,
  ratingMasteryByNode,
  buildRatingEditorState,
  pruneToPermanentMarks,
  unitIdByNodeFromPassStates,
} from './memoryLookupRatingView'

function sampleDoc() {
  return {
    root: {
      data: { uid: 'root', text: '根', permanentSplitMark: true },
      children: [
        {
          data: { uid: 'a', text: '甲' },
          children: [
            {
              data: { uid: 'a1', text: '甲一', permanentSplitMark: true },
              children: [{ data: { uid: 'a1x', text: '甲一的细节' }, children: [] }],
            },
          ],
        },
        {
          data: { uid: 'b', text: '乙', permanentSplitMark: true },
          children: [{ data: { uid: 'b1', text: '乙一' }, children: [] }],
        },
      ],
    },
  }
}

describe('pruneToPermanentMarks', () => {
  it('keeps the root and permanent marks, dropping unmarked nodes', () => {
    const pruned = pruneToPermanentMarks(sampleDoc()) as ReturnType<typeof sampleDoc>

    // "a1" is a mark under the unmarked "a", so it lifts up; its unmarked child is dropped.
    const topUids = pruned.root.children.map((node) => node.data.uid)
    expect(topUids).toEqual(['a1', 'b'])
    expect(pruned.root.children[0].children).toEqual([])
    expect(pruned.root.children[1].children).toEqual([])
  })

  it('re-parents a kept node to its nearest kept ancestor', () => {
    const doc = sampleDoc()
    const pruned = pruneToPermanentMarks(doc) as ReturnType<typeof sampleDoc>

    // "a" is unmarked, so "a1" lifts up under the root instead of disappearing.
    const rootChildren = pruned.root.children.map((node) => node.data.uid)
    expect(rootChildren).toContain('a1')
    expect(rootChildren).toContain('b')
    expect(rootChildren).not.toContain('a')
  })

  it('does not mutate the source document', () => {
    const doc = sampleDoc()
    pruneToPermanentMarks(doc)
    expect(doc.root.children).toHaveLength(2)
    expect(doc.root.children[0].children[0].children).toHaveLength(1)
  })

  it('returns null when there is no root', () => {
    expect(pruneToPermanentMarks(null)).toBeNull()
    expect(pruneToPermanentMarks({})).toBeNull()
  })

  it('accepts a JSON string doc', () => {
    const pruned = pruneToPermanentMarks(JSON.stringify(sampleDoc())) as ReturnType<typeof sampleDoc>
    expect(pruned.root.children.map((node) => node.data.uid)).toEqual(['a1', 'b'])
  })
})

describe('buildRatingEditorState', () => {
  it('replaces only editor_doc and keeps the rest of the state', () => {
    const state = {
      editor_doc: sampleDoc() as unknown as Record<string, unknown>,
      editor_config: { theme: 'x' },
      editor_local_config: {},
      lang: 'zh',
      editor_fingerprint: 'fp',
    }
    const next = buildRatingEditorState(state)

    expect(next.editor_config).toBe(state.editor_config)
    expect(next.editor_fingerprint).toBe('fp')
    expect((next.editor_doc as unknown as ReturnType<typeof sampleDoc>).root.children).toHaveLength(2)
  })
})

describe('buildPermanentMarkRatingRows', () => {
  it('lists every permanent mark with its unit rating, including unrated ones', () => {
    const rows = buildPermanentMarkRatingRows(
      sampleDoc(),
      { a1: 'unit-1', b: 'unit-2' },
      { 'unit-1': { rating: 2, revision: 4 } },
    )

    expect(rows.map((row) => row.nodeUid)).toEqual(['root', 'a1', 'b'])
    expect(rows.find((row) => row.nodeUid === 'a1')).toMatchObject({
      unitId: 'unit-1',
      rating: 2,
      revision: 4,
    })
    expect(rows.find((row) => row.nodeUid === 'b')).toMatchObject({
      unitId: 'unit-2',
      rating: null,
      revision: null,
    })
  })

  it('gives a node with no covering unit a null unit', () => {
    const rows = buildPermanentMarkRatingRows(sampleDoc(), {}, {})
    expect(rows.every((row) => row.unitId === null && row.rating === null)).toBe(true)
  })
})

describe('unitIdByNodeFromPassStates', () => {
  it('maps every node a unit covers to that unit', () => {
    expect(
      unitIdByNodeFromPassStates([
        { unit_id: 'unit-1', node_uids: ['a1', 'a2'] },
        { unit_id: 'unit-2', node_uids: ['b'] },
      ]),
    ).toEqual({ a1: 'unit-1', a2: 'unit-1', b: 'unit-2' })
  })
})

describe('descendantPermanentMarkUids', () => {
  it('returns every permanent mark below the given node, at any depth', () => {
    const doc = {
      root: {
        data: { uid: 'root', text: '根', permanentSplitMark: true },
        children: [
          {
            data: { uid: 'l1', text: 'L1', permanentSplitMark: true },
            children: [
              {
                data: { uid: 'mid', text: '中间' },
                children: [{ data: { uid: 'l2', text: 'L2', permanentSplitMark: true }, children: [] }],
              },
              { data: { uid: 'l2b', text: 'L2b', permanentSplitMark: true }, children: [] },
            ],
          },
        ],
      },
    }
    expect(descendantPermanentMarkUids(doc, 'l1').sort()).toEqual(['l2', 'l2b'])
    expect(descendantPermanentMarkUids(doc, 'l2')).toEqual([])
    expect(descendantPermanentMarkUids(doc, 'missing')).toEqual([])
  })
})

describe('ratingMasteryByNode', () => {
  it('maps each rated mark to its rating badge status and skips unrated ones', () => {
    const rows = [
      { nodeUid: 'a', text: 'A', unitId: 'u1', rating: 1, revision: 1 },
      { nodeUid: 'b', text: 'B', unitId: 'u2', rating: 4, revision: 1 },
      { nodeUid: 'c', text: 'C', unitId: 'u3', rating: null, revision: null },
    ]
    expect(ratingMasteryByNode(rows)).toEqual({
      a: { status: 'rating-forgot', manualLabel: null, masteryScore: null },
      b: { status: 'rating-easy', manualLabel: null, masteryScore: null },
    })
  })
})
