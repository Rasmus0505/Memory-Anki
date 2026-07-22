import { describe, expect, it } from 'vitest'
import { buildMindMapSaveCommand, readMindMapEditorSnapshot, readMindMapEditorState } from './snapshotAdapter'

describe('mind-map snapshot adapter', () => {
  it('prefers the canonical snapshot response', () => {
    const response = {
      editor_doc: { root: { data: { uid: 'legacy', text: 'legacy' }, children: [] } },
      snapshot: {
        schemaVersion: 1 as const,
        document: { schemaVersion: 1 as const, root: { data: { uid: 'root', text: 'canonical' }, children: [] } },
        editorPreferences: { theme: 'a' },
        localPreferences: {},
        language: 'zh',
        revision: 'r1',
      },
    }
    expect(readMindMapEditorState(response).editor_fingerprint).toBe('r1')
    expect(readMindMapEditorSnapshot(response).document.root.data?.text).toBe('canonical')
  })

  it('converts legacy responses and builds canonical save commands', () => {
    const state = readMindMapEditorState({
      editor_doc: { root: { data: { uid: 'root', text: 'legacy' }, children: [] } },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
      editor_fingerprint: 'legacy-revision',
    })
    expect(buildMindMapSaveCommand(state)).toMatchObject({ baseRevision: 'legacy-revision', snapshot: { schemaVersion: 1 } })
  })
})
