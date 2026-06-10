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
  sync_reason?: string | null
  allow_stale_overwrite?: boolean
  confirm_dangerous_change?: boolean
  expected_editor_fingerprint?: string | null
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
