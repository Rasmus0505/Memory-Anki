import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Check, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import { useAiRunConfigDialog } from '@/modules/settings/public'
import {
  getPalaceQuizQuestionsApi,
  getPalaceQuizQuestionsByIdsApi,
  listPalaceQuizNodeBindingsApi,
} from '@/modules/quiz/domain/quiz-entity/api'
import {
  QuizQuestionInteraction,
  useQuizAttemptOrchestration,
  type QuizRuntimeState,
} from '@/modules/quiz/public'
import { ownerPalaceLabel } from '@/modules/quiz/ui/palace-quiz/model/quizNodeBindingAggregation'
import { getQuestionTypeLabel } from '@/modules/quiz/ui/palace-quiz/model/palaceQuizPage'
import { sortPalaceQuizQuestions } from '@/modules/quiz/ui/palace-quiz/model/questionBankOrder'
import { firstIncompleteQuestionIndex } from '@/modules/quiz/ui/palace-quiz/model/quizNodeBindingAggregation'
import type { PalaceQuizQuestion, QuizNodeBindingEdge } from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import { toast } from '@/shared/feedback/toast'
import { cn } from '@/shared/lib/utils'
import { PalaceMemoryLookupDialog } from '@/widgets/palace-memory-lookup'

export function NodeBoundQuizDialog({
  open,
  onOpenChange,
  palaceId,
  nodeUid,
  questionIds,
  initialIndex: _initialIndex = 0,
  initialQuestionStates,
  onQuestionStateChange,
  onQuestionCompleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  palaceId: number | null
  nodeUid: string | null
  questionIds: number[]
  /** Prefer first unfinished when reopening a mixed done/todo list. */
  initialIndex?: number
  /** Session drafts so previous answers remain visible when switching questions. */
  initialQuestionStates?: Record<number, QuizRuntimeState>
  onQuestionStateChange?: (questionId: number, next: QuizRuntimeState) => void
  onQuestionCompleted: (questionId: number) => void
}) {
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [questions, setQuestions] = useState<PalaceQuizQuestion[]>([])
  const [bindingByQuestion, setBindingByQuestion] = useState<Map<number, QuizNodeBindingEdge>>(
    () => new Map(),
  )
  const [index, setIndex] = useState(0)
  const [questionStates, setQuestionStates] = useState<Record<number, QuizRuntimeState>>({})
  const [keyboardOptionIndex, setKeyboardOptionIndex] = useState(0)
  const [palaceLookupOpen, setPalaceLookupOpen] = useState(false)
  const questionInteractionRef = useRef<HTMLDivElement | null>(null)

  const questionIdsKey = questionIds.join(',')

  useEffect(() => {
    if (!open || !palaceId || questionIds.length === 0) {
      setQuestions([])
      setBindingByQuestion(new Map())
      setIndex(0)
      setQuestionStates({})
      setLoadError('')
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError('')
    void Promise.all([
      getPalaceQuizQuestionsByIdsApi(questionIds).catch(() => ({ items: [] as PalaceQuizQuestion[] })),
      listPalaceQuizNodeBindingsApi(palaceId),
      getPalaceQuizQuestionsApi(palaceId).catch(() => ({ items: [] as PalaceQuizQuestion[] })),
    ])
      .then(([questionResponse, bindingResponse, palaceQuestions]) => {
        if (cancelled) return
        const byId = new Map<number, PalaceQuizQuestion>()
        for (const item of palaceQuestions.items || []) byId.set(item.id, item)
        for (const item of questionResponse.items || []) byId.set(item.id, item)
        const ordered = sortPalaceQuizQuestions(
          questionIds
            .map((id) => byId.get(id))
            .filter((item): item is PalaceQuizQuestion => Boolean(item)),
        )
        setQuestions(ordered)
        if (ordered.length === 0) {
          setLoadError('绑定题目未能加载，可能已删除。')
        }
        const map = new Map<number, QuizNodeBindingEdge>()
        for (const edge of bindingResponse.items || []) {
          const qid = Number(edge.question_id)
          if (!Number.isFinite(qid)) continue
          if (nodeUid && edge.node_uid === nodeUid) {
            map.set(qid, edge)
            continue
          }
          if (!map.has(qid)) map.set(qid, edge)
        }
        setBindingByQuestion(map)
        const completedIds = new Set(
          ordered
            .filter((question) => initialQuestionStates?.[question.id]?.resolved)
            .map((question) => question.id),
        )
        setIndex(
          firstIncompleteQuestionIndex(
            ordered.map((question) => question.id),
            completedIds,
          ),
        )
        // Keep prior session answers so prev/next can review 答题情况.
        const restored: Record<number, QuizRuntimeState> = {}
        for (const question of ordered) {
          const existing = initialQuestionStates?.[question.id]
          if (existing) restored[question.id] = existing
        }
        setQuestionStates(restored)
      })
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : '加载题目失败。'
          setLoadError(message)
          toast.error(message)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable key for id list; seed states once per open
  }, [open, palaceId, questionIdsKey, nodeUid])

  const current = questions[index] ?? null

  useEffect(() => {
    setKeyboardOptionIndex(0)
  }, [current?.id])

  const markCompleted = useCallback(
    (questionId: number) => {
      onQuestionCompleted(questionId)
    },
    [onQuestionCompleted],
  )

  const updateLocalState = useCallback(
    (questionId: number, updater: (current: QuizRuntimeState) => QuizRuntimeState) => {
      setQuestionStates((current) => {
        const prev = current[questionId] ?? {}
        const next = updater(prev)
        onQuestionStateChange?.(questionId, next)
        return { ...current, [questionId]: next }
      })
    },
    [onQuestionStateChange],
  )

  const adapter = useMemo(
    () => ({
      readQuestionState: (questionId: number) => questionStates[questionId] ?? {},
      updateQuestionState: (
        questionId: number,
        updater: (current: QuizRuntimeState) => QuizRuntimeState,
      ) => {
        updateLocalState(questionId, updater)
      },
      applyUpdatedQuestion: (question: PalaceQuizQuestion) => {
        setQuestions((current) =>
          current.map((item) => (item.id === question.id ? question : item)),
        )
      },
    }),
    [questionStates, updateLocalState],
  )

  const orchestration = useQuizAttemptOrchestration({
    adapter,
    promptForAiOptions,
    shortAnswerEntrypointKey: 'palace.node-bound-quiz.short-answer',
    resultFeedbackMode: 'immediate',
    emitFeedback: dispatchGlobalFeedback,
    onChoiceStart: ({ question }) => {
      markCompleted(question.id)
    },
  })

  const ownerLabel =
    current && bindingByQuestion.get(current.id)
      ? ownerPalaceLabel(bindingByQuestion.get(current.id)!, palaceId)
      : null

  const currentState = current ? questionStates[current.id] ?? {} : {}
  const answeredCount = questions.filter((item) => questionStates[item.id]?.resolved).length

  const handleChoiceResolve = useCallback(
    (optionId: string, isCorrect: boolean) => {
      if (!current) return
      orchestration.handleChoiceSelect(current, optionId, isCorrect)
      markCompleted(current.id)
    },
    [current, markCompleted, orchestration],
  )

  useEffect(() => {
    if (!open || !current) return
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement
        && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (questions.length <= 1) return
        event.preventDefault()
        setIndex((value) =>
          event.key === 'ArrowLeft'
            ? Math.max(0, value - 1)
            : Math.min(questions.length - 1, value + 1),
        )
        return
      }

      if (current.question_type !== 'multiple_choice' || currentState.resolved) return
      const optionCount = current.options.length
      if (optionCount === 0) return

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        const delta = event.key === 'ArrowDown' ? 1 : -1
        const nextIndex = (keyboardOptionIndex + delta + optionCount) % optionCount
        setKeyboardOptionIndex(nextIndex)
        questionInteractionRef.current
          ?.querySelector<HTMLButtonElement>(`[data-quiz-option-index="${nextIndex}"]`)
          ?.focus()
        return
      }

      const normalizedKey = event.key.toLowerCase()
      const directIndex = /^[1-4]$/.test(normalizedKey)
        ? Number(normalizedKey) - 1
        : 'abcd'.indexOf(normalizedKey)
      const focusedOption =
        target instanceof HTMLElement
          ? target.closest<HTMLElement>('[data-quiz-option-index]')
          : null
      if (
        event.key === 'Enter' &&
        target instanceof HTMLElement &&
        !focusedOption &&
        target.closest('button, [role="button"], a')
      ) {
        return
      }
      const focusedIndex = focusedOption?.dataset.quizOptionIndex
      const optionIndex = event.key === 'Enter'
        ? (focusedIndex == null ? keyboardOptionIndex : Number(focusedIndex))
        : directIndex
      if (optionIndex < 0 || optionIndex >= optionCount) return
      const option = current.options[optionIndex]
      if (!option) return
      event.preventDefault()
      const correct = option.id === (current.answer_payload.correct_option_id || '')
      updateLocalState(current.id, (state) => ({
        ...state,
        selectedOptionId: option.id,
        resolved: true,
        correct,
      }))
      handleChoiceResolve(option.id, correct)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [
    current,
    currentState.resolved,
    handleChoiceResolve,
    keyboardOptionIndex,
    open,
    questions.length,
    updateLocalState,
  ])

  const headerDetail = loading
    ? '加载中…'
    : questions.length > 0
      ? `第 ${index + 1} / ${questions.length} 题` +
        (answeredCount > 0 ? ` · 已答 ${answeredCount}` : '') +
        (ownerLabel ? ` · ${ownerLabel}` : '')
      : '关闭后继续翻卡'

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          // Own floating id: the fallback key is derived from className, so a style
          // tweak used to throw away the learner's remembered window size.
          floatingId="node-bound-quiz"
          showCloseButton
          // A collapsed capsule must not swallow the next badge click: without this,
          // tapping a node's question count only re-showed the capsule.
          expandOnOpen
          // An answering window should not vanish on a stray tap into the map behind
          // it. ✕ / 完成 / Escape stay as the ways out.
          dismissOnInteractOutside={false}
          // max-w-none: `max-w-xl` beat the floating window's own width, so dragging
          // the right edge past 36rem did nothing. Phone/centered fallback keeps a cap.
          className="max-h-[min(92vh,100dvh-1rem)] w-[min(46rem,calc(100vw-1rem))] max-w-none p-0"
          data-keyboard-shortcuts-suspended="true"
          data-testid="node-bound-quiz-dialog"
        >
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="text-base">关联题目</DialogTitle>
              {palaceId != null ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label="查看宫殿"
                  title="查看宫殿和思维导图"
                  onClick={() => setPalaceLookupOpen(true)}
                >
                  <BookOpen className="size-4" />
                  查看宫殿
                </Button>
              ) : null}
            </div>
            <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
              {headerDetail}
            </DialogDescription>
          </DialogHeader>

          {/* min-h-0 + flex-1: the old fixed 70vh left dead space inside a resized
              floating window and double-clipped against the panel's own max-height. */}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                加载题目…
              </div>
            ) : loadError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-4 text-sm text-destructive">
                {loadError}
              </div>
            ) : !current ? (
              <div className="py-12 text-center text-sm text-muted-foreground">暂无题目</div>
            ) : (
              <>
                {/* Sticky: the pills are the only way back to an earlier question,
                    and a long stem used to scroll them out of reach. */}
                {questions.length > 1 ? (
                  <div className="sticky -top-3 z-10 -mx-4 -mt-3 flex flex-wrap items-center gap-1 border-b border-border/60 bg-background/95 px-4 py-2 backdrop-blur">
                    {questions.map((item, itemIndex) => {
                      const itemState = questionStates[item.id]
                      const done = Boolean(itemState?.resolved)
                      const active = itemIndex === index
                      return (
                        <button
                          key={item.id}
                          type="button"
                          aria-current={active ? 'true' : undefined}
                          title={`第 ${itemIndex + 1} 题${
                            done ? (itemState?.correct === false ? '（已答·错）' : '（已答）') : ''
                          }`}
                          className={cn(
                            'flex size-7 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors',
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : done
                                ? itemState?.correct === false
                                  ? 'border-destructive/45 bg-destructive/10 text-destructive'
                                  : 'border-emerald-500/45 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : 'border-border bg-background text-foreground hover:bg-muted',
                          )}
                          onClick={() => setIndex(itemIndex)}
                        >
                          {itemIndex + 1}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{getQuestionTypeLabel(current.question_type)}</Badge>
                    {currentState.resolved ? (
                      <Badge variant={currentState.correct ? 'secondary' : 'destructive'}>
                        {currentState.correct ? '已答对' : '已作答'}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="whitespace-pre-wrap text-base font-semibold leading-7 text-foreground">
                    {current.stem || '（题干为空）'}
                  </div>
                </div>
                <div ref={questionInteractionRef}>
                  <QuizQuestionInteraction
                    question={current}
                    state={currentState}
                    onStateChange={(updater) => updateLocalState(current.id, updater)}
                    onChoiceResolve={handleChoiceResolve}
                    onShortAnswerSubmit={() => {
                      orchestration.handleShortAnswerSubmit(current.id)
                      markCompleted(current.id)
                    }}
                    onRequestShortAnswerFeedback={() =>
                      void orchestration.handleShortAnswerFeedback(current)
                    }
                  />
                </div>
              </>
            )}
          </div>

          {/*
            Footer: navigation used to sit in the top-right, above the stem — the
            furthest point from the thumb right after answering. Progress lives here
            too so the header description stops being the only place that counts.
          */}
          {current ? (
            <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3">
              <span className="min-w-0 truncate text-xs tabular-nums text-muted-foreground">
                {questions.length > 1
                  ? `已答 ${answeredCount} / ${questions.length}`
                  : currentState.resolved
                    ? '已作答'
                    : '待作答'}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {questions.length > 1 ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label="上一题"
                      disabled={index <= 0}
                      onClick={() => setIndex((value) => Math.max(0, value - 1))}
                    >
                      <ChevronLeft className="size-4" />
                      上一题
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={currentState.resolved ? 'default' : 'outline'}
                      aria-label="下一题"
                      disabled={index >= questions.length - 1}
                      onClick={() =>
                        setIndex((value) => Math.min(questions.length - 1, value + 1))
                      }
                    >
                      下一题
                      <ChevronRight className="size-4" />
                    </Button>
                  </>
                ) : null}
                {/* Last question answered: an explicit way out beats hunting for ✕. */}
                {index >= questions.length - 1 && currentState.resolved ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onOpenChange(false)}
                  >
                    <Check className="size-4" />
                    完成
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <PalaceMemoryLookupDialog
        open={palaceLookupOpen}
        onOpenChange={setPalaceLookupOpen}
        currentPalaceId={palaceId}
        followCurrentPalace
      />
      {aiRunConfigDialog}
    </>
  )
}
