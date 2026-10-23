import { useEffect, useRef, useState } from 'react'
import {
  isQuizChoiceAttemptClosed,
  isQuizChoiceShortcutActive,
  isQuizShortcutRecording,
  isShortcutPressed,
  QuizAttemptStatsBadge,
  QuizQuestionInteraction,
  QuizQuestionStem,
  readQuizShortcuts,
  resolveQuizShortcutAction,
  useQuizAnswerMode,
  type QuizRuntimeState,
} from '@/modules/quiz/public'
import {
  QUESTION_TYPE_ACCENT,
  QUESTION_TYPE_DISPLAY,
} from '@/modules/practice/ui/freestyle/model/freestyle-labels'
import { isFreestyleShortcutBlocked } from '@/modules/practice/ui/freestyle/model/freestyleKeyboard'
import type { FreestyleQuizCard } from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { cn } from '@/shared/lib/utils'
import { cue } from '@/shared/fx'

function focusedOptionIndex(target: EventTarget | null) {
  const option = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-quiz-option-index]') : null
  if (!option) return null
  const index = Number(option.dataset.quizOptionIndex)
  return Number.isFinite(index) ? index : null
}

export function FreestyleQuizCardView({
  card,
  state,
  answeredBefore,
  onStateChange,
  onChoiceResolve,
  onShortAnswerSubmit,
  onRequestNext,
  active = false,
}: {
  card: FreestyleQuizCard
  state: QuizRuntimeState | undefined
  answeredBefore: boolean
  onStateChange: (updater: (current: QuizRuntimeState) => QuizRuntimeState) => void
  onChoiceResolve: (optionId: string | string[], isCorrect: boolean) => void
  onShortAnswerSubmit: () => void
  /** Immersive feed: explicit next after reading analysis. */
  onRequestNext?: () => void
  /** Only the card currently under the feed viewport owns choice shortcuts. */
  active?: boolean
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const paperRef = useRef<HTMLDivElement | null>(null)
  const [keyboardOptionIndex, setKeyboardOptionIndex] = useState(0)
  const { mode: answerMode } = useQuizAnswerMode()
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

  // Only a live resolve on this question reacts; a card restored as answered stays still.
  const resolvedSeenRef = useRef<{ questionId: FreestyleQuizCard['question']['id']; resolved: boolean } | null>(null)
  useEffect(() => {
    const previous = resolvedSeenRef.current
    resolvedSeenRef.current = { questionId: card.question.id, resolved: isResolved }
    const justResolved = previous?.questionId === card.question.id && !previous.resolved && isResolved
    const paper = paperRef.current
    if (!justResolved || !active || !paper) return
    cue(isCorrect ? 'answer.correct' : 'answer.wrong', { paper })
  }, [active, card.question.id, isCorrect, isResolved])

  // Same key map and precedence as the palace quiz dialog (useQuizAnsweringShortcuts):
  // choice keys submit, and once the answer is on screen the submit key turns the page.
  // ←/→ and the feed's vertical paging stay with the feed.
  useEffect(() => {
    if (!active) return
    const choiceActive = isQuizChoiceShortcutActive(card.question.question_type, answerMode)
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || isFreestyleShortcutBlocked(event.target)) return
      const target = event.target
      // Enter on a focused control (for example the 下一题 button) belongs to that control.
      if (
        event.key === 'Enter'
        && focusedOptionIndex(target) == null
        && target instanceof HTMLElement
        && target.closest('button, [role="button"], a')
      ) {
        return
      }
      const shortcuts = readQuizShortcuts()

      if (isResolved) {
        if (!onRequestNext || event.repeat || !isShortcutPressed(event, shortcuts.submit_choice)) return
        event.preventDefault()
        onRequestNext()
        return
      }
      if (!choiceActive) return

      const match = resolveQuizShortcutAction(event, shortcuts, {
        questionCount: 0,
        optionCount: card.question.options.length,
        choiceShortcutsActive: true,
        attemptClosed: isQuizChoiceAttemptClosed(state),
        answerRevealed: false,
        hasNextQuestion: false,
        repeat: event.repeat,
        editable: false,
        recording: isQuizShortcutRecording(),
        enterOnUnrelatedControl: false,
      })
      if (!match) return

      if (match.id === 'next_option' || match.id === 'previous_option') {
        const optionCount = card.question.options.length
        if (optionCount === 0) return
        event.preventDefault()
        if (!match.run) return
        const delta = match.id === 'next_option' ? 1 : -1
        const nextIndex = (keyboardOptionIndex + delta + optionCount) % optionCount
        setKeyboardOptionIndex(nextIndex)
        cardRef.current
          ?.querySelector<HTMLButtonElement>(`[data-quiz-option-index="${nextIndex}"]`)
          ?.focus()
        return
      }

      // Mark and delete have no freestyle equivalent; leave those keys to the feed.
      if (match.id !== 'submit_choice' && !match.id.startsWith('select_option_')) return
      const optionIndex = match.id === 'submit_choice'
        ? (focusedOptionIndex(target) ?? keyboardOptionIndex)
        : match.optionIndex
      const option = optionIndex == null ? undefined : card.question.options[optionIndex]
      if (!option) return
      event.preventDefault()
      if (!match.run) return
      const correctIds = (card.question.answer_payload.correct_option_ids || []).map(String)
      if (correctIds.length > 1) {
        if (match.id.startsWith('select_option_')) {
          onStateChange((current) => {
            const picked = current.selectedOptionIds || []
            return {
              ...current,
              selectedOptionIds: picked.includes(option.id)
                ? picked.filter((item) => item !== option.id)
                : [...picked, option.id].sort(),
            }
          })
          return
        }
        const picked = state?.selectedOptionIds || []
        if (picked.length === 0) return
        const correct =
          picked.length === correctIds.length && picked.every((item) => correctIds.includes(item))
        onStateChange((current) => ({ ...current, resolved: true, correct }))
        onChoiceResolve(picked, correct)
        return
      }
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
    answerMode,
    card.question,
    isResolved,
    keyboardOptionIndex,
    onChoiceResolve,
    onRequestNext,
    onStateChange,
    state,
  ])

  return (
    <div
      ref={cardRef}
      data-recorder-current={active ? 'true' : undefined}
      data-recorder-place={active ? [palaceTitle, chapterName].filter(Boolean).join(' / ') : undefined}
      data-recorder-title={active ? card.question.stem : undefined}
      data-recorder-excerpt={active ? card.question.stem : undefined}
      className="mx-auto flex h-full w-full max-w-4xl flex-col justify-center py-2 sm:py-4"
    >
      <div
        ref={paperRef}
        className={cn(
          'fs-paper-card relative overflow-hidden rounded-[1.5rem] p-4 transition-shadow duration-500 sm:p-6',
          isResolved && isCorrect && 'fs-option-correct ring-2 ring-rate-good/45',
          isResolved && isIncorrect && 'ring-2 ring-rate-again/35',
        )}
      >
        {accent ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-1"
            style={{ background: `linear-gradient(90deg, hsl(${accent.hue} 70% 55%), transparent 70%)` }}
          />
        ) : null}
        {accent ? (
          <div className="mb-4 flex min-w-0 items-center gap-2">
            <div
              className="h-1.5 w-8 shrink-0 rounded-full"
              style={{ backgroundColor: `hsl(${accent.hue} 62% 50%)` }}
            />
            <span className="shrink-0 text-xs font-semibold" style={{ color: `hsl(${accent.hue} 60% 38%)` }}>
              {accent.label}
            </span>
            <span className="text-paper-line-strong">·</span>
            <span className="min-w-0 truncate text-xs text-paper-muted">{palaceTitle}</span>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge className="border-paper-line bg-muted text-paper-ink-soft">{palaceTitle}</Badge>
            {segmentNames ? <Badge className="border-paper-line bg-muted/70 text-paper-muted">{segmentNames}</Badge> : null}
            {chapterName ? <Badge className="border-paper-line bg-muted/70 text-paper-muted">{chapterName}</Badge> : null}
            <QuizAttemptStatsBadge
              correctCount={card.question.correct_count}
              attemptCount={card.question.attempt_count}
              className="border-paper-line bg-muted/70 text-paper-muted"
            />
            <Badge className="border-paper-line bg-muted/70 text-paper-muted">
              {QUESTION_TYPE_DISPLAY[card.question.question_type] ?? card.question.question_type}
            </Badge>
          </div>
          <Badge
            className={cn(
              'border-paper-line bg-muted/70 text-paper-muted',
              !answeredBefore && 'border-primary/30 bg-primary-soft text-primary-strong',
            )}
          >
            {answeredBefore ? '已做过' : '新题'}
          </Badge>
        </div>
        <div className="mt-5 text-xl font-semibold leading-[1.7] tracking-[0.01em] text-paper-ink sm:text-2xl">
          <QuizQuestionStem question={card.question} />
        </div>
        <div className="freestyle-quiz-interaction fs-quiz-options mt-6 text-paper-ink-soft [&_button]:bg-paper-card">
          <QuizQuestionInteraction
            question={card.question}
            state={state}
            compact
            captureShortcuts={active}
            onStateChange={onStateChange}
            onChoiceResolve={onChoiceResolve}
            onShortAnswerSubmit={onShortAnswerSubmit}
          />
        </div>
        {isResolved && onRequestNext ? (
          <div className="mt-5 flex justify-stretch sm:justify-end">
            <button
              type="button"
              className="ma-pressable fs-rise min-h-11 w-full rounded-full bg-gradient-to-r from-primary to-primary-strong px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 sm:w-auto"
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
