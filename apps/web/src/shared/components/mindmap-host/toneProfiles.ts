import type { MindMapFeedbackEvent } from '@/shared/components/mindmap-host/hostBridgeUtils'

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
    { frequency: 390, durationMs: 46, gain: 0.017, type: 'triangle', offsetMs: 0, pan: -0.08 },
    { frequency: 520, durationMs: 56, gain: 0.013, type: 'sine', offsetMs: 34, pan: 0.08 },
  ],
  node_select: [
    { frequency: 340, endFrequency: 390, durationMs: 30, gain: 0.011, type: 'sine', offsetMs: 0, pan: -0.05 },
  ],
  node_edit_start: [
    { frequency: 300, endFrequency: 390, durationMs: 54, gain: 0.018, type: 'triangle', offsetMs: 0, pan: -0.14 },
    { frequency: 560, durationMs: 64, gain: 0.011, type: 'sine', offsetMs: 34, pan: 0.14 },
  ],
  node_create: [
    { frequency: 360, endFrequency: 480, durationMs: 62, gain: 0.02, type: 'triangle', offsetMs: 0, pan: -0.12 },
    { frequency: 640, durationMs: 72, gain: 0.014, type: 'sine', offsetMs: 48, pan: 0.12 },
  ],
  node_delete: [
    { frequency: 320, endFrequency: 190, durationMs: 96, gain: 0.032, type: 'sawtooth', offsetMs: 0, pan: 0.18 },
    { frequency: 160, durationMs: 118, gain: 0.026, type: 'triangle', offsetMs: 72, pan: -0.14 },
  ],
  node_move: [
    { frequency: 280, endFrequency: 420, durationMs: 116, gain: 0.026, type: 'triangle', offsetMs: 0, pan: -0.26 },
    { frequency: 420, endFrequency: 520, durationMs: 92, gain: 0.018, type: 'sine', offsetMs: 74, pan: 0.26 },
  ],
  drag_start: [
    { frequency: 220, endFrequency: 360, durationMs: 96, gain: 0.024, type: 'triangle', offsetMs: 0, pan: -0.3 },
  ],
  drag_drop: [
    { frequency: 300, endFrequency: 390, durationMs: 50, gain: 0.018, type: 'triangle', offsetMs: 0, pan: 0.1 },
    { frequency: 500, durationMs: 58, gain: 0.012, type: 'sine', offsetMs: 36, pan: -0.1 },
  ],
  context_menu: [
    { frequency: 196, durationMs: 82, gain: 0.026, type: 'triangle', offsetMs: 0, pan: -0.2 },
    { frequency: 247, durationMs: 58, gain: 0.018, type: 'sine', offsetMs: 52, pan: 0.2 },
  ],
  toolbar_action: [
    { frequency: 370, durationMs: 50, gain: 0.026, type: 'triangle', offsetMs: 0, pan: -0.08 },
    { frequency: 555, durationMs: 62, gain: 0.022, type: 'sine', offsetMs: 38, pan: 0.08 },
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
    { frequency: 320, endFrequency: 190, durationMs: 96, gain: 0.032, type: 'sawtooth', offsetMs: 0, pan: 0.18 },
    { frequency: 160, durationMs: 118, gain: 0.026, type: 'triangle', offsetMs: 72, pan: -0.14 },
  ],
  import_apply: [
    { frequency: 294, endFrequency: 392, durationMs: 110, gain: 0.032, type: 'triangle', offsetMs: 0, pan: -0.24 },
    { frequency: 587, durationMs: 128, gain: 0.028, type: 'sine', offsetMs: 76, pan: 0 },
    { frequency: 880, durationMs: 150, gain: 0.022, type: 'triangle', offsetMs: 148, pan: 0.24 },
  ],
  bilink_action: [
    { frequency: 523, durationMs: 58, gain: 0.026, type: 'triangle', offsetMs: 0, pan: -0.28 },
    { frequency: 523, durationMs: 58, gain: 0.024, type: 'triangle', offsetMs: 72, pan: 0.28 },
    { frequency: 784, durationMs: 98, gain: 0.02, type: 'sine', offsetMs: 136, pan: 0 },
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
    { frequency: 540, durationMs: 104, gain: 0.044, type: 'triangle', offsetMs: 0, pan: -0.12 },
    { frequency: 810, durationMs: 82, gain: 0.024, type: 'sine', offsetMs: 72, pan: 0.12 },
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
}

/**
 * 连击里程碑达成时的升调叠加音。
 * 音阶 C(523) → E(659) → G(784) → 高 C(1047)，连击越高音越高，强化"越打越爽"。
 * milestoneStep 从 0 开始，对应 [3,5,8,13] 四档。
 */
const COMBO_MILESTONE_PITCHES = [523, 659, 784, 1047]

export function getComboMilestoneTone(milestoneStep: number): ToneSpec[] {
  const freq = COMBO_MILESTONE_PITCHES[Math.min(milestoneStep, COMBO_MILESTONE_PITCHES.length - 1)] ?? 523
  return [
    { frequency: freq, endFrequency: freq * 1.5, durationMs: 180, gain: 0.038, type: 'sine', offsetMs: 0, pan: 0 },
    { frequency: freq * 2, durationMs: 140, gain: 0.014, type: 'triangle', offsetMs: 60, pan: 0.18 },
  ]
}

/**
 * 获取事件对应的合成音配置。
 * card_reveal 在 surprise=true 时使用更闪亮的三音变体。
 */
export function getToneSpec(event: MindMapFeedbackEvent, surprise = false): ToneSpec[] {
  if (event === 'card_reveal' && surprise) {
    return CARD_REVEAL_SURPRISE_TONES
  }
  return TONE_PROFILES[event]
}
