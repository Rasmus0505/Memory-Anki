import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
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

export function NodeBoundQuizDialog({
  open,
  onOpenChange,
  palaceId,
  nodeUid,
  questionIds,
  initialIndex = 0,
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
        const ordered = questionIds
          .map((id) => byId.get(id))
          .filter((item): item is PalaceQuizQuestion => Boolean(item))
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
        const safeIndex = Math.max(0, Math.min(initialIndex, Math.max(ordered.length - 1, 0)))
        setIndex(safeIndex)
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
  }, [open, palaceId, questionIdsKey, nodeUid, initialIndex])

  const current = questions[index] ?? null

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
        <DialogContent className="max-h-[90vh] max-w-xl overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base">关联题目</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
              {headerDetail}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 overflow-y-auto px-4 py-3" style={{ maxHeight: '70vh' }}>
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
                {questions.length > 1 ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                      {questions.map((item, itemIndex) => {
                        const done = Boolean(questionStates[item.id]?.resolved)
                        const active = itemIndex === index
                        return (
                          <button
                            key={item.id}
                            type="button"
                            title={`第 ${itemIndex + 1} 题${done ? '（已答）' : ''}`}
                            className={cn(
                              'flex size-7 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors',
                              active
                                ? 'border-primary bg-primary text-primary-foreground'
                                : done
                                  ? 'border-muted-foreground/40 bg-muted text-muted-foreground'
                                  : 'border-border bg-background text-foreground hover:bg-muted',
                            )}
                            onClick={() => setIndex(itemIndex)}
                          >
                            {itemIndex + 1}
                          </button>
                        )
                      })}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={index <= 0}
                        onClick={() => setIndex((value) => Math.max(0, value - 1))}
                      >
                        <ChevronLeft className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={index >= questions.length - 1}
                        onClick={() =>
                          setIndex((value) => Math.min(questions.length - 1, value + 1))
                        }
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
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
                <QuizQuestionInteraction
                  question={current}
                  state={currentState}
                  onStateChange={(updater) => updateLocalState(current.id, updater)}
                  onChoiceResolve={(optionId, isCorrect) => {
                    orchestration.handleChoiceSelect(current, optionId, isCorrect)
                    markCompleted(current.id)
                  }}
                  onShortAnswerSubmit={() => {
                    orchestration.handleShortAnswerSubmit(current.id)
                    markCompleted(current.id)
                  }}
                  onRequestShortAnswerFeedback={() =>
                    void orchestration.handleShortAnswerFeedback(current)
                  }
                />
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {aiRunConfigDialog}
    </>
  )
}
