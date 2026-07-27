/**
 * Which study surface a timer belongs to.
 *
 * This is a registration identity — `GlobalTimerRegistration.scene` and the
 * label shown in the floating overlay — not a configuration axis. Focus rules
 * are global; scenes never carried their own timings.
 */
export type TimerFocusScene =
  | 'palace_edit'
  | 'practice'
  | 'quiz'
  | 'review'
  | 'freestyle'
  | 'english'
  | 'english_reading'

export const TIMER_FOCUS_SCENE_LABELS: Record<TimerFocusScene, string> = {
  palace_edit: '编辑',
  practice: '练习',
  quiz: '做题',
  review: '复习',
  freestyle: '随心模式',
  english: '英语听力',
  english_reading: '英语阅读',
}
