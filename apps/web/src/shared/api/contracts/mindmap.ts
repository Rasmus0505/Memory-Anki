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
export type MindMapTask = 'build' | 'learn'
export type MindMapRecallRating = 1 | 3 | 5
export type MindMapRecallRound = 'first' | 'weak_retry'
export type MindMapMasteryStatus = 'unknown' | 'stable' | 'reinforce' | 'weak'
export type MindMapNodeManualLabel = 'weak' | 'mastered' | null

export interface MindMapRecallEvent {
  id: string
  study_session_id: string
  palace_id: number
  node_uid: string
  source_scene: string
  recall_round: MindMapRecallRound
  rating: MindMapRecallRating
  occurred_at: string
  supersedes_event_id: string | null
}

export interface MindMapRecallEventCreate extends Omit<MindMapRecallEvent, 'occurred_at'> {
  occurred_at?: string | null
}

export interface MindMapNodeMastery {
  palace_id: number
  node_uid: string
  status: MindMapMasteryStatus
  computed_status: MindMapMasteryStatus
  manual_label: MindMapNodeManualLabel
  reason: string
  priority: number
  orphaned: boolean
  hidden_by_mastered: boolean
  recent_events: MindMapRecallEvent[]
}

