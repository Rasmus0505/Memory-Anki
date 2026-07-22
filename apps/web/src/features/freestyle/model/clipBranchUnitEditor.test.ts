import { describe, expect, it } from 'vitest'
import {
  clipEditorStateToBranchUnit,
  foldedParentUidsForBranch,
} from './clipBranchUnitEditor'
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

describe('clipEditorStateToBranchUnit', () => {
  it('keeps only the unit subtree under a synthetic context root', () => {
    const clipped = clipEditorStateToBranchUnit(fullState, 'L2A', 'Palace / Parent')
    const root = (
      clipped.editor_doc as {
        root: { data: { uid: string; text: string }; children: unknown[] }
      }
    ).root
    expect(root.data.text).toBe('Palace / Parent')
    expect(root.data.uid).toContain('freestyle_unit_root')
    expect(root.children).toHaveLength(1)
    const unit = root.children[0] as {
      data: { uid: string }
      children: { data: { uid: string } }[]
    }
    expect(unit.data.uid).toBe('L2A')
    expect(unit.children.map((c) => c.data.uid).sort()).toEqual(['leaf0', 'leaf1'])
    expect(clipped.editor_fingerprint).toContain('unit:L2A')
  })

  it('wraps folded parents as a single-child spine without sibling branches', () => {
    const clipped = clipEditorStateToBranchUnit(fullState, 'L2A', 'Palace', {
      includeAncestorUids: ['P', 'L1A'],
    })
    const root = (
      clipped.editor_doc as {
        root: {
          children: Array<{
            data: { uid: string }
            children: Array<{
              data: { uid: string }
              children: Array<{ data: { uid: string }; children: unknown[] }>
            }>
          }>
        }
      }
    ).root
    const p = root.children[0]
    expect(p.data.uid).toBe('P')
    expect(p.children).toHaveLength(1)
    expect(p.children[0].data.uid).toBe('L1A')
    expect(p.children[0].children).toHaveLength(1)
    expect(p.children[0].children[0].data.uid).toBe('L2A')
    // Sibling L1B must not appear under P in the clipped unit.
    const pChildUids = p.children.map((c) => c.data.uid)
    expect(pChildUids).toEqual(['L1A'])
  })

  it('returns original state when branch is missing', () => {
    const clipped = clipEditorStateToBranchUnit(fullState, 'missing', 'Palace')
    expect(clipped).toBe(fullState)
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
