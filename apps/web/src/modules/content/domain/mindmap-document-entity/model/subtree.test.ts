import { describe, expect, it } from 'vitest'
import {
  buildSubtreeUidMap,
  canAddMindMapBranchChild,
  canMutateMindMapBranchStructure,
  canRelocateMindMapBranchNodes,
  collectMindMapBranchScope,
  collectMindMapSubtreeUids,
  filterMindMapDocumentToNodeUids,
} from './subtree'

describe('buildSubtreeUidMap', () => {
  it('indexes each identified node with its identified descendants', () => {
    const result = buildSubtreeUidMap({
      root: {
        data: { uid: 'root' },
        children: [
          { data: { uid: 'branch' }, children: [{ data: { uid: 'leaf' } }] },
          { data: { text: 'wrapper' }, children: [{ data: { uid: 'nested' } }] },
        ],
      },
    })

    expect(result.get('root')).toEqual(['root', 'branch', 'leaf', 'nested'])
    expect(result.get('branch')).toEqual(['branch', 'leaf'])
    expect(result.get('leaf')).toEqual(['leaf'])
    expect(result.get('nested')).toEqual(['nested'])
  })

  it('ignores missing documents and nodes without stable uids', () => {
    expect(buildSubtreeUidMap(null)).toEqual(new Map())
    expect(buildSubtreeUidMap({ root: { data: { text: 'root' } } })).toEqual(new Map())
  })
})

describe('collectMindMapSubtreeUids', () => {
  const doc = {
    root: {
      data: { uid: 'root' },
      children: [
        { data: { uid: 'branch' }, children: [{ data: { uid: 'leaf' } }] },
        { data: { uid: 'other' } },
      ],
    },
  }

  it('returns the node plus every descendant that would vanish with it', () => {
    expect(collectMindMapSubtreeUids(doc, 'branch')).toEqual(['branch', 'leaf'])
    expect(collectMindMapSubtreeUids(doc, 'leaf')).toEqual(['leaf'])
    expect(collectMindMapSubtreeUids(doc, 'root')).toEqual(['root', 'branch', 'leaf', 'other'])
  })

  it('returns nothing for a uid that is not in the document', () => {
    expect(collectMindMapSubtreeUids(doc, 'missing')).toEqual([])
  })
})

describe('collectMindMapBranchScope', () => {
  const doc = {
    root: {
      data: { uid: 'root' },
      children: [
        {
          data: { uid: 'parent' },
          children: [
            {
              data: { uid: 'branch' },
              children: [
                { data: { uid: 'leaf-a' } },
                { data: { uid: 'leaf-b' } },
              ],
            },
            { data: { uid: 'sibling' } },
          ],
        },
        { data: { uid: 'other' } },
      ],
    },
  }

  it('keeps the root-to-branch spine and the branch subtree', () => {
    const scope = collectMindMapBranchScope(doc, 'branch')
    expect(scope?.pathUids).toEqual(['root', 'parent', 'branch'])
    expect([...scope!.keepUids].sort()).toEqual(['branch', 'leaf-a', 'leaf-b', 'parent', 'root'])
    expect(scope?.subtreeUids.has('sibling')).toBe(false)
    expect(scope?.keepUids.has('other')).toBe(false)
  })

  it('returns null when the branch is missing', () => {
    expect(collectMindMapBranchScope(doc, 'missing')).toBeNull()
    expect(collectMindMapBranchScope(doc, '')).toBeNull()
  })

  it('locks spine structure while allowing children on the unit root', () => {
    const scope = collectMindMapBranchScope(doc, 'branch')
    expect(canAddMindMapBranchChild(scope, 'branch')).toBe(true)
    expect(canAddMindMapBranchChild(scope, 'leaf-a')).toBe(true)
    expect(canAddMindMapBranchChild(scope, 'parent')).toBe(false)
    expect(canMutateMindMapBranchStructure(scope, 'branch')).toBe(false)
    expect(canMutateMindMapBranchStructure(scope, 'leaf-a')).toBe(true)
    expect(canRelocateMindMapBranchNodes(scope, ['leaf-a'], 'branch', 'inside')).toBe(true)
    expect(canRelocateMindMapBranchNodes(scope, ['leaf-a'], 'branch', 'after')).toBe(false)
    expect(canRelocateMindMapBranchNodes(scope, ['branch'], 'parent', 'inside')).toBe(false)
  })
})

describe('filterMindMapDocumentToNodeUids', () => {
  const doc = {
    root: {
      data: { uid: 'root', text: '根' },
      children: [
        {
          data: { uid: 'a', text: 'A' },
          children: [
            { data: { uid: 'a1', text: 'A1' } },
            { data: { uid: 'a2', text: 'A2' } },
          ],
        },
        {
          data: { uid: 'b', text: 'B' },
          children: [{ data: { uid: 'b1', text: 'B1' } }],
        },
      ],
    },
  }

  function uids(node: { data?: { uid?: string }; children?: unknown[] }): string[] {
    const own = String(node.data?.uid ?? '')
    const kids = (node.children ?? []) as Array<{ data?: { uid?: string }; children?: unknown[] }>
    return [own, ...kids.flatMap((child) => uids(child))]
  }

  it('keeps members and the ancestor spine, dropping sibling branches', () => {
    const filtered = filterMindMapDocumentToNodeUids(doc, ['a1'])

    expect(uids(filtered.root)).toEqual(['root', 'a', 'a1'])
  })

  it('keeps every member when a unit spans several branches', () => {
    const filtered = filterMindMapDocumentToNodeUids(doc, ['a2', 'b1'])

    expect(uids(filtered.root)).toEqual(['root', 'a', 'a2', 'b', 'b1'])
  })

  it('returns the whole document for an empty or unmatched member set', () => {
    expect(uids(filterMindMapDocumentToNodeUids(doc, []).root)).toEqual([
      'root',
      'a',
      'a1',
      'a2',
      'b',
      'b1',
    ])
    expect(uids(filterMindMapDocumentToNodeUids(doc, ['missing']).root)).toEqual([
      'root',
      'a',
      'a1',
      'a2',
      'b',
      'b1',
    ])
  })

  it('does not mutate the caller document', () => {
    filterMindMapDocumentToNodeUids(doc, ['a1'])

    expect(uids(doc.root)).toEqual(['root', 'a', 'a1', 'a2', 'b', 'b1'])
  })
})
