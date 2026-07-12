export type MindMapReviewFxType =
  | 'category_expand'
  | 'next_level_expand'
  | 'card_reveal'
  | 'branch_clear'
  | 'all_clear_ready'
  | 'session_complete'
  | 'session_reset'

export type FeedbackEvent =
  | MindMapReviewFxType
  | 'quiz_nav_open_practice'
  | 'quiz_nav_question_prev'
  | 'quiz_nav_question_next'
  | 'quiz_nav_scope_change'
  | 'quiz_nav_view_switch'
  | 'quiz_nav_tab_switch'
  | 'quiz_answer_select'
  | 'quiz_answer_submit'
  | 'quiz_answer_reset'
  | 'quiz_result_correct'
  | 'quiz_result_incorrect'
  | 'quiz_result_reveal'
  | 'quiz_result_ai_feedback_ready'
  | 'quiz_manage_create_start'
  | 'quiz_manage_edit_start'
  | 'quiz_manage_save'
  | 'quiz_manage_delete'
  | 'quiz_manage_batch_delete'
  | 'quiz_generate_start'
  | 'quiz_generate_attach_source'
  | 'quiz_generate_preview_ready'
  | 'quiz_generate_save'
  | 'quiz_generate_classify_complete'
  | 'quiz_generate_cancel'
  | 'quiz_error_missing_input'
  | 'quiz_error_ai_failed'
  | 'quiz_error_persist_failed'
  | 'quiz_error_stat_failed'
  | 'pointer_down'
  | 'pointer_click'
  | 'hover_pulse'
  | 'key_press'
  | 'shortcut_trigger'
  | 'navigation'
  | 'field_focus'
  | 'field_commit'
  | 'toggle_on'
  | 'toggle_off'
  | 'text_commit'
  | 'node_select'
  | 'node_edit_start'
  | 'node_create'
  | 'node_delete'
  | 'node_move'
  | 'drag_start'
  | 'drag_drop'
  | 'context_menu'
  | 'toolbar_action'
  | 'mode_switch'
  | 'save_success'
  | 'save_error'
  | 'import_apply'
  | 'segment_action'

export type FeedbackLevel = 'micro' | 'action' | 'milestone'
export type FeedbackOrigin = 'keyboard' | 'pointer' | 'node' | 'edge' | 'toolbar' | 'review' | 'system'

export interface MindMapReviewFxPayload {
  type: MindMapReviewFxType
  nodeUid: string | null
  relatedNodeUids: string[]
  intensity: 'full' | 'soft' | 'none'
  milestoneStep?: number | null
  anchor?: { x: number; y: number } | null
  lineMode?: 'spawn' | 'trace' | 'confirm' | 'clear'
  depthHint?: 0 | 1 | 2
  targetRole?: 'parent' | 'placeholder' | 'revealed'
  isBranchCompletion?: boolean
  nonce: number
}

export interface FeedbackFxPayload extends Omit<MindMapReviewFxPayload, 'type'> {
  type: FeedbackEvent
  level?: FeedbackLevel
  origin?: FeedbackOrigin
  x?: number
  y?: number
  source?: string
}

export type MindMapFeedbackEvent = FeedbackEvent
export type MindMapFeedbackLevel = FeedbackLevel
export type MindMapFeedbackOrigin = FeedbackOrigin
export type MindMapFeedbackFxPayload = FeedbackFxPayload
