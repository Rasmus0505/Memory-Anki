import type { MindMapEditorState } from '@/shared/api/contracts'

export type MindMapSessionStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'conflicted' | 'error'

export interface MindMapSessionState<TMeta> {
  ownerId: number | null
  loadOperationId: number | null
  saveOperationId: number | null
  status: MindMapSessionStatus
  meta: TMeta | null
  editorState: MindMapEditorState | null
  dirty: boolean
  error: string | null
}

export type MindMapSessionAction<TMeta> =
  | { type: 'owner-cleared'; ownerId: number | null }
  | { type: 'load-started'; ownerId: number; operationId: number }
  | { type: 'load-succeeded'; ownerId: number; operationId: number; meta: TMeta; editorState: MindMapEditorState }
  | { type: 'load-failed'; ownerId: number; operationId: number; error: string }
  | { type: 'editor-changed'; editorState: MindMapEditorState }
  | { type: 'editor-replaced'; editorState: MindMapEditorState | null }
  | { type: 'external-state-adopted'; editorState: MindMapEditorState }
  | { type: 'save-started'; ownerId: number; operationId: number }
  | { type: 'save-succeeded'; ownerId: number; operationId: number; meta: TMeta; editorState?: MindMapEditorState; dirty: boolean }
  | { type: 'save-failed'; ownerId: number; operationId: number; error: string | null; dirty: boolean; conflicted: boolean }
  | { type: 'save-finished'; ownerId: number; operationId: number }
  | { type: 'meta-replaced'; meta: TMeta | null }
  | { type: 'operation-blocked'; error: string }

export function createMindMapSessionState<TMeta>(ownerId: number | null): MindMapSessionState<TMeta> {
  return {
    ownerId,
    loadOperationId: null,
    saveOperationId: null,
    status: 'idle',
    meta: null,
    editorState: null,
    dirty: false,
    error: null,
  }
}

export function mindMapSessionReducer<TMeta>(
  state: MindMapSessionState<TMeta>,
  action: MindMapSessionAction<TMeta>,
): MindMapSessionState<TMeta> {
  switch (action.type) {
    case 'owner-cleared':
      return createMindMapSessionState(action.ownerId)
    case 'load-started':
      return { ...state, ownerId: action.ownerId, loadOperationId: action.operationId, status: 'loading', error: null }
    case 'load-succeeded':
      if (state.ownerId !== action.ownerId || state.loadOperationId !== action.operationId) return state
      return { ...state, loadOperationId: null, status: 'ready', meta: action.meta, editorState: action.editorState, dirty: false, error: null }
    case 'load-failed':
      if (state.ownerId !== action.ownerId || state.loadOperationId !== action.operationId) return state
      return { ...state, loadOperationId: null, status: 'error', error: action.error }
    case 'editor-changed':
      return { ...state, status: state.status === 'saving' ? 'saving' : 'ready', editorState: action.editorState, dirty: true, error: null }
    case 'editor-replaced':
      return { ...state, editorState: action.editorState }
    case 'external-state-adopted':
      return { ...state, status: 'ready', editorState: action.editorState, dirty: false, error: null }
    case 'save-started':
      if (state.ownerId !== action.ownerId) return state
      return { ...state, saveOperationId: action.operationId, status: 'saving', dirty: false, error: null }
    case 'save-succeeded':
      if (state.ownerId !== action.ownerId || state.saveOperationId !== action.operationId) return state
      return {
        ...state,
        status: 'ready',
        meta: action.meta,
        editorState: action.editorState ?? state.editorState,
        dirty: action.dirty,
        error: null,
      }
    case 'save-failed':
      if (state.ownerId !== action.ownerId || state.saveOperationId !== action.operationId) return state
      return {
        ...state,
        status: action.conflicted ? 'conflicted' : action.error ? 'error' : 'ready',
        dirty: action.dirty,
        error: action.error,
      }
    case 'save-finished':
      if (state.ownerId !== action.ownerId || state.saveOperationId !== action.operationId) return state
      return { ...state, saveOperationId: null, status: state.status === 'saving' ? 'ready' : state.status }
    case 'meta-replaced':
      return { ...state, meta: action.meta }
    case 'operation-blocked':
      return { ...state, status: 'error', error: action.error }
  }
}
