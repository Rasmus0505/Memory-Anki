export interface MindMapEditorState {
  editor_doc: Record<string, unknown> | string | null
  editor_config: Record<string, unknown>
  editor_local_config: Record<string, unknown>
  lang: string
  editor_fingerprint?: string
}
export type PalaceEditorSource =
  | 'palace_edit'
  | 'palace_edit_autosave'
  | 'host_bootstrap_sync'
  | 'version_restore'
  | 'backup_restore'
  | 'import_apply'
  | 'review_edit'
  | 'practice_edit'
  | 'unknown'
export interface PalaceEditorSavePayload extends Partial<MindMapEditorState> {
  editor_source?: PalaceEditorSource
  response_mode?: 'full' | 'ack'
  sync_reason?: string | null
  /** When true, backend demotes/reconciles review units even for palace_edit_autosave. */
  reconcile_units?: boolean
  allow_stale_overwrite?: boolean
  confirm_dangerous_change?: boolean
  expected_editor_fingerprint?: string | null
}

export interface PalaceEditorSaveAckResponse {
  palace: import('./palace').PalaceEditorMeta
  editor_fingerprint: string
  snapshot: {
    schemaVersion: 1
    editorPreferences: Record<string, unknown>
    localPreferences: Record<string, unknown>
    language: string
    revision: string
  }
  unit_reconcile?: PalaceUnitReconcileResult | null
}

/** Diff returned when editor save reconciles permanent-mark review units. */
export interface PalaceUnitReconcileResult {
  palace_id?: number
  mark_required?: boolean
  unit_count?: number
  changed?: boolean
  invalidated_session_count?: number
  title?: string
  changes?: Array<Record<string, unknown>>
  undo_token?: string | null
  schedule_batch_id?: string | null
}

export interface MindMapNodeData {
  text?: string
  note?: string
  uid?: string
  memoryAnkiId?: number | null
  memoryAnkiNodeType?: string | null
  memoryAnkiRootKind?: string | null
  [key: string]: unknown
}
export interface MindMapDocNode {
  data?: MindMapNodeData
  children?: MindMapDocNode[]
  [key: string]: unknown
}
export interface MindMapDoc {
  root?: MindMapDocNode
  [key: string]: unknown
}
export interface MindMapHostSegmentSummary {
  id: number
  name: string
  color: string
  created_at: string | null
  node_uids: string[]
}
export interface MindMapHostSegmentRangeDraft {
  active: boolean
  targetSegmentId: number | "new" | null
  selectedNodeUids: string[]
  overriddenConflictNodeUids: string[]
}
export type MindMapTask = 'build' | 'learn'
