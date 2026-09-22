import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Check, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import { useAiRunConfigDialog } from '@/modules/settings/public'
import {
  getPalaceQuizQuestionsApi,
  getPalaceQuizQuestionsByIdsApi,
  listPalaceQuizNodeBindingsApi,
} from '@/modules/quiz/domain/quiz-entity/api'
import {
  beginQuizQuestionMarkRequest,
  isCurrentQuizQuestionMarkRequest,
  isQuizChoiceShortcutActive,
  QuizAttemptStatsBadge,
  QuizQuestionIndexPager,
  QuizQuestionInteraction,
  QuizQuestionStem,
  submitQuizQuestionMark,
  useQuizAnswerMode,
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
import { useDwellFragmentOverride } from '@/modules/session/public'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import { toast } from '@/shared/feedback/toast'
import {
  PalaceMemoryLookupDialog,
  collectMemoryLookupFocusNodeUids,
} from '@/widgets/palace-memory-lookup'

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
  const { mode: answerMode } = useQuizAnswerMode()
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [questions, setQuestions] = useState<PalaceQuizQuestion[]>([])
  const [bindingByQuestion, setBindingByQuestion] = useState<Map<number, QuizNodeBindingEdge>>(
    () => new Map(),
  )
  const [bindingsByQuestion, setBindingsByQuestion] = useState<Map<number, QuizNodeBindingEdge[]>>(
    () => new Map(),
  )
  const [index, setIndex] = useState(0)
  const [questionStates, setQuestionStates] = useState<Record<number, QuizRuntimeState>>({})
  const [keyboardOptionIndex, setKeyboardOptionIndex] = useState(0)
  const [palaceLookupOpen, setPalaceLookupOpen] = useState(false)
  const questionInteractionRef = useRef<HTMLDivElement | null>(null)
  useDwellFragmentOverride(open, {
    scene: 'quiz',
    kind: 'quiz',
    title: '关联题目',
    palaceId,
    sourceKind: palaceId != null ? 'palace' : null,
    priority: 1,
  })

  const questionIdsKey = questionIds.join(',')

  useEffect(() => {
    if (!open || !palaceId || questionIds.length === 0) {
      setQuestions([])
      setBindingByQuestion(new Map())
      setBindingsByQuestion(new Map())
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
        const grouped = new Map<number, QuizNodeBindingEdge[]>()
        for (const edge of bindingResponse.items || []) {
          const qid = Number(edge.question_id)
          if (!Number.isFinite(qid)) continue
          const group = grouped.get(qid) ?? []
          group.push(edge)
          grouped.set(qid, group)
          if (nodeUid && edge.node_uid === nodeUid) {
            map.set(qid, edge)
            continue
          }
          if (!map.has(qid)) map.set(qid, edge)
        }
        setBindingByQuestion(map)
        setBindingsByQuestion(grouped)
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

  const currentBinding = current ? bindingByQuestion.get(current.id) : undefined
  const ownerLabel = currentBinding ? ownerPalaceLabel(currentBinding, palaceId) : null
  const lookupFocusNodeUids = useMemo(() => {
    const edges = current ? bindingsByQuestion.get(current.id) ?? [] : []
    const uids =
      edges.length > 0
        ? collectMemoryLookupFocusNodeUids(edges, palaceId)
        : collectMemoryLookupFocusNodeUids(nodeUid ? [{ node_uid: nodeUid }] : [], palaceId)
    if (nodeUid && !uids.includes(nodeUid)) uids.push(nodeUid)
    return uids
  }, [bindingsByQuestion, current, nodeUid, palaceId])
  const lookupFocusNodeUid = lookupFocusNodeUids[0] ?? nodeUid

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

  const handleToggleMark = useCallback(async (marked: boolean) => {
    if (!current) return
    const questionId = current.id
    const token = beginQuizQuestionMarkRequest(questionId)
    try {
      const { question } = await submitQuizQuestionMark({ questionId, marked })
      if (!isCurrentQuizQuestionMarkRequest(questionId, token)) return
      setQuestions((items) => items.map((item) => (item.id === question.id ? { ...item, ...question } : item)))
    } catch (error) {
      if (!isCurrentQuizQuestionMarkRequest(questionId, token)) return
      toast.error(error instanceof Error ? error.message : '保存标记失败。')
    }
  }, [current])

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

      if (!isQuizChoiceShortcutActive(current.question_type, answerMode) || currentState.resolved) return
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
    answerMode,
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
                <QuizQuestionIndexPager
                  count={questions.length}
                  currentIndex={index}
                  getItemState={(itemIndex) => {
                    const question = questions[itemIndex]
                    const itemState = questionStates[question?.id]
                    return {
                      done: Boolean(itemState?.resolved),
                      correct: itemState?.correct,
                      marked: Boolean(question?.marked),
                    }
                  }}
                  onSelect={setIndex}
                />
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <QuizAttemptStatsBadge
                      correctCount={current.correct_count}
                      attemptCount={current.attempt_count}
                    />
                    <Badge variant="outline">{getQuestionTypeLabel(current.question_type)}</Badge>
                    {current.marked ? (
                      <Badge className="border-rose-600 bg-rose-600 text-white">已标记</Badge>
                    ) : null}
                    {currentState.resolved ? (
                      <Badge variant={currentState.correct ? 'secondary' : 'destructive'}>
                        {currentState.correct ? '已答对' : '已作答'}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="text-base font-semibold leading-7 text-foreground">
                    <QuizQuestionStem question={current} />
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
                    mark={{
                      marked: Boolean(current.marked),
                      onToggle: (marked) => void handleToggleMark(marked),
                    }}
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
        focusNodeUid={lookupFocusNodeUid}
        focusNodeUids={lookupFocusNodeUids}
        focusAncestorNodeUid={nodeUid}
      />
      {aiRunConfigDialog}
    </>
  )
}
