import type { MindMapFeedbackEvent } from '@/shared/feedback/feedbackEvents'
import { buildGlassBell, buildLayeredPops } from './layeredPops'

/**
 * 单个合成音的参数。
 */
export interface ToneSpec {
  frequency: number
  durationMs: number
  gain: number
  type: OscillatorType
  offsetMs: number
  endFrequency?: number
  pan?: number
  attackMs?: number
  /** Fixed audition timbre: immediate exponential decay, independent of visual theme. */
  envelope?: 'glass'
}

/**
 * 声音语义配置表：每个反馈事件对应一组合成音（ToneSpec[]）。
 *
 * 这是"听声辨事"的唯一数据源。与视觉映射表 MIND_MAP_FEEDBACK_PROFILES 对称。
 * 新增事件时，TS 会在此 Record 上强制提醒补配，杜绝静默 fallback。
 *
 * 语义维度（通过音色特征区分行为/性质）：
 * - 积极上行（创造/确认/成功）：琶音上行、明亮高频、sine/triangle
 *   → node_create / field_commit / save_success / toggle_on / card_reveal / branch_clear / session_complete
 * - 消极下行（删除/失败/危险）：下行滑音、sawtooth + 低频、沉闷
 *   → node_delete / save_error
 * - 轻点选择（微操作）：单短 sine、低 gain、pan 居中
 *   → pointer_down / node_select / hover_pulse / key_press
 * - 结构变化（移动/拖拽）：双音滑音、中频、pan 扩散
 *   → node_move / drag_start / drag_drop
 * - 导航切换（场景转换）：双音大跨度、带 screenPulse
 *   → navigation / mode_switch
 * - 里程碑/整体成就（连击/通关/全清）：多音和弦琶音 + 高频泛音、长 duration、pan 大幅扩散
 *   → import_apply / branch_clear / all_clear_ready / session_complete
 *
 * 局部 vs 整体的进一步区分由 tuneToneSpec 的 origin 维度二次调制。
 */
/**
 * card_reveal 的惊喜变体——三音闪亮琶音。
 * 不属于 MindMapFeedbackEvent 联合类型，独立存放。
 */
export const CARD_REVEAL_SURPRISE_TONES: ToneSpec[] = [
  { frequency: 520, durationMs: 120, gain: 0.06, type: 'triangle', offsetMs: 0, pan: -0.22 },
  { frequency: 780, durationMs: 150, gain: 0.05, type: 'sine', offsetMs: 65, pan: 0 },
  { frequency: 1046, durationMs: 180, gain: 0.03, type: 'triangle', offsetMs: 150, pan: 0.22 },
]

const TONE_PROFILES: Record<MindMapFeedbackEvent, ToneSpec[]> = {
  quiz_nav_open_practice: [
    { frequency: 330, endFrequency: 440, durationMs: 84, gain: 0.026, type: 'triangle', offsetMs: 0, pan: -0.16 },
    { frequency: 660, durationMs: 100, gain: 0.024, type: 'sine', offsetMs: 50, pan: 0.16 },
  ],
  quiz_nav_question_prev: [
    { frequency: 280, endFrequency: 350, durationMs: 46, gain: 0.018, type: 'triangle', offsetMs: 0, pan: -0.08 },
    { frequency: 420, durationMs: 42, gain: 0.012, type: 'sine', offsetMs: 28, pan: 0.08 },
  ],
  quiz_nav_question_next: [
    { frequency: 320, endFrequency: 420, durationMs: 48, gain: 0.019, type: 'triangle', offsetMs: 0, pan: -0.08 },
    { frequency: 520, durationMs: 44, gain: 0.013, type: 'sine', offsetMs: 30, pan: 0.08 },
  ],
  quiz_nav_scope_change: [
    { frequency: 294, durationMs: 62, gain: 0.024, type: 'triangle', offsetMs: 0, pan: -0.16 },
    { frequency: 440, durationMs: 74, gain: 0.02, type: 'sine', offsetMs: 42, pan: 0 },
    { frequency: 554, durationMs: 86, gain: 0.016, type: 'triangle', offsetMs: 90, pan: 0.16 },
  ],
  quiz_nav_view_switch: [
    { frequency: 262, endFrequency: 370, durationMs: 92, gain: 0.024, type: 'triangle', offsetMs: 0, pan: -0.14 },
    { frequency: 494, durationMs: 96, gain: 0.018, type: 'sine', offsetMs: 54, pan: 0.14 },
  ],
  quiz_nav_tab_switch: [
    { frequency: 300, endFrequency: 392, durationMs: 88, gain: 0.025, type: 'triangle', offsetMs: 0, pan: -0.16 },
    { frequency: 587, durationMs: 102, gain: 0.02, type: 'sine', offsetMs: 56, pan: 0.16 },
  ],
  quiz_answer_select: [
    { frequency: 460, endFrequency: 520, durationMs: 24, gain: 0.01, type: 'sine', offsetMs: 0, pan: 0.04, attackMs: 3 },
  ],
  quiz_answer_submit: [
    { frequency: 392, durationMs: 58, gain: 0.022, type: 'triangle', offsetMs: 0, pan: -0.06 },
    { frequency: 554, durationMs: 78, gain: 0.017, type: 'sine', offsetMs: 36, pan: 0.06 },
  ],
  quiz_answer_reset: [
    { frequency: 340, endFrequency: 250, durationMs: 76, gain: 0.02, type: 'triangle', offsetMs: 0, pan: 0 },
  ],
  quiz_result_correct: [
    { frequency: 440, durationMs: 46, gain: 0.022, type: 'triangle', offsetMs: 0, pan: -0.08 },
    { frequency: 659, durationMs: 62, gain: 0.02, type: 'sine', offsetMs: 26, pan: 0 },
    { frequency: 880, durationMs: 88, gain: 0.014, type: 'triangle', offsetMs: 70, pan: 0.08 },
  ],
  quiz_result_incorrect: [
    { frequency: 310, endFrequency: 180, durationMs: 88, gain: 0.03, type: 'sawtooth', offsetMs: 0, pan: 0.08 },
    { frequency: 150, durationMs: 104, gain: 0.022, type: 'triangle', offsetMs: 56, pan: -0.08 },
  ],
  quiz_result_reveal: [
    { frequency: 520, durationMs: 84, gain: 0.03, type: 'triangle', offsetMs: 0, pan: -0.1 },
    { frequency: 780, durationMs: 72, gain: 0.018, type: 'sine', offsetMs: 52, pan: 0.1 },
  ],
  quiz_result_ai_feedback_ready: [
    { frequency: 494, durationMs: 68, gain: 0.022, type: 'triangle', offsetMs: 0, pan: -0.16 },
    { frequency: 622, durationMs: 74, gain: 0.02, type: 'sine', offsetMs: 42, pan: 0 },
    { frequency: 831, durationMs: 102, gain: 0.015, type: 'triangle', offsetMs: 96, pan: 0.16 },
  ],
  quiz_manage_create_start: [
    { frequency: 360, endFrequency: 480, durationMs: 58, gain: 0.02, type: 'triangle', offsetMs: 0, pan: -0.1 },
    { frequency: 620, durationMs: 70, gain: 0.014, type: 'sine', offsetMs: 42, pan: 0.1 },
  ],
  quiz_manage_edit_start: [
    { frequency: 320, endFrequency: 410, durationMs: 56, gain: 0.018, type: 'triangle', offsetMs: 0, pan: -0.1 },
    { frequency: 560, durationMs: 68, gain: 0.012, type: 'sine', offsetMs: 34, pan: 0.1 },
  ],
  quiz_manage_save: [
    { frequency: 392, durationMs: 64, gain: 0.024, type: 'triangle', offsetMs: 0, pan: -0.1 },
    { frequency: 523, durationMs: 74, gain: 0.02, type: 'sine', offsetMs: 38, pan: 0 },
    { frequency: 698, durationMs: 94, gain: 0.014, type: 'triangle', offsetMs: 88, pan: 0.1 },
  ],
  quiz_manage_delete: [
    { frequency: 494, durationMs: 104, gain: 0.028, type: 'sine', offsetMs: 0, pan: 0.1, attackMs: 2 },
    { frequency: 1186, durationMs: 62, gain: 0.006, type: 'sine', offsetMs: 0, pan: 0.06, attackMs: 2 },
  ],
  quiz_manage_batch_delete: [
    { frequency: 494, durationMs: 104, gain: 0.028, type: 'sine', offsetMs: 0, pan: -0.16, attackMs: 2 },
    { frequency: 440, durationMs: 104, gain: 0.024, type: 'sine', offsetMs: 62, pan: 0, attackMs: 2 },
    { frequency: 392, durationMs: 112, gain: 0.02, type: 'sine', offsetMs: 124, pan: 0.16, attackMs: 2 },
  ],
  quiz_generate_start: [
    { frequency: 392, durationMs: 56, gain: 0.022, type: 'triangle', offsetMs: 0, pan: -0.12 },
    { frequency: 587, durationMs: 72, gain: 0.02, type: 'sine', offsetMs: 40, pan: 0 },
    { frequency: 784, durationMs: 96, gain: 0.018, type: 'triangle', offsetMs: 92, pan: 0.12 },
  ],
  quiz_generate_attach_source: [
    { frequency: 349, durationMs: 56, gain: 0.02, type: 'triangle', offsetMs: 0, pan: -0.08 },
    { frequency: 466, durationMs: 62, gain: 0.015, type: 'sine', offsetMs: 34, pan: 0.08 },
  ],
  quiz_generate_preview_ready: [
    { frequency: 420, durationMs: 86, gain: 0.026, type: 'triangle', offsetMs: 0, pan: -0.16 },
    { frequency: 630, durationMs: 102, gain: 0.02, type: 'sine', offsetMs: 52, pan: 0 },
    { frequency: 940, durationMs: 118, gain: 0.014, type: 'triangle', offsetMs: 120, pan: 0.16 },
  ],
  quiz_generate_save: [
    { frequency: 294, endFrequency: 392, durationMs: 110, gain: 0.032, type: 'triangle', offsetMs: 0, pan: -0.22 },
    { frequency: 587, durationMs: 128, gain: 0.028, type: 'sine', offsetMs: 76, pan: 0 },
    { frequency: 880, durationMs: 150, gain: 0.022, type: 'triangle', offsetMs: 148, pan: 0.22 },
  ],
  quiz_generate_classify_complete: [
    { frequency: 392, durationMs: 146, gain: 0.044, type: 'triangle', offsetMs: 0, pan: -0.24 },
    { frequency: 587, durationMs: 170, gain: 0.04, type: 'sine', offsetMs: 80, pan: 0 },
    { frequency: 988, durationMs: 214, gain: 0.03, type: 'triangle', offsetMs: 176, pan: 0.24 },
  ],
  quiz_generate_cancel: [
    { frequency: 380, durationMs: 44, gain: 0.018, type: 'triangle', offsetMs: 0, pan: 0.08 },
    { frequency: 250, durationMs: 70, gain: 0.014, type: 'sine', offsetMs: 24, pan: -0.08 },
  ],
  quiz_error_missing_input: [
    { frequency: 360, endFrequency: 250, durationMs: 54, gain: 0.018, type: 'triangle', offsetMs: 0, pan: 0.04 },
  ],
  quiz_error_ai_failed: [
    { frequency: 262, durationMs: 128, gain: 0.03, type: 'sine', offsetMs: 0, pan: 0.14, attackMs: 2 },
    { frequency: 131, durationMs: 148, gain: 0.017, type: 'sine', offsetMs: 34, pan: -0.14, attackMs: 2 },
  ],
  quiz_error_persist_failed: [
    { frequency: 233, durationMs: 140, gain: 0.031, type: 'sine', offsetMs: 0, pan: 0.16, attackMs: 2 },
    { frequency: 116, durationMs: 162, gain: 0.018, type: 'sine', offsetMs: 40, pan: -0.16, attackMs: 2 },
  ],
  quiz_error_stat_failed: [
    { frequency: 330, endFrequency: 220, durationMs: 66, gain: 0.02, type: 'triangle', offsetMs: 0, pan: 0.04 },
  ],
  hover_pulse: [
    { frequency: 420, endFrequency: 520, durationMs: 28, gain: 0.008, type: 'sine', offsetMs: 0, pan: 0.12, attackMs: 3 },
  ],
  pointer_down: [
    { frequency: 160, endFrequency: 205, durationMs: 26, gain: 0.01, type: 'sine', offsetMs: 0, pan: -0.08 },
  ],
  pointer_click: [
    { frequency: 260, endFrequency: 320, durationMs: 28, gain: 0.012, type: 'sine', offsetMs: 0, pan: -0.04 },
    { frequency: 390, durationMs: 24, gain: 0.007, type: 'sine', offsetMs: 22, pan: 0.04 },
  ],
  key_press: [
    { frequency: 560, endFrequency: 500, durationMs: 16, gain: 0.0055, type: 'sine', offsetMs: 0, pan: 0.06, attackMs: 3 },
  ],
  shortcut_trigger: [
    { frequency: 392, durationMs: 54, gain: 0.024, type: 'triangle', offsetMs: 0, pan: -0.14 },
    { frequency: 587, durationMs: 72, gain: 0.024, type: 'sine', offsetMs: 44, pan: 0 },
    { frequency: 784, durationMs: 94, gain: 0.02, type: 'triangle', offsetMs: 94, pan: 0.14 },
  ],
  navigation: [
    { frequency: 330, endFrequency: 440, durationMs: 86, gain: 0.026, type: 'triangle', offsetMs: 0, pan: -0.18 },
    { frequency: 660, durationMs: 96, gain: 0.024, type: 'sine', offsetMs: 52, pan: 0.18 },
  ],
  field_focus: [
    { frequency: 280, endFrequency: 360, durationMs: 52, gain: 0.016, type: 'sine', offsetMs: 0, pan: -0.08 },
    { frequency: 460, durationMs: 66, gain: 0.012, type: 'triangle', offsetMs: 28, pan: 0.08 },
  ],
  field_commit: [
    { frequency: 392, durationMs: 62, gain: 0.024, type: 'triangle', offsetMs: 0, pan: -0.08 },
    { frequency: 523, durationMs: 72, gain: 0.022, type: 'sine', offsetMs: 40, pan: 0.08 },
    { frequency: 698, durationMs: 92, gain: 0.016, type: 'triangle', offsetMs: 92, pan: 0 },
  ],
  toggle_on: [
    { frequency: 370, durationMs: 48, gain: 0.024, type: 'triangle', offsetMs: 0, pan: -0.12 },
    { frequency: 555, durationMs: 72, gain: 0.022, type: 'sine', offsetMs: 34, pan: 0.12 },
  ],
  toggle_off: [
    { frequency: 420, durationMs: 44, gain: 0.022, type: 'triangle', offsetMs: 0, pan: 0.12 },
    { frequency: 280, durationMs: 76, gain: 0.018, type: 'sine', offsetMs: 28, pan: -0.12 },
  ],
  text_commit: [
    { frequency: 494, durationMs: 116, gain: 0.026, type: 'sine', offsetMs: 0, pan: -0.06, attackMs: 2 },
    { frequency: 1186, durationMs: 74, gain: 0.006, type: 'sine', offsetMs: 0, pan: -0.04, attackMs: 2 },
  ],
  node_select: [
    { frequency: 660, durationMs: 92, gain: 0.018, type: 'sine', offsetMs: 0, pan: -0.05, attackMs: 2 },
  ],
  node_edit_start: [
    { frequency: 740, durationMs: 104, gain: 0.022, type: 'sine', offsetMs: 0, pan: -0.1, attackMs: 2 },
    { frequency: 1776, durationMs: 66, gain: 0.005, type: 'sine', offsetMs: 0, pan: -0.06, attackMs: 2 },
  ],
  node_create: [
    { frequency: 880, durationMs: 120, gain: 0.026, type: 'sine', offsetMs: 0, pan: -0.1, attackMs: 2 },
    { frequency: 2112, durationMs: 78, gain: 0.006, type: 'sine', offsetMs: 0, pan: -0.06, attackMs: 2 },
  ],
  node_delete: [
    { frequency: 587, durationMs: 120, gain: 0.03, type: 'sine', offsetMs: 0, pan: 0.14, attackMs: 2 },
    { frequency: 1409, durationMs: 76, gain: 0.007, type: 'sine', offsetMs: 0, pan: 0.08, attackMs: 2 },
  ],
  node_move: [
    { frequency: 659, durationMs: 112, gain: 0.024, type: 'sine', offsetMs: 0, pan: -0.2, attackMs: 2 },
    { frequency: 1582, durationMs: 72, gain: 0.006, type: 'sine', offsetMs: 0, pan: 0.2, attackMs: 2 },
  ],
  drag_start: [
    { frequency: 523, durationMs: 108, gain: 0.02, type: 'sine', offsetMs: 0, pan: -0.24, attackMs: 2 },
  ],
  drag_drop: [
    { frequency: 523, durationMs: 116, gain: 0.022, type: 'sine', offsetMs: 0, pan: 0.1, attackMs: 2 },
  ],
  context_menu: [
    { frequency: 196, durationMs: 82, gain: 0.026, type: 'triangle', offsetMs: 0, pan: -0.2 },
    { frequency: 247, durationMs: 58, gain: 0.018, type: 'sine', offsetMs: 52, pan: 0.2 },
  ],
  toolbar_action: [
    { frequency: 880, durationMs: 108, gain: 0.024, type: 'sine', offsetMs: 0, pan: -0.06, attackMs: 2 },
    { frequency: 2112, durationMs: 72, gain: 0.006, type: 'sine', offsetMs: 0, pan: -0.04, attackMs: 2 },
  ],
  mode_switch: [
    { frequency: 262, endFrequency: 392, durationMs: 126, gain: 0.028, type: 'triangle', offsetMs: 0, pan: -0.22 },
    { frequency: 523, endFrequency: 784, durationMs: 142, gain: 0.022, type: 'sine', offsetMs: 82, pan: 0.22 },
  ],
  save_success: [
    { frequency: 390, durationMs: 46, gain: 0.017, type: 'triangle', offsetMs: 0, pan: -0.08 },
    { frequency: 520, durationMs: 56, gain: 0.013, type: 'sine', offsetMs: 34, pan: 0.08 },
  ],
  save_error: [
    { frequency: 233, durationMs: 140, gain: 0.031, type: 'sine', offsetMs: 0, pan: 0.16, attackMs: 2 },
    { frequency: 116, durationMs: 162, gain: 0.018, type: 'sine', offsetMs: 40, pan: -0.16, attackMs: 2 },
  ],
  import_apply: [
    { frequency: 294, endFrequency: 392, durationMs: 110, gain: 0.032, type: 'triangle', offsetMs: 0, pan: -0.24 },
    { frequency: 587, durationMs: 128, gain: 0.028, type: 'sine', offsetMs: 76, pan: 0 },
    { frequency: 880, durationMs: 150, gain: 0.022, type: 'triangle', offsetMs: 148, pan: 0.24 },
  ],
  segment_action: [
    { frequency: 349, durationMs: 58, gain: 0.028, type: 'triangle', offsetMs: 0, pan: -0.08 },
    { frequency: 466, durationMs: 58, gain: 0.026, type: 'triangle', offsetMs: 62, pan: 0.08 },
    { frequency: 622, durationMs: 82, gain: 0.022, type: 'sine', offsetMs: 124, pan: 0 },
  ],
  category_expand: [
    { frequency: 494, endFrequency: 659, durationMs: 92, gain: 0.04, type: 'triangle', offsetMs: 0, pan: -0.14 },
    { frequency: 740, durationMs: 104, gain: 0.028, type: 'sine', offsetMs: 66, pan: 0.16 },
  ],
  next_level_expand: [
    { frequency: 494, endFrequency: 659, durationMs: 92, gain: 0.04, type: 'triangle', offsetMs: 0, pan: -0.14 },
    { frequency: 740, durationMs: 104, gain: 0.028, type: 'sine', offsetMs: 66, pan: 0.16 },
  ],
  card_reveal: [
    // Fallback only: the reveal cascade sounds each card individually
    // (`audio.pops`), and the review/edit relays are muted for this event. This
    // single short bell is what plays if a legacy path ever fires it directly.
    { frequency: 1046, durationMs: 112, gain: 0.03, type: 'sine', offsetMs: 0, pan: 0, attackMs: 2 },
    { frequency: 2510, durationMs: 74, gain: 0.0066, type: 'sine', offsetMs: 0, pan: 0, attackMs: 2 },
  ],
  branch_clear: [
    { frequency: 392, durationMs: 132, gain: 0.044, type: 'triangle', offsetMs: 0, pan: -0.24 },
    { frequency: 587, durationMs: 160, gain: 0.04, type: 'sine', offsetMs: 72, pan: 0 },
    { frequency: 880, durationMs: 190, gain: 0.028, type: 'triangle', offsetMs: 158, pan: 0.24 },
  ],
  all_clear_ready: [
    { frequency: 392, durationMs: 156, gain: 0.046, type: 'triangle', offsetMs: 0, pan: -0.28 },
    { frequency: 587, durationMs: 188, gain: 0.042, type: 'sine', offsetMs: 86, pan: 0 },
    { frequency: 988, durationMs: 230, gain: 0.034, type: 'triangle', offsetMs: 188, pan: 0.28 },
  ],
  session_complete: [
    { frequency: 262, durationMs: 190, gain: 0.04, type: 'triangle', offsetMs: 0, pan: -0.3 },
    { frequency: 392, durationMs: 210, gain: 0.044, type: 'sine', offsetMs: 120, pan: -0.1 },
    { frequency: 523, durationMs: 250, gain: 0.046, type: 'triangle', offsetMs: 250, pan: 0.1 },
    { frequency: 784, durationMs: 330, gain: 0.04, type: 'sine', offsetMs: 430, pan: 0.3 },
  ],
  session_reset: [
    { frequency: 330, endFrequency: 220, durationMs: 90, gain: 0.026, type: 'triangle', offsetMs: 0, pan: 0 },
  ],
  /**
   * 评分四档各一记短铃。以前四档借用编辑事件（node_select / text_commit /
   * field_commit / segment_action），耳朵学不到"评分音阶"；现在每档一个固定音高：
   * 忘记最低（G4）→ 简单最高（F5），一记就听完，衰减 120~150ms。
   * 忘记刻意不用下行滑音或 thud：间隔重复里诚实点"忘记"是正确的动作，不是失误。
   */
  grade_forget: [
    { frequency: 392, durationMs: 120, gain: 0.03, type: 'sine', offsetMs: 0, pan: -0.08, attackMs: 2 },
    { frequency: 941, durationMs: 78, gain: 0.007, type: 'sine', offsetMs: 0, pan: -0.05, attackMs: 2 },
  ],
  grade_hard: [
    { frequency: 494, durationMs: 128, gain: 0.03, type: 'sine', offsetMs: 0, pan: -0.04, attackMs: 2 },
    { frequency: 1186, durationMs: 84, gain: 0.007, type: 'sine', offsetMs: 0, pan: -0.02, attackMs: 2 },
  ],
  grade_good: [
    { frequency: 587, durationMs: 138, gain: 0.03, type: 'sine', offsetMs: 0, pan: 0.04, attackMs: 2 },
    { frequency: 1409, durationMs: 90, gain: 0.007, type: 'sine', offsetMs: 0, pan: 0.02, attackMs: 2 },
  ],
  grade_easy: [
    { frequency: 698, durationMs: 150, gain: 0.031, type: 'sine', offsetMs: 0, pan: 0.08, attackMs: 2 },
    { frequency: 1675, durationMs: 98, gain: 0.008, type: 'sine', offsetMs: 0, pan: 0.05, attackMs: 2 },
  ],
}

// The chosen A audition is fixed across themes. Small actions use its quiet pickup;
// object and result events use the same bell rather than the old synthetic slides.
const glassAction = () => buildGlassBell(1318.5 * 0.67, 0.24, 0, 0.27)
const glassResult = () => [
  ...buildGlassBell(1318.5, 0.65, 0, 1.7),
  ...buildGlassBell(1760, 0.53, 120, 1.9),
]
const GLASS_PROFILES: Partial<Record<MindMapFeedbackEvent, ToneSpec[]>> = {}
const actionEvents: MindMapFeedbackEvent[] = [
  'quiz_nav_open_practice', 'quiz_nav_question_prev', 'quiz_nav_question_next',
  'quiz_nav_scope_change', 'quiz_nav_view_switch', 'quiz_nav_tab_switch',
  'quiz_answer_select', 'quiz_answer_submit', 'quiz_answer_reset',
  'quiz_manage_create_start', 'quiz_manage_edit_start', 'quiz_generate_start',
  'quiz_generate_attach_source', 'quiz_generate_cancel', 'shortcut_trigger',
  'navigation', 'field_focus', 'field_commit', 'toggle_on', 'toggle_off',
  'text_commit', 'node_select', 'node_edit_start', 'node_move', 'drag_start',
  'context_menu', 'toolbar_action', 'mode_switch', 'segment_action',
]
for (const event of actionEvents) GLASS_PROFILES[event] = glassAction()
const resultEvents: MindMapFeedbackEvent[] = [
  'quiz_result_correct', 'quiz_result_ai_feedback_ready', 'quiz_manage_save',
  'quiz_generate_preview_ready', 'quiz_generate_save', 'quiz_generate_classify_complete',
  'save_success', 'import_apply', 'branch_clear', 'all_clear_ready', 'session_complete',
]
for (const event of resultEvents) GLASS_PROFILES[event] = glassResult()
const denyEvents: MindMapFeedbackEvent[] = [
  'quiz_result_incorrect', 'quiz_error_missing_input', 'quiz_error_ai_failed',
  'quiz_error_persist_failed', 'quiz_error_stat_failed', 'save_error', 'session_reset',
]
for (const event of denyEvents) GLASS_PROFILES[event] = buildLayeredPops({ role: 'deny' })
GLASS_PROFILES.card_reveal = buildLayeredPops({ role: 'reveal' })
GLASS_PROFILES.quiz_result_reveal = buildLayeredPops({ role: 'reveal' })
GLASS_PROFILES.node_create = buildLayeredPops({ role: 'deal' })
GLASS_PROFILES.node_delete = buildLayeredPops({ role: 'remove' })
GLASS_PROFILES.quiz_manage_delete = buildLayeredPops({ role: 'remove' })
GLASS_PROFILES.quiz_manage_batch_delete = buildLayeredPops({ role: 'remove' })
GLASS_PROFILES.drag_drop = buildLayeredPops({ role: 'land' })
GLASS_PROFILES.category_expand = buildLayeredPops({ role: 'deal' })
GLASS_PROFILES.next_level_expand = buildLayeredPops({ role: 'deal' })
GLASS_PROFILES.grade_forget = buildLayeredPops({ role: 'grade', grade: 1 })
GLASS_PROFILES.grade_hard = buildLayeredPops({ role: 'grade', grade: 2 })
GLASS_PROFILES.grade_good = buildLayeredPops({ role: 'grade', grade: 3 })
GLASS_PROFILES.grade_easy = buildLayeredPops({ role: 'grade', grade: 4 })

/**
 * 连击里程碑达成时的升调叠加音。
 * 音阶 C(523) → E(659) → G(784) → 高 C(1047)，连击越高音越高，强化"越打越爽"。
 * milestoneStep 从 0 开始，对应 [3,5,8,13] 四档。
 */
const COMBO_MILESTONE_PITCHES = [523, 659, 784, 1047]

export function getComboMilestoneTone(milestoneStep: number): ToneSpec[] {
  const freq = COMBO_MILESTONE_PITCHES[Math.min(milestoneStep, COMBO_MILESTONE_PITCHES.length - 1)] ?? 523
  return [
    ...buildGlassBell(1318.5 * (freq / 523), 0.65, 0, 1.7),
    ...buildGlassBell(1760 * (freq / 523), 0.53, 120, 1.9),
  ]
}

/**
 * 获取事件对应的合成音配置。
 * card_reveal 在 surprise=true 时使用更闪亮的三音变体。
 */
export function getToneSpec(event: MindMapFeedbackEvent, surprise = false): ToneSpec[] {
  if (event === 'card_reveal' && surprise) {
    return buildGlassBell(1760)
  }
  return GLASS_PROFILES[event] ?? TONE_PROFILES[event]
}

/**
 * 礼花庆祝音数据，供 playWebAudioFireworkAccent 使用。
 */
export function getFireworkAccentTones(
  kind: 'milestone' | 'branch_clear' | 'all_clear_ready' | 'session_complete',
  milestoneStep: number,
): ToneSpec[] {
  if (kind === 'milestone') {
    const stepBoost = Math.max(0, Math.min(milestoneStep, 4))
    const base = 760 + stepBoost * 46
    return [
      { frequency: base, endFrequency: base * 1.18, durationMs: 90, gain: 0.016 + stepBoost * 0.002, type: 'triangle' as const, offsetMs: 0, pan: -0.18 },
      { frequency: base * 1.36, durationMs: 114, gain: 0.012 + stepBoost * 0.0015, type: 'sine' as const, offsetMs: 40, pan: 0.18 },
      { frequency: base * 1.8, durationMs: 148, gain: 0.008 + stepBoost * 0.001, type: 'triangle' as const, offsetMs: 88, pan: 0 },
    ]
  }

  if (kind === 'branch_clear') {
    return [
      { frequency: 620, endFrequency: 780, durationMs: 120, gain: 0.022, type: 'triangle' as const, offsetMs: 0, pan: -0.26 },
      { frequency: 930, durationMs: 144, gain: 0.017, type: 'sine' as const, offsetMs: 52, pan: 0.26 },
      { frequency: 1240, durationMs: 180, gain: 0.012, type: 'triangle' as const, offsetMs: 120, pan: 0 },
    ]
  }

  if (kind === 'all_clear_ready') {
    return [
      { frequency: 560, endFrequency: 760, durationMs: 130, gain: 0.024, type: 'triangle' as const, offsetMs: 0, pan: -0.28 },
      { frequency: 840, durationMs: 156, gain: 0.02, type: 'sine' as const, offsetMs: 48, pan: 0 },
      { frequency: 1120, durationMs: 210, gain: 0.014, type: 'triangle' as const, offsetMs: 118, pan: 0.28 },
      { frequency: 1480, durationMs: 240, gain: 0.01, type: 'sine' as const, offsetMs: 182, pan: 0 },
    ]
  }

  return [
    { frequency: 520, endFrequency: 720, durationMs: 148, gain: 0.026, type: 'triangle' as const, offsetMs: 0, pan: -0.3 },
    { frequency: 784, durationMs: 182, gain: 0.022, type: 'sine' as const, offsetMs: 54, pan: -0.08 },
    { frequency: 1046, durationMs: 236, gain: 0.018, type: 'triangle' as const, offsetMs: 122, pan: 0.12 },
    { frequency: 1396, durationMs: 280, gain: 0.012, type: 'sine' as const, offsetMs: 206, pan: 0.3 },
  ]
}

const LANDING_BASE_HZ = 660
const LANDING_MAX_STEPS = 12

/** Particles landing on the progress rail: a light two-note chime, a semitone higher per combo step. */
export function getLandingChimeTone(combo: number): ToneSpec[] {
  const steps = Math.max(0, Math.min(LANDING_MAX_STEPS, Math.round(combo)))
  const base = LANDING_BASE_HZ * 2 ** (steps / 12)
  return buildGlassBell(1318.5 * (base / LANDING_BASE_HZ), 0.45, 0, 0.8)
}
