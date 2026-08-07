import { useEffect, useRef, useState } from 'react'
import {
  QuizQuestionInteraction,
  type QuizRuntimeState,
} from '@/modules/quiz/public'
import {
  QUESTION_TYPE_ACCENT,
  QUESTION_TYPE_DISPLAY,
} from '@/modules/practice/ui/freestyle/model/freestyle-labels'
import {
  getFreestyleChoiceIndex,
  isFreestyleShortcutBlocked,
} from '@/modules/practice/ui/freestyle/model/freestyleKeyboard'
import type { FreestyleQuizCard } from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { cn } from '@/shared/lib/utils'

export function FreestyleQuizCardView({
  card,
  state,
  answeredBefore,
  onStateChange,
  onChoiceResolve,
  onShortAnswerSubmit,
  onRequestShortAnswerFeedback,
  onRequestNext,
  active = false,
}: {
  card: FreestyleQuizCard
  state: QuizRuntimeState | undefined
  answeredBefore: boolean
  onStateChange: (updater: (current: QuizRuntimeState) => QuizRuntimeState) => void
  onChoiceResolve: (optionId: string, isCorrect: boolean) => void
  onShortAnswerSubmit: () => void
  onRequestShortAnswerFeedback: () => void
  /** Immersive feed: explicit next after reading analysis. */
  onRequestNext?: () => void
  /** Only the card currently under the feed viewport owns choice shortcuts. */
  active?: boolean
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [keyboardOptionIndex, setKeyboardOptionIndex] = useState(0)
  const palaceTitle = card.palace_context.resolved_title || card.palace_context.title
  const segmentNames = card.segment_contexts?.map((segment) => segment.name).filter(Boolean).join('、')
  const chapterName = card.chapter_context?.name
  const accent = QUESTION_TYPE_ACCENT[card.question.question_type]
  const isCorrect = state?.correct === true
  const isIncorrect = state?.correct === false
  const isResolved = state?.resolved === true

  useEffect(() => {
    setKeyboardOptionIndex(0)
  }, [card.question.id])

  useEffect(() => {
    if (!active || card.question.question_type !== 'multiple_choice') return
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || isFreestyleShortcutBlocked(event.target)) return
      if (state?.resolved) return

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const optionCount = card.question.options.length
        if (optionCount === 0) return
        event.preventDefault()
        const delta = event.key === 'ArrowDown' ? 1 : -1
        const nextIndex = (keyboardOptionIndex + delta + optionCount) % optionCount
        setKeyboardOptionIndex(nextIndex)
        cardRef.current
          ?.querySelector<HTMLButtonElement>(`[data-quiz-option-index="${nextIndex}"]`)
          ?.focus()
        return
      }

      if (event.key === 'Enter') {
        const option = card.question.options[keyboardOptionIndex]
        if (!option) return
        event.preventDefault()
        const correct = option.id === (card.question.answer_payload.correct_option_id || '')
        onStateChange((current) => ({
          ...current,
          selectedOptionId: option.id,
          resolved: true,
          correct,
        }))
        onChoiceResolve(option.id, correct)
        return
      }

      const optionIndex = getFreestyleChoiceIndex(event.key)
      const option = optionIndex == null ? undefined : card.question.options[optionIndex]
      if (!option) return
      event.preventDefault()
      const correct = option.id === (card.question.answer_payload.correct_option_id || '')
      onStateChange((current) => ({
        ...current,
        selectedOptionId: option.id,
        resolved: true,
        correct,
      }))
      onChoiceResolve(option.id, correct)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [
    active,
    card.question,
    keyboardOptionIndex,
    onChoiceResolve,
    onStateChange,
    state?.resolved,
  ])

  return (
    <div ref={cardRef} className="mx-auto flex h-full w-full max-w-4xl flex-col justify-center py-2 sm:py-4">
      <div
        className={cn(
          'rounded-2xl border bg-zinc-900/88 p-4 text-zinc-50 shadow-[0_12px_40px_rgba(0,0,0,0.4)] backdrop-blur-md sm:p-6',
          isResolved && isCorrect
            ? 'border-emerald-500/30 shadow-[0_0_24px_rgba(16,185,129,0.12),0_12px_40px_rgba(0,0,0,0.4)]'
            : isResolved && isIncorrect
              ? 'border-red-500/30 shadow-[0_0_24px_rgba(239,68,68,0.12),0_12px_40px_rgba(0,0,0,0.4)]'
              : 'border-white/12',
        )}
      >
        {accent ? (
          <div className="mb-4 flex min-w-0 items-center gap-2">
            <div
              className="h-1.5 w-8 shrink-0 rounded-full"
              style={{ backgroundColor: `hsl(${accent.hue} 70% 60%)` }}
            />
            <span className="shrink-0 text-xs font-medium" style={{ color: `hsl(${accent.hue} 70% 70%)` }}>
              {accent.label}
            </span>
            <span className="text-zinc-700">·</span>
            <span className="min-w-0 truncate text-xs text-zinc-500">{palaceTitle}</span>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge className="border-white/10 bg-white/8 text-zinc-200">{palaceTitle}</Badge>
            {segmentNames ? <Badge className="border-white/10 bg-white/5 text-zinc-300">{segmentNames}</Badge> : null}
            {chapterName ? <Badge className="border-white/10 bg-white/5 text-zinc-300">{chapterName}</Badge> : null}
            <Badge className="border-white/10 bg-white/5 text-zinc-300">
              {QUESTION_TYPE_DISPLAY[card.question.question_type] ?? card.question.question_type}
            </Badge>
          </div>
          <Badge
            className={cn(
              'border-white/10 bg-white/5 text-zinc-400',
              !answeredBefore && 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200',
            )}
          >
            {answeredBefore ? '已做过' : '新题'}
          </Badge>
        </div>
        <div className="mt-5 whitespace-pre-wrap text-xl font-semibold leading-8 sm:text-2xl">
          {card.question.stem}
        </div>
        <div className="freestyle-quiz-interaction mt-6 text-zinc-100 [&_button]:border-white/15 [&_button]:bg-white/5 [&_button:hover]:bg-white/10 [&_.text-muted-foreground]:text-zinc-400 [&_.bg-background\/70]:bg-zinc-950/70 [&_.border-border\/70]:border-white/15">
          <QuizQuestionInteraction
            question={card.question}
            state={state}
            compact
            onStateChange={onStateChange}
            onChoiceResolve={onChoiceResolve}
            onShortAnswerSubmit={onShortAnswerSubmit}
            onRequestShortAnswerFeedback={onRequestShortAnswerFeedback}
          />
        </div>
        {isResolved && onRequestNext ? (
          <div className="mt-5 flex justify-stretch sm:justify-end">
            <button
              type="button"
              className="min-h-11 w-full rounded-full border border-emerald-400/30 bg-emerald-400/10 px-5 py-2.5 text-sm font-medium text-emerald-100 hover:bg-emerald-400/20 sm:w-auto"
              onClick={onRequestNext}
            >
              下一题
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
