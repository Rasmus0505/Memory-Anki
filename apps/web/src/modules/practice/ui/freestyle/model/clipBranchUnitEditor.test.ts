import { describe, expect, it } from 'vitest'
import {
  clipEditorStateToBranchUnit,
  foldedParentUidsForBranch,
} from './clipBranchUnitEditor'
import {
  advanceRevealStateForNodeClick,
  buildInitialRevealState,
  buildReviewTree,
  flattenNodes,
} from '@/modules/memory/domain/review-entity/model/review-flow-tree'
import type { MindMapEditorState } from '@/shared/api/contracts'

const fullState: MindMapEditorState = {
  editor_doc: {
    root: {
      data: { uid: 'root', text: 'Palace' },
      children: [
        {
          data: { uid: 'P', text: 'Parent' },
          children: [
            {
              data: { uid: 'L1A', text: 'L1A' },
              children: [
                {
                  data: { uid: 'L2A', text: 'L2A' },
                  children: [
                    { data: { uid: 'leaf0', text: 'Leaf0' }, children: [] },
                    { data: { uid: 'leaf1', text: 'Leaf1' }, children: [] },
                  ],
                },
              ],
            },
            {
              data: { uid: 'L1B', text: 'L1B' },
              children: [
                {
                  data: { uid: 'L2B', text: 'L2B' },
                  children: [{ data: { uid: 'leafB', text: 'LeafB' }, children: [] }],
                },
              ],
            },
          ],
        },
        {
          data: { uid: 'sibling', text: 'Sibling' },
          children: [],
        },
      ],
    },
  },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
  editor_fingerprint: 'fp1',
}

type ClipNode = {
  data: { uid: string; text?: string }
  children: ClipNode[]
}

function asRoot(clipped: MindMapEditorState): ClipNode {
  return (clipped.editor_doc as { root: ClipNode }).root
}

describe('clipEditorStateToBranchUnit', () => {
  it('builds a single-child spine from the real palace root with original titles', () => {
    const clipped = clipEditorStateToBranchUnit(fullState, 'L2A', 'Palace / Parent')
    const root = asRoot(clipped)

    // Real palace root — never a freestyle_unit_root path-string card.
    expect(root.data.uid).toBe('root')
    expect(root.data.text).toBe('Palace')
    expect(root.children).toHaveLength(1)

    const p = root.children[0]
    expect(p.data.uid).toBe('P')
    expect(p.data.text).toBe('Parent')
    expect(p.children).toHaveLength(1)

    const l1 = p.children[0]
    expect(l1.data.uid).toBe('L1A')
    expect(l1.children).toHaveLength(1)

    const l2 = l1.children[0]
    expect(l2.data.uid).toBe('L2A')
    expect(l2.children.map((c) => c.data.uid).sort()).toEqual(['leaf0', 'leaf1'])
    expect(clipped.editor_fingerprint).toContain('unit:L2A')
  })

  it('never concatenates the context path onto the root title', () => {
    const clipped = clipEditorStateToBranchUnit(
      fullState,
      'L2A',
      'Palace / Parent / L1A / L2A',
    )
    const root = asRoot(clipped)
    expect(root.data.text).toBe('Palace')
    expect(String(root.data.text || '')).not.toContain(' / ')
  })

  it('strips sibling branches outside the unit lineage', () => {
    const clipped = clipEditorStateToBranchUnit(fullState, 'L2A')
    const root = asRoot(clipped)
    // Sibling of P must not appear under root.
    expect(root.children.map((c) => c.data.uid)).toEqual(['P'])
    // Sibling L1B must not appear under P.
    expect(root.children[0].children.map((c) => c.data.uid)).toEqual(['L1A'])
  })

  it('ignores legacy includeAncestorUids (full path spine is always built)', () => {
    const clipped = clipEditorStateToBranchUnit(fullState, 'L2A', 'Palace', {
      includeAncestorUids: ['P'],
    })
    const root = asRoot(clipped)
    // Still full path: root → P → L1A → L2A, not a truncated fold.
    expect(root.data.uid).toBe('root')
    expect(root.children[0].data.uid).toBe('P')
    expect(root.children[0].children[0].data.uid).toBe('L1A')
  })

  it('returns original state when branch is missing', () => {
    const clipped = clipEditorStateToBranchUnit(fullState, 'missing', 'Palace')
    expect(clipped).toBe(fullState)
  })

  it('progressive flip starts root-only and opens path nodes one click at a time', () => {
    const clipped = clipEditorStateToBranchUnit(fullState, 'L2A')
    const root = buildReviewTree(clipped.editor_doc as never, 'Palace')
    const nodeMap = flattenNodes(root)

    const initial = buildInitialRevealState(root)
    expect(initial.root).toBe('revealed')
    expect(initial.P).toBe('hidden')
    expect(initial.L1A).toBe('hidden')
    expect(initial.L2A).toBe('hidden')
    expect(initial.leaf0).toBe('hidden')

    const afterRoot = advanceRevealStateForNodeClick('root', nodeMap, initial)
    expect(afterRoot.P).toBe('placeholder')
    expect(afterRoot.L1A).toBe('hidden')

    const afterP = advanceRevealStateForNodeClick(
      'P',
      nodeMap,
      advanceRevealStateForNodeClick('P', nodeMap, afterRoot),
    )
    expect(afterP.P).toBe('revealed')
    expect(afterP.L1A).toBe('placeholder')
    expect(afterP.L2A).toBe('hidden')
  })
})

describe('foldedParentUidsForBranch', () => {
  it('returns ratable ancestors between root and branch', () => {
    expect(
      foldedParentUidsForBranch(fullState, 'L2A', ['P', 'L1A', 'L2A', 'leaf0', 'leaf1']),
    ).toEqual(['P', 'L1A'])
  })

  it('skips ancestors not in the ratable set', () => {
    expect(foldedParentUidsForBranch(fullState, 'L2A', ['L1A', 'L2A', 'leaf0'])).toEqual([
      'L1A',
    ])
  })
})
