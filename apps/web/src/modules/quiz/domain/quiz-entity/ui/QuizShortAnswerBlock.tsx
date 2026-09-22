import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import type {
  PalaceQuizQuestion,
  PalaceQuizQuestionDraft,
  PalaceShortAnswerFeedback,
} from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Textarea } from '@/shared/components/ui/textarea'
import { cn } from '@/shared/lib/utils'
import { rewriteMcqForSubjective } from '@/modules/quiz/domain/quiz-entity/model/mcqSubjectiveRewrite'
import {
  formatMcqSubjectiveAnalysis,
  mcqRevealOptions,
  type QuizAnswerMode,
} from '@/modules/quiz/domain/quiz-entity/model/quizAnswerMode'
import type { QuizRuntimeState } from '@/modules/quiz/domain/quiz-entity/model/quizRuntime'

function renderShortAnswerFeedback(feedback: PalaceShortAnswerFeedback, compact: boolean) {
  const verdictLabel =
    feedback.verdict === 'correct'
      ? '基本正确'
      : feedback.verdict === 'partial'
        ? '部分正确'
        : '需要重学'
  const verdictVariant =
    feedback.verdict === 'correct'
      ? 'success'
      : feedback.verdict === 'partial'
        ? 'secondary'
        : 'destructive'
  const hitPoints = feedback.hit_points || []
  const missedPoints = feedback.missed_points || []

  return (
    <div
      className={cn(
        'rounded-xl border border-primary/20 bg-primary/5 px-3 py-3',
        compact ? 'mt-3' : 'mt-4',
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        AI点评
        {feedback.verdict ? <Badge variant={verdictVariant}>{verdictLabel}</Badge> : null}
      </div>
      {feedback.resolved_ai?.model_label ? (
        <div className="mb-2 text-xs text-muted-foreground">
          实际模型：{feedback.resolved_ai.model_label}
        </div>
      ) : null}
      {feedback.verdict ? (
        <div className="space-y-2 text-sm">
          {hitPoints.length > 0 ? (
            <div>
              <div className="font-medium text-success">答到的要点</div>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {hitPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {missedPoints.length > 0 ? (
            <div>
              <div className="font-medium text-destructive">遗漏或有偏差</div>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {missedPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {feedback.suggestion ? (
            <div>
              <div className="font-medium">建议</div>
              <p className="mt-1 text-muted-foreground">{feedback.suggestion}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="whitespace-pre-wrap text-sm text-muted-foreground">
          {feedback.feedback_text}
        </div>
      )}
    </div>
  )
}

export function QuizAnswerModeToggle({
  mode,
  disabled,
  onChange,
}: {
  mode: QuizAnswerMode
  disabled: boolean
  onChange: (mode: QuizAnswerMode) => void
}) {
  return (
    <div className="flex justify-end">
      <div
        role="group"
        aria-label="答题方式"
        className="inline-flex rounded-full border border-border/70 bg-background/60 p-0.5 text-xs"
      >
        {(['choice', 'subjective'] as const).map((value) => (
          <button
            key={value}
            type="button"
            disabled={disabled}
            aria-pressed={mode === value}
            onClick={() => onChange(value)}
            className={cn(
              'rounded-full px-2.5 py-1 font-medium transition-colors',
              mode === value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {value === 'choice' ? '选择' : '主观'}
          </button>
        ))}
      </div>
    </div>
  )
}

const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isShortcutSubmitKey(event: {
  key: string
  shiftKey: boolean
  altKey: boolean
  isComposing: boolean
}) {
  if (event.isComposing) return false
  if (event.key === 'Enter') return !event.shiftKey && !event.altKey
  return event.key === ' '
}

function belongsToShortAnswerSurface(root: HTMLElement | null, target: HTMLElement) {
  if (!root) return true
  if (root.contains(target)) return true
  const surface = target.closest('[data-quiz-shortcut-surface]')
  return Boolean(surface && surface.contains(root))
}

export function ShortAnswerBlock({
  question,
  state,
  compact,
  referenceAnswer,
  captureShortcuts,
  modeToggle,
  extraAction,
  onStateChange,
  onShortAnswerSubmit,
}: {
  question: PalaceQuizQuestion | PalaceQuizQuestionDraft
  state: QuizRuntimeState | undefined
  compact: boolean
  referenceAnswer: string
  captureShortcuts: boolean
  modeToggle: ReactNode
  extraAction?: ReactNode
  onStateChange: (updater: (current: QuizRuntimeState) => QuizRuntimeState) => void
  onShortAnswerSubmit?: () => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const currentState = state || {}
  const submitted = Boolean(currentState.shortAnswerSubmitted || currentState.resolved)
  const submittedRef = useRef(submitted)
  submittedRef.current = submitted
  const answerText = currentState.shortAnswerText || ''

  const submit = useCallback(() => {
    if (submittedRef.current) return
    submittedRef.current = true
    onStateChange((current) => ({
      ...current,
      resolved: true,
      shortAnswerSubmitted: true,
      shortAnswerFeedback: null,
    }))
    onShortAnswerSubmit?.()
  }, [onShortAnswerSubmit, onStateChange])

  const revealOptions =
    question.question_type === 'multiple_choice' ? mcqRevealOptions(question) : []
  const subjectiveRewrite =
    question.question_type === 'multiple_choice'
      ? rewriteMcqForSubjective({
          stem: question.stem,
          options: question.options,
          correctOptionId: question.answer_payload?.correct_option_id,
        })
      : null

  useEffect(() => {
    if (submitted || !captureShortcuts) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isShortcutSubmitKey(event)) return
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        event.preventDefault()
        submit()
        return
      }
      if (target.isContentEditable || TEXT_ENTRY_TAGS.has(target.tagName)) return
      if (target.closest('button, [role="button"], a, [role="menu"]')) return
      if (!belongsToShortAnswerSurface(rootRef.current, target)) {
        const otherInteraction = target.closest('[data-quiz-question-interaction]')
        if (otherInteraction) return
      }
      event.preventDefault()
      submit()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [captureShortcuts, submitted, submit])

  return (
    <div ref={rootRef} className="space-y-3" data-quiz-question-interaction="short-answer">
      {modeToggle}
      <Textarea
        value={answerText}
        disabled={submitted}
        onChange={(event) =>
          onStateChange((current) => ({
            ...current,
            shortAnswerText: event.target.value,
          }))
        }
        onKeyDown={(event) => {
          if (submitted) return
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
            event.preventDefault()
            submit()
            return
          }
          if (event.key === ' ' && !answerText.trim()) {
            event.preventDefault()
            submit()
          }
        }}
        rows={compact ? 4 : 5}
        placeholder="先写下你的答案，再点击提交"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={submit} disabled={submitted}>
          提交答案
        </Button>
        {extraAction}
        {!submitted ? (
          <span className="text-xs text-muted-foreground">Enter 提交，Shift+Enter 换行</span>
        ) : null}
      </div>
      {currentState.shortAnswerSubmitted ? (
        <div
          className={cn(
            'border border-border/70 bg-background/70 text-sm',
            compact ? 'rounded-xl px-3 py-3' : 'rounded-lg px-4 py-4',
          )}
        >
          {subjectiveRewrite ? (
            revealOptions.length > 0 ? (
              <>
                <div className="font-medium">选项</div>
                <ul className={cn('space-y-1 text-sm text-muted-foreground', compact ? 'mt-1.5' : 'mt-2')}>
                  {revealOptions.map((option) => (
                    <li key={option.id}>{`${option.id}. ${option.text}`}</li>
                  ))}
                </ul>
              </>
            ) : null
          ) : (
            <>
              <div className="font-medium">参考答案</div>
              <div className={cn('whitespace-pre-wrap text-muted-foreground', compact ? 'mt-1.5' : 'mt-2')}>
                {referenceAnswer || '暂无参考答案'}
              </div>
            </>
          )}
          <div className={cn('font-medium', compact ? 'mt-3' : 'mt-4')}>解析</div>
          <div className={cn('whitespace-pre-wrap text-muted-foreground', compact ? 'mt-1.5' : 'mt-2')}>
            {subjectiveRewrite
              ? formatMcqSubjectiveAnalysis(
                  subjectiveRewrite.referenceAnswer || referenceAnswer,
                  question.analysis,
                )
              : question.analysis || '暂无解析'}
          </div>
          {currentState.shortAnswerFeedback
            ? renderShortAnswerFeedback(currentState.shortAnswerFeedback, compact)
            : null}
        </div>
      ) : null}
    </div>
  )
}
