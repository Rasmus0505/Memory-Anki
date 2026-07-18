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
})
