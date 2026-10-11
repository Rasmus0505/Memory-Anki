import type { MindMapEditorState } from '@/shared/api/contracts'

export interface MindMapPersistenceAdapter<TResponse, TMeta> {
  load: (id: number) => Promise<TResponse>
  save: (id: number, data: PersistedMindMapSavePayload) => Promise<TResponse>
  selectMeta: (response: TResponse) => TMeta
  selectEditorState: (response: TResponse) => MindMapEditorState
}
export interface MindMapDocumentSessionOptions<TResponse, TMeta> {
  entityId: number | null
  loadCacheKey?: string
  adapter?: MindMapPersistenceAdapter<TResponse, TMeta>
  fetcher?: (id: number) => Promise<TResponse>
  saver?: (id: number, data: PersistedMindMapSavePayload) => Promise<TResponse>
  selectMeta?: (response: TResponse) => TMeta
  selectEditorState?: (response: TResponse) => MindMapEditorState
  onSaveError?: (error: Error, pendingState: MindMapEditorState) => Promise<boolean> | boolean
  beforeAutoSave?: (nextState: MindMapEditorState, currentState: MindMapEditorState | null) => string | null
  onLocalSnapshot?: (ownerId: number, snapshot: MindMapEditorState) => void
  /**
   * A conflict was resolved for this owner. The same rejected save may also be
   * parked in the mutation queue; the caller drops it here so it cannot linger
   * as an unresolvable entry.
   */
  onConflictResolved?: (ownerId: number) => void
}
export type PersistedMindMapSavePayload = MindMapEditorState & {
  expected_editor_fingerprint?: string | null
}
export interface ExternalStateGuard {
  expectedFingerprint: string
  releaseAt: number
}
export interface AdoptExternalStateOptions {
  protectFromStaleLoads?: boolean
  releaseAfterMs?: number
}
export type PersistedMindMapSaveStatus = 'saved' | 'saving' | 'unsaved' | 'error'
