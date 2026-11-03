import type { RefObject, ReactNode } from 'react'
import type { QuizOptionShuffleActions } from '../model/quizOptionShuffle'
import type { PalaceQuizQuestion, PalaceQuizQuestionDraft } from '@/shared/api/contracts'
import { QuizQuestionInteraction } from './QuizQuestionInteraction'
import { QuizQuestionStem } from './QuizQuestionStem'
import { QuizFontScaleBody } from './QuizFontScaleBody'
import type { QuizRuntimeState } from '../model/quizRuntime'
import { cn } from '@/shared/lib/utils'

type QuizQuestion = PalaceQuizQuestion | PalaceQuizQuestionDraft

type QuizQuestionMark = {
  marked: boolean
  disabled?: boolean
  onToggle: (marked: boolean) => void
}

/**
 * Shared answer surface for every quiz presentation.
 *
 * The host owns scope, navigation, persistence and any metadata/actions. This
 * component owns only the visual order that must stay identical: scaled stem,
 * answer interaction and optional mark control. Keeping that boundary lets
 * palace practice, freestyle and node-bound windows use the same answering
 * evidence without sharing their queue or management state.
 */
export function QuizQuestionAnswerSurface({
  question,
  state,
  compact = false,
  fontScalePercent = 100,
  interactionRef,
  onStateChange,
  onChoiceResolve,
  onShortAnswerSubmit,
  getDurationMs,
  comboScopeKey,
  mark,
  before,
  after,
  captureShortcuts = true,
  className,
  optionShuffleActionsRef,
  onOptionShuffleAvailabilityChange,
}: {
  question: QuizQuestion
  state: QuizRuntimeState | undefined
  compact?: boolean
  fontScalePercent?: number
  interactionRef?: RefObject<HTMLDivElement | null>
  onStateChange: (updater: (current: QuizRuntimeState) => QuizRuntimeState) => void
  onChoiceResolve?: (optionId: string | string[], isCorrect: boolean) => void
  onShortAnswerSubmit?: () => void
  getDurationMs?: (questionId: number) => number | null
  comboScopeKey?: string | null
  mark?: QuizQuestionMark
  before?: ReactNode
  after?: ReactNode
  captureShortcuts?: boolean
  className?: string
  optionShuffleActionsRef?: RefObject<QuizOptionShuffleActions | null>
  onOptionShuffleAvailabilityChange?: (canRestore: boolean) => void
}) {
  return (
    <div className={cn('space-y-3', className)} data-quiz-question-answer-surface="">
      {before}
      <QuizFontScaleBody percent={fontScalePercent}>
        <div className={cn('font-semibold leading-7 text-foreground', compact ? 'text-sm' : 'text-base')}>
          <QuizQuestionStem question={question} />
        </div>
        <div ref={interactionRef}>
          <QuizQuestionInteraction
            key={JSON.stringify(['id' in question ? question.id : null, question.options])}
            question={question}
            state={state}
            compact={compact}
            captureShortcuts={captureShortcuts}
            onStateChange={onStateChange}
            onChoiceResolve={onChoiceResolve}
            onShortAnswerSubmit={onShortAnswerSubmit}
            getDurationMs={getDurationMs}
            comboScopeKey={comboScopeKey}
            mark={mark}
            optionShuffleActionsRef={optionShuffleActionsRef}
            onOptionShuffleAvailabilityChange={onOptionShuffleAvailabilityChange}
          />
        </div>
      </QuizFontScaleBody>
      {after}
    </div>
  )
}
