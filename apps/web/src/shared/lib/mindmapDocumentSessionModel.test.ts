import { describe, expect, it } from 'vitest'
import { createMindMapSessionState, mindMapSessionReducer } from './mindmapDocumentSessionModel'

const editorState = { editor_doc: {}, editor_config: {}, editor_local_config: {}, lang: 'zh' }

describe('mindMapSessionReducer', () => {
  it('models load, edit, and save transitions explicitly', () => {
    let state = createMindMapSessionState<{ id: number }>(1)
    state = mindMapSessionReducer(state, { type: 'load-started', ownerId: 1, operationId: 1 })
    state = mindMapSessionReducer(state, {
      type: 'load-succeeded', ownerId: 1, operationId: 1, meta: { id: 1 }, editorState,
    })
    state = mindMapSessionReducer(state, { type: 'editor-changed', editorState: { ...editorState, lang: 'en' } })
    state = mindMapSessionReducer(state, { type: 'save-started', ownerId: 1, operationId: 2 })
    state = mindMapSessionReducer(state, {
      type: 'save-succeeded', ownerId: 1, operationId: 2, meta: { id: 1 }, dirty: false,
    })
    expect(state).toMatchObject({ status: 'ready', dirty: false, editorState: { lang: 'en' } })
  })

  it('ignores a stale owner load result', () => {
    const loading = mindMapSessionReducer(createMindMapSessionState<{ id: number }>(2), {
      type: 'load-started', ownerId: 2, operationId: 2,
    })
    const next = mindMapSessionReducer(loading, {
      type: 'load-succeeded', ownerId: 1, operationId: 1, meta: { id: 1 }, editorState,
    })
    expect(next).toBe(loading)
  })

  it('ignores a stale save operation for the same owner', () => {
    const saving = mindMapSessionReducer(createMindMapSessionState<{ id: number }>(1), {
      type: 'save-started', ownerId: 1, operationId: 2,
    })
    const next = mindMapSessionReducer(saving, {
      type: 'save-failed',
      ownerId: 1,
      operationId: 1,
      error: 'stale failure',
      dirty: true,
      conflicted: false,
    })
    expect(next).toBe(saving)
  })

  it('represents conflicts separately from generic errors', () => {
    const saving = mindMapSessionReducer(createMindMapSessionState(1), {
      type: 'save-started', ownerId: 1, operationId: 3,
    })
    const state = mindMapSessionReducer(saving, {
      type: 'save-failed',
      ownerId: 1,
      operationId: 3,
      error: '保存冲突',
      dirty: true,
      conflicted: true,
    })
    expect(state).toMatchObject({ status: 'conflicted', dirty: true, error: '保存冲突' })
  })
})
