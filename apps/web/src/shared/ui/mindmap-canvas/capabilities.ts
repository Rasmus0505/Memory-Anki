export type MindMapAiSplitMode = 'auto' | 'parallel' | 'hierarchy' | 'add_children'

export interface MindMapAiSplitRequestPayload {
  target_node_uid: string | null
  target_node_text: string
  target_node_note: string
  target_node_type: string | null
  is_root: boolean
  /** Entry default; workbench may switch between split (auto/…) and add_children. */
  split_mode: MindMapAiSplitMode
}
