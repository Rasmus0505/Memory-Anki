import type { MindMapFeedbackEvent } from '@/shared/components/mindmap-host/hostBridgeUtils'

export interface MindMapFeedbackAudioEvent {
  type: MindMapFeedbackEvent
  source: string | null
  nodeUid: string | null
}

const FEEDBACK_AUDIO_COALESCE_MS = 110
const FEEDBACK_AUDIO_KEY_COALESCE_MS = 48
const FEEDBACK_AUDIO_IMMEDIATE_PRIORITY = 64

const FEEDBACK_AUDIO_PRIORITY: Partial<Record<MindMapFeedbackEvent, number>> = {
  quiz_generate_classify_complete: 98,
  quiz_generate_save: 94,
  quiz_manage_batch_delete: 90,
  quiz_error_persist_failed: 88,
  quiz_error_ai_failed: 86,
  quiz_result_reveal: 80,
  quiz_generate_preview_ready: 79,
  quiz_result_correct: 77,
  quiz_result_incorrect: 77,
  quiz_result_ai_feedback_ready: 75,
  quiz_answer_submit: 74,
  quiz_manage_save: 72,
  quiz_generate_start: 70,
  quiz_manage_delete: 68,
  quiz_manage_create_start: 66,
  quiz_manage_edit_start: 66,
  quiz_generate_attach_source: 64,
  quiz_nav_open_practice: 62,
  quiz_nav_tab_switch: 60,
  quiz_nav_view_switch: 60,
  quiz_nav_scope_change: 58,
  quiz_generate_cancel: 56,
  quiz_error_missing_input: 56,
  quiz_error_stat_failed: 56,
  quiz_nav_question_prev: 44,
  quiz_nav_question_next: 44,
  quiz_answer_reset: 42,
  quiz_answer_select: 20,
  session_complete: 100,
  all_clear_ready: 96,
  branch_clear: 92,
  save_error: 88,
  node_delete: 84,
  import_apply: 82,
  card_reveal: 78,
  save_success: 76,
  text_commit: 74,
  node_edit_start: 72,
  node_create: 68,
  drag_drop: 66,
  segment_action: 64,
  mode_switch: 62,
  field_commit: 60,
  toggle_on: 58,
  toggle_off: 58,
  navigation: 56,
  toolbar_action: 50,
  shortcut_trigger: 48,
  context_menu: 46,
  drag_start: 42,
  node_move: 36,
  node_select: 30,
  pointer_click: 24,
  key_press: 18,
  field_focus: 16,
  pointer_down: 12,
  hover_pulse: 4,
}

const LOW_PRIORITY_FEEDBACK_EVENTS = new Set<MindMapFeedbackEvent>([
  'pointer_down',
  'pointer_click',
  'node_select',
  'key_press',
  'field_focus',
  'hover_pulse',
  'quiz_answer_select',
])

function isMindMapFeedbackEvent(value: unknown): value is MindMapFeedbackEvent {
  return (
    value === 'category_expand' ||
    value === 'quiz_nav_open_practice' ||
    value === 'quiz_nav_question_prev' ||
    value === 'quiz_nav_question_next' ||
    value === 'quiz_nav_scope_change' ||
    value === 'quiz_nav_view_switch' ||
    value === 'quiz_nav_tab_switch' ||
    value === 'quiz_answer_select' ||
    value === 'quiz_answer_submit' ||
    value === 'quiz_answer_reset' ||
    value === 'quiz_result_correct' ||
    value === 'quiz_result_incorrect' ||
    value === 'quiz_result_reveal' ||
    value === 'quiz_result_ai_feedback_ready' ||
    value === 'quiz_manage_create_start' ||
    value === 'quiz_manage_edit_start' ||
    value === 'quiz_manage_save' ||
    value === 'quiz_manage_delete' ||
    value === 'quiz_manage_batch_delete' ||
    value === 'quiz_generate_start' ||
    value === 'quiz_generate_attach_source' ||
    value === 'quiz_generate_preview_ready' ||
    value === 'quiz_generate_save' ||
    value === 'quiz_generate_classify_complete' ||
    value === 'quiz_generate_cancel' ||
    value === 'quiz_error_missing_input' ||
    value === 'quiz_error_ai_failed' ||
    value === 'quiz_error_persist_failed' ||
    value === 'quiz_error_stat_failed' ||
    value === 'next_level_expand' ||
    value === 'card_reveal' ||
    value === 'branch_clear' ||
    value === 'all_clear_ready' ||
    value === 'session_complete' ||
    value === 'session_reset' ||
    value === 'hover_pulse' ||
    value === 'pointer_down' ||
    value === 'pointer_click' ||
    value === 'shortcut_trigger' ||
    value === 'navigation' ||
    value === 'field_focus' ||
    value === 'field_commit' ||
    value === 'toggle_on' ||
    value === 'toggle_off' ||
    value === 'key_press' ||
    value === 'text_commit' ||
    value === 'node_select' ||
    value === 'node_edit_start' ||
    value === 'node_create' ||
    value === 'node_delete' ||
    value === 'node_move' ||
    value === 'drag_start' ||
    value === 'drag_drop' ||
    value === 'context_menu' ||
    value === 'toolbar_action' ||
    value === 'mode_switch' ||
    value === 'save_success' ||
    value === 'save_error' ||
    value === 'import_apply' ||
    value === 'segment_action'
  )
}

export function readMindMapFeedbackAudioEvent(payload: unknown): MindMapFeedbackAudioEvent | null {
  if (isMindMapFeedbackEvent(payload)) {
    return {
      type: payload,
      source: null,
      nodeUid: null,
    }
  }
  if (payload && typeof payload === 'object') {
    const raw = payload as { type?: unknown; source?: unknown; nodeUid?: unknown }
    if (isMindMapFeedbackEvent(raw.type)) {
      return {
        type: raw.type,
        source: typeof raw.source === 'string' && raw.source ? raw.source : null,
        nodeUid: typeof raw.nodeUid === 'string' && raw.nodeUid ? raw.nodeUid : null,
      }
    }
  }
  return null
}

export function getFeedbackAudioPriority(event: MindMapFeedbackEvent) {
  return FEEDBACK_AUDIO_PRIORITY[event] ?? 40
}

export function getFeedbackAudioCoalesceMs(event: MindMapFeedbackEvent) {
  if (event === 'key_press') return FEEDBACK_AUDIO_KEY_COALESCE_MS
  if (LOW_PRIORITY_FEEDBACK_EVENTS.has(event)) return FEEDBACK_AUDIO_COALESCE_MS
  return 72
}

export function isImmediateFeedbackAudioEvent(event: MindMapFeedbackEvent) {
  return getFeedbackAudioPriority(event) >= FEEDBACK_AUDIO_IMMEDIATE_PRIORITY
}

export function areRelatedFeedbackAudioEvents(
  previous: MindMapFeedbackAudioEvent,
  next: MindMapFeedbackAudioEvent,
) {
  if (previous.nodeUid && next.nodeUid) return previous.nodeUid === next.nodeUid
  if (previous.source && next.source && previous.source === next.source) return true
  if (LOW_PRIORITY_FEEDBACK_EVENTS.has(previous.type) && LOW_PRIORITY_FEEDBACK_EVENTS.has(next.type)) {
    return true
  }
  return (
    getFeedbackAudioPriority(previous.type) >= FEEDBACK_AUDIO_IMMEDIATE_PRIORITY &&
    LOW_PRIORITY_FEEDBACK_EVENTS.has(next.type)
  )
}
