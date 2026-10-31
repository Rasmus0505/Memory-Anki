import {
  showMicroBubble,
  type MicroBubblePart,
  type MicroBubblePlacement,
  type MicroBubbleTone,
} from '@/shared/fx'

export interface AnswerDurationBubbleOptions {
  /** Known at the click for every self-scored question type. */
  correct?: boolean
  /** The question's prior consecutive-correct count, before this attempt. */
  consecutiveCorrect?: number
  /** The question's previous attempt duration, for the "比上次快" tail. */
  previousDurationMs?: number | null
  placement?: MicroBubblePlacement
}

export interface AnswerBubbleCopy {
  tone: MicroBubbleTone
  icon?: string
  parts: MicroBubblePart[]
}

function secondsLabel(durationMs: number) {
  return `${(Math.max(0, Math.round(durationMs)) / 1000).toFixed(1)}s`
}

/**
 * Copy for the transient pill that confirms one answer attempt. Pure so the
 * thresholds can be tested without a DOM.
 */
export function answerBubbleCopy(
  durationMs: number,
  options: AnswerDurationBubbleOptions = {},
): AnswerBubbleCopy {
  const time = secondsLabel(durationMs)
  const seconds = Math.max(0, durationMs) / 1000
  const { correct, consecutiveCorrect = 0, previousDurationMs } = options

  if (correct === undefined) {
    return { tone: 'neutral', parts: [{ text: time, strong: true }] }
  }

  if (!correct) {
    return {
      tone: 'error',
      icon: '✕',
      parts: [
        { text: time, strong: true },
        { text: ' · 错选干扰项', muted: true },
      ],
    }
  }

  if (seconds < 3.5) {
    if (consecutiveCorrect >= 2) {
      return {
        tone: 'fast',
        icon: '⚡',
        parts: [
          { text: time, strong: true },
          { text: ' · 肌肉记忆预警', muted: true },
        ],
      }
    }
    return {
      tone: 'good',
      icon: '⚡',
      parts: [
        { text: time, strong: true },
        { text: ' · 秒选', muted: true },
      ],
    }
  }

  if (seconds <= 10) {
    const parts: MicroBubblePart[] = [
      { text: time, strong: true },
      { text: ' · 提取稳健', muted: true },
    ]
    if (previousDurationMs != null) {
      const delta = (previousDurationMs - durationMs) / 1000
      if (Math.abs(delta) >= 0.3) {
        parts.push({
          text: ` · ${delta > 0 ? '快' : '慢'} ${Math.abs(delta).toFixed(1)}s`,
          muted: true,
        })
      }
    }
    return { tone: 'good', icon: '✓', parts }
  }

  return {
    tone: 'warn',
    icon: '⏳',
    parts: [
      { text: time, strong: true },
      { text: ' · 检索吃力', muted: true },
    ],
  }
}

/**
 * Show the answer-time pill next to the option (or submit button) the learner
 * tapped. The pill lives on the fx top layer, so it stays visible above quiz
 * dialogs instead of being painted under the question card.
 */
export function showAnswerDurationBubble(
  anchor: Element | null,
  durationMs: number | null,
  options: AnswerDurationBubbleOptions = {},
) {
  if (durationMs == null) return

  const copy = answerBubbleCopy(durationMs, options)
  showMicroBubble(anchor, {
    ...copy,
    zone: 'quiz-answer',
    placement: options.placement ?? (options.correct === undefined ? 'above' : 'left-top'),
    offset: 6,
    duration: 1050,
  })
}
