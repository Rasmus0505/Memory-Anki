import type { EnglishCourseDetail, EnglishCourseSentence } from '@/shared/api/contracts'
import type { DictationSentenceSession } from '@/modules/english/domain/english-dictation/model'
import {
  getShortcutLabel,
  type EnglishPlaybackMode,
  type EnglishPracticeSettings,
} from '@/modules/settings/public'

export const WRONG_SOUND_FLASH_MS = 1_600

export const EMPTY_SESSION: DictationSentenceSession = {
  sentenceIndex: -1,
  words: [],
  activeWordIndex: 0,
  completed: true,
  usedHint: false,
}

export interface SentenceStats {
  errors: number
  hints: number
}

export interface DictationRoundStats {
  firstTry: number
  hinted: number
  errors: number
  durationMs: number
  completedThisRound: number
  tricky: Array<{ index: number; sentence: EnglishCourseSentence; errors: number; hints: number }>
}

export function clearTimer(ref: { current: number | null }) {
  if (ref.current != null) {
    window.clearTimeout(ref.current)
    ref.current = null
  }
}

export function sentenceForIndex(course: EnglishCourseDetail | null, index: number) {
  if (!course) return null
  return course.sentences.find((sentence) => sentence.index === index) ?? course.sentences[index] ?? null
}

export function errorMessage(value: unknown) {
  if (value instanceof Error && value.message.trim()) return value.message
  return '课程没有加载出来，请稍后再试。'
}

export function isEditableTarget(target: EventTarget | null, allowed: HTMLElement | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target === allowed) return false
  const tag = target.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return target.isContentEditable
}

export function buildSummaryStats(
  course: EnglishCourseDetail | null,
  roundCompleted: Set<number>,
  statsByIndex: Record<number, SentenceStats>,
  durationMs: number,
): DictationRoundStats {
  let firstTry = 0
  let hinted = 0
  let errors = 0
  const tricky: DictationRoundStats['tricky'] = []
  if (course) {
    for (const item of course.sentences) {
      if (!roundCompleted.has(item.index)) continue
      const stats = statsByIndex[item.index] || { errors: 0, hints: 0 }
      errors += stats.errors
      if (stats.hints > 0) hinted += 1
      if (stats.errors === 0 && stats.hints === 0) firstTry += 1
      if (stats.errors > 0 || stats.hints > 0) {
        tricky.push({ index: item.index, sentence: item, errors: stats.errors, hints: stats.hints })
      }
    }
  }
  tricky.sort((a, b) => b.errors + b.hints - (a.errors + a.hints))
  return {
    firstTry,
    hinted,
    errors,
    durationMs,
    completedThisRound: roundCompleted.size,
    tricky,
  }
}

export function buildResumeHint(settings: EnglishPracticeSettings) {
  const pauseLabel = settings.shortcuts.pause_session
    ? getShortcutLabel(settings.shortcuts.pause_session)
    : ''
  const replayLabel = settings.shortcuts.replay_sentence
    ? getShortcutLabel(settings.shortcuts.replay_sentence)
    : ''
  if (!pauseLabel && !replayLabel) {
    return '视频与听写都停在这一刻。按继续按钮恢复。'
  }
  return `视频与听写都停在这一刻。按 ${[pauseLabel, replayLabel].filter(Boolean).join(' 或 ')} 继续。`
}

export function buildPlayHint(settings: EnglishPracticeSettings) {
  const replayLabel = settings.shortcuts.replay_sentence
    ? getShortcutLabel(settings.shortcuts.replay_sentence)
    : ''
  return replayLabel ? `${replayLabel} 播放` : '点击播放'
}

export function buildShortcutsLabel(settings: EnglishPracticeSettings) {
  return settings.shortcuts.open_shortcuts
    ? getShortcutLabel(settings.shortcuts.open_shortcuts)
    : 'F1'
}

export type PlaybackBoundary =
  | { kind: 'continue' }
  | { kind: 'advance'; index: number }
  | { kind: 'pause' }

const PLAYBACK_END_EPSILON_MS = 30

/** Decide whether the playhead may stay on the current sentence. */
export function resolvePlaybackBoundary(
  sentences: EnglishCourseSentence[],
  currentIndex: number,
  timeMs: number,
  mode: EnglishPlaybackMode,
): PlaybackBoundary {
  if (sentences.length === 0) return { kind: 'pause' }
  const current = sentences.find((sentence) => sentence.index === currentIndex)
  if (!current) return { kind: 'advance', index: sentences[0].index }

  if (mode === 'single') {
    return timeMs >= current.endMs - PLAYBACK_END_EPSILON_MS
      ? { kind: 'pause' }
      : { kind: 'continue' }
  }

  // Hot path: while the playhead is inside the current sentence, avoid scanning
  // the whole course on every video frame.
  if (
    timeMs >= current.startMs - PLAYBACK_END_EPSILON_MS
    && timeMs < current.endMs - PLAYBACK_END_EPSILON_MS
  ) {
    return { kind: 'continue' }
  }

  const last = sentences[sentences.length - 1]
  if (timeMs >= last.endMs - PLAYBACK_END_EPSILON_MS) return { kind: 'pause' }

  const containing = sentences.find(
    (sentence) =>
      timeMs >= sentence.startMs - PLAYBACK_END_EPSILON_MS
      && timeMs < sentence.endMs - PLAYBACK_END_EPSILON_MS,
  )
  const upcoming = containing
    ?? sentences.find((sentence) => sentence.startMs > timeMs)
    ?? last
  if (upcoming.index !== currentIndex) {
    return { kind: 'advance', index: upcoming.index }
  }
  return { kind: 'continue' }
}

export function buildPlaybackShortcutLabel(settings: EnglishPracticeSettings) {
  return settings.shortcuts.toggle_playback_mode
    ? getShortcutLabel(settings.shortcuts.toggle_playback_mode)
    : '未设置'
}
