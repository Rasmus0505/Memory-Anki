export type MindMapAiSplitMode = 'auto' | 'parallel' | 'hierarchy'

export interface MindMapAiSplitRequestPayload {
  target_node_uid: string | null
  target_node_text: string
  target_node_note: string
  target_node_type: string | null
  is_root: boolean
  split_mode: MindMapAiSplitMode
}
