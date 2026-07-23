import { describe, expect, it } from 'vitest'
import type { MindMapEditorState } from '@/shared/api/contracts'
import {
  buildGuidedMindMapModel,
  collectSubtreeUids,
} from './flipCardGuidedModel'

const fullDoc: MindMapEditorState = {
  editor_doc: {
    root: {
      data: { uid: 'root', text: 'Root' },
      children: [
        {
          data: { uid: 'a', text: 'A' },
          children: [{ data: { uid: 'a1', text: 'A1' }, children: [] }],
        },
        { data: { uid: 'b', text: 'B' }, children: [] },
      ],
    },
  },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
  editor_fingerprint: 'full',
}

const onlyRootVisible: MindMapEditorState = {
  editor_doc: {
    root: {
      data: { uid: 'root', text: 'Root' },
      children: [],
    },
  },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
  editor_fingerprint: 'visible',
}

describe('flipCardGuidedModel rating scope tree', () => {
  it('collects full subtree uids from the complete document', () => {
    const model = buildGuidedMindMapModel(fullDoc)
    expect(collectSubtreeUids(model.nodes, 'root', model.rootUid).sort()).toEqual(['a', 'a1', 'b'])
    expect(collectSubtreeUids(model.nodes, 'a', model.rootUid).sort()).toEqual(['a', 'a1'])
  })

  it('does not treat a collapsed visible tree as the rating source of truth', () => {
    const visible = buildGuidedMindMapModel(onlyRootVisible)
    const full = buildGuidedMindMapModel(fullDoc)
    // Visible-only model wrongly looks like a leaf root.
    expect(visible.nodes.some((node) => node.parentUid === 'root')).toBe(false)
    // Full document still has children for subtree scope.
    expect(full.nodes.some((node) => node.parentUid === 'root')).toBe(true)
    expect(collectSubtreeUids(full.nodes, 'root', full.rootUid).length).toBe(3)
  })

  it('resolves node identity from memoryAnkiId when uid is absent', () => {
    const idOnly: MindMapEditorState = {
      editor_doc: {
        root: {
          data: { text: 'Root', memoryAnkiId: 1 },
          children: [{ data: { text: 'Leaf', memoryAnkiId: 7 }, children: [] }],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
      editor_fingerprint: 'id-only',
    }
    const model = buildGuidedMindMapModel(idOnly)
    expect(model.rootUid).toBe('1')
    expect(model.byUid.has('7')).toBe(true)
    expect(collectSubtreeUids(model.nodes, '1', model.rootUid)).toEqual(['7'])
  })

  it('cascades through a single-child spine into multi-grandchild branches', () => {
    // P → C (only child) → G1/G2/G3 — cascade from P must include all grandchildren.
    const spineThenBranch: MindMapEditorState = {
      editor_doc: {
        root: {
          data: { uid: 'root', text: 'Root' },
          children: [
            {
              data: { uid: 'p', text: 'Parent' },
              children: [
                {
                  data: { uid: 'c', text: 'Child' },
                  children: [
                    { data: { uid: 'g1', text: 'G1' }, children: [] },
                    { data: { uid: 'g2', text: 'G2' }, children: [] },
                    { data: { uid: 'g3', text: 'G3' }, children: [] },
                  ],
                },
              ],
            },
          ],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
      editor_fingerprint: 'spine-then-branch',
    }
    const model = buildGuidedMindMapModel(spineThenBranch)
    expect(collectSubtreeUids(model.nodes, 'p', model.rootUid).sort()).toEqual([
      'c',
      'g1',
      'g2',
      'g3',
      'p',
    ])
    expect(collectSubtreeUids(model.nodes, 'c', model.rootUid).sort()).toEqual([
      'c',
      'g1',
      'g2',
      'g3',
    ])
  })
})
