import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Check, ChevronLeft, ChevronRight, LoaderCircle, Settings2, Trash2 } from 'lucide-react'
import { createOperationId } from '@/modules/practice/application/feedPersistence'
import {
  ensureFreestyleOverlayQuizApi,
  progressFreestyleOverlayQuizApi,
} from '@/modules/practice/ui/freestyle/api'
import { overlayQuizScopeLabel } from '@/modules/practice/ui/freestyle/model/overlayQuizRange'
import { OverlayQuizSetupPanel, type OverlayQuizSetupChoice } from './OverlayQuizSetupPanel'
import {
  getPalaceQuizQuestionsByIdsApi,
  listQuestionNodeBindingsApi,
} from '@/modules/quiz/domain/quiz-entity/api'
import {
  beginQuizQuestionMarkRequest,
  isCurrentQuizQuestionMarkRequest,
  isQuizChoiceAttemptClosed,
  isQuizChoiceShortcutActive,
  QuizAttemptStatsBadge,
  QuizQuestionIndexPager,
  QuizFontScaleBody,
  QuizFontScaleHint,
  QuizQuestionInteraction,
  QuizQuestionStem,
  submitQuizQuestionMark,
  useQuizAnswerMode,
  useQuizAnsweringShortcuts,
  useQuizAttemptOrchestration,
  useQuizDialogFontScale,
  writeQuizSessionState,
  type QuizRuntimeState,
} from '@/modules/quiz/public'
import {
  mergeOverlayAndSessionStates,
  overlayFromRound,
  resolveOverlayResumeIndex,
} from './overlayQuizHydrate'
import { useFreestyleQuestionTrash } from './useFreestyleQuestionTrash'
import { useAiRunConfigDialog } from '@/modules/settings/public'
import { getQuestionTypeLabel } from '@/modules/quiz/ui/palace-quiz/model/palaceQuizPage'
import type {
  FreestyleFeedConfig,
  FreestyleOverlayQuizState,
  FreestyleRoundStatePayload,
  PalaceQuizQuestion,
} from '@/shared/api/contracts'
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
  pickMemoryLookupBinding,
  resolveMemoryLookupPalaceId,
} from '@/widgets/palace-memory-lookup'

const PROGRESS_DEBOUNCE_MS = 320

export function FreestyleScopeQuizDialog({
  open,
  onOpenChange,
  roundId,
  planVersion,
  storedConfig,
  setupDone,
  rangeLabel,
  palaceCount = 0,
  onConfirmSetup,
  onRoundSync,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  roundId: string
  planVersion: number
  storedConfig: FreestyleFeedConfig
  setupDone: boolean
  rangeLabel: string
  palaceCount?: number
  onConfirmSetup: (next: OverlayQuizSetupChoice) => void
  onRoundSync: (round: FreestyleRoundStatePayload) => void
}) {
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const { mode: answerMode } = useQuizAnswerMode()
  const fontScale = useQuizDialogFontScale(open)
  const [configOpen, setConfigOpen] = useState(!setupDone)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [overlay, setOverlay] = useState<FreestyleOverlayQuizState | null>(null)
  const [questions, setQuestions] = useState<PalaceQuizQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [questionStates, setQuestionStates] = useState<Record<number, QuizRuntimeState>>({})
  const [keyboardOptionIndex, setKeyboardOptionIndex] = useState(0)
  const [palaceLookupOpen, setPalaceLookupOpen] = useState(false)
  const [lookupFocusNodeUids, setLookupFocusNodeUids] = useState<string[]>([])
  const [lookupPalaceIdOverride, setLookupPalaceIdOverride] = useState<number | null>(null)
  const questionInteractionRef = useRef<HTMLDivElement | null>(null)
  const removedQuestionIdsRef = useRef(new Set<number>())
  const planVersionRef = useRef(planVersion)
  const persistTimerRef = useRef<number | null>(null)
  const storedConfigRef = useRef(storedConfig)
  const indexRef = useRef(0)
  const questionStatesRef = useRef<Record<number, QuizRuntimeState>>({})
  const roundIdRef = useRef(roundId)
  const dirtyProgressRef = useRef(false)
  const dwellPalaceId = questions[index]?.palace_id ?? null
  useDwellFragmentOverride(open, {
    scene: 'quiz',
    kind: 'quiz',
    title: '做题',
    palaceId: dwellPalaceId,
    sourceKind: dwellPalaceId != null ? 'palace' : null,
    priority: 1,
  })

  useEffect(() => {
    planVersionRef.current = planVersion
  }, [planVersion])

  useEffect(() => {
    storedConfigRef.current = storedConfig
  }, [storedConfig])

  useEffect(() => {
    roundIdRef.current = roundId
  }, [roundId])

  useEffect(() => {
    indexRef.current = index
  }, [index])

  useEffect(() => {
    questionStatesRef.current = questionStates
  }, [questionStates])

  useEffect(() => {
    if (!open) return
    setConfigOpen(!setupDone)
  }, [open, setupDone])

  const adoptRound = useCallback((round: FreestyleRoundStatePayload) => {
    onRoundSync(round)
    if (typeof round.plan_version === 'number' && round.plan_version > 0) {
      planVersionRef.current = round.plan_version
    } else if (typeof round.version === 'number' && round.version > 0) {
      planVersionRef.current = round.version
    }
    const next = overlayFromRound(round)
    setOverlay(next)
    if (next) {
      const merged = mergeOverlayAndSessionStates(next)
      setQuestionStates(merged)
      questionStatesRef.current = merged
      const nextIndex = resolveOverlayResumeIndex(next, merged)
      setIndex(nextIndex)
      indexRef.current = nextIndex
    }
    return next
  }, [onRoundSync])

  const loadQuestions = useCallback(async (session: FreestyleOverlayQuizState) => {
    const ids = session.question_ids.filter((id) => !removedQuestionIdsRef.current.has(id))
    if (ids.length === 0) {
      setQuestions([])
      return
    }
    const response = await getPalaceQuizQuestionsByIdsApi(ids)
    const byId = new Map((response.items || []).map((item) => [item.id, item]))
    setQuestions(
      ids
        .map((id) => byId.get(id))
        .filter((item): item is PalaceQuizQuestion => Boolean(item))
        .filter((item) => !removedQuestionIdsRef.current.has(item.id)),
    )
  }, [])

  const ensureSession = useCallback(async () => {
    if (!roundId) return
    setLoading(true)
    setLoadError('')
    try {
      const request = (expectedVersion: number) => ensureFreestyleOverlayQuizApi(roundId, {
        operation_id: createOperationId(),
        expected_version: expectedVersion,
        config: storedConfigRef.current,
      })
      let round = await request(planVersionRef.current)
      // A just-saved picker can still be replanning the round. A conflict is
      // only a snapshot: ensure the new scope before loading its question ids.
      if (round.conflict) round = await request(round.plan_version ?? round.version)
      if (round.conflict) throw new Error('本轮安排正在更新，请重试做题。')
      const next = adoptRound(round)
      if (next) await loadQuestions(next)
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载做题会话失败。'
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [adoptRound, loadQuestions, roundId])

  useEffect(() => {
    if (open) return
    removedQuestionIdsRef.current = new Set()
  }, [open])

  useEffect(() => {
    if (!open || !setupDone || configOpen) return
    void ensureSession()
  }, [configOpen, ensureSession, open, setupDone])

  const writeProgressNow = useCallback(async (
    nextIndex: number,
    nextStates: Record<number, QuizRuntimeState>,
    { retryOnConflict = true }: { retryOnConflict?: boolean } = {},
  ) => {
    const activeRoundId = roundIdRef.current
    if (!activeRoundId || !dirtyProgressRef.current) return
    const completedIds = Object.entries(nextStates)
      .filter(([, state]) => state.resolved)
      .map(([id]) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
    const states: Record<string, Record<string, unknown>> = {}
    for (const [id, state] of Object.entries(nextStates)) {
      states[id] = { ...state }
    }
    const postProgress = async (allowRetry: boolean) => {
      const round = await progressFreestyleOverlayQuizApi(activeRoundId, {
        operation_id: createOperationId(),
        expected_version: planVersionRef.current,
        current_index: nextIndex,
        completed_ids: completedIds,
        states,
      })
      dirtyProgressRef.current = false
      onRoundSync(round)
      if (typeof round.plan_version === 'number' && round.plan_version > 0) {
        planVersionRef.current = round.plan_version
      } else if (typeof round.version === 'number' && round.version > 0) {
        planVersionRef.current = round.version
      }
      const next = overlayFromRound(round)
      if (next) setOverlay(next)
      if (round.conflict && allowRetry) {
        dirtyProgressRef.current = true
        await postProgress(false)
      }
    }
    try {
      await postProgress(retryOnConflict)
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存做题进度失败。'
      if (message.includes('题目不存在')) return
      toast.error(message)
    }
  }, [onRoundSync])

  const flushProgressNow = useCallback(() => {
    if (persistTimerRef.current != null) {
      window.clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    if (!dirtyProgressRef.current) return
    void writeProgressNow(indexRef.current, questionStatesRef.current)
  }, [writeProgressNow])

  const persistProgress = useCallback((
    nextIndex: number,
    nextStates: Record<number, QuizRuntimeState>,
  ) => {
    if (!roundIdRef.current) return
    dirtyProgressRef.current = true
    indexRef.current = nextIndex
    questionStatesRef.current = nextStates
    if (persistTimerRef.current != null) window.clearTimeout(persistTimerRef.current)
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null
      void writeProgressNow(nextIndex, nextStates)
    }, PROGRESS_DEBOUNCE_MS)
  }, [writeProgressNow])

  useEffect(() => {
    if (!open) return
    const onPageHide = () => flushProgressNow()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushProgressNow()
    }
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      flushProgressNow()
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [flushProgressNow, open])

  const current = questions[index] ?? null
  const currentState = current ? questionStates[current.id] ?? {} : {}
  const answeredCount = questions.filter((item) => questionStates[item.id]?.resolved).length
  const questionPalaceId = current?.palace_id ?? null
  const lookupPalaceId = lookupPalaceIdOverride ?? questionPalaceId

  useEffect(() => {
    if (!palaceLookupOpen || !current) {
      if (!palaceLookupOpen) {
        setLookupFocusNodeUids([])
        setLookupPalaceIdOverride(null)
      }
      return
    }
    const fallbackPalaceId = current.palace_id ?? null
    let cancelled = false
    void listQuestionNodeBindingsApi(current.id)
      .then((response) => {
        if (cancelled) return
        const items = response.items || []
        const binding = pickMemoryLookupBinding(items, fallbackPalaceId)
        setLookupFocusNodeUids(collectMemoryLookupFocusNodeUids(items, fallbackPalaceId))
        setLookupPalaceIdOverride(resolveMemoryLookupPalaceId(binding, fallbackPalaceId))
      })
      .catch(() => {
        if (cancelled) return
        setLookupFocusNodeUids([])
        setLookupPalaceIdOverride(fallbackPalaceId)
      })
    return () => {
      cancelled = true
    }
  }, [current, palaceLookupOpen])

  const updateLocalState = useCallback(
    (questionId: number, updater: (current: QuizRuntimeState) => QuizRuntimeState) => {
      setQuestionStates((currentStates) => {
        const prev = currentStates[questionId] ?? {}
        const nextState = updater(prev)
        const next = { ...currentStates, [questionId]: nextState }
        writeQuizSessionState(questionId, nextState)
        persistProgress(index, next)
        return next
      })
    },
    [index, persistProgress],
  )

  const goToIndex = useCallback((nextIndex: number) => {
    setIndex(nextIndex)
    persistProgress(nextIndex, questionStates)
  }, [persistProgress, questionStates])

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
        if (removedQuestionIdsRef.current.has(question.id)) return
        setQuestions((currentQuestions) =>
          currentQuestions.map((item) => (item.id === question.id ? question : item)),
        )
      },
    }),
    [questionStates, updateLocalState],
  )

  const shouldToastAttemptError = useCallback(
    (questionId: number) => !removedQuestionIdsRef.current.has(questionId),
    [],
  )

  const orchestration = useQuizAttemptOrchestration({
    adapter,
    promptForAiOptions,
    shortAnswerEntrypointKey: 'freestyle.scope-quiz.short-answer',
    resultFeedbackMode: 'immediate',
    emitFeedback: dispatchGlobalFeedback,
    shouldToastAttemptError,
  })

  const handleChoiceResolve = useCallback(
    (optionId: string, isCorrect: boolean) => {
      if (!current) return
      orchestration.handleChoiceSelect(current, optionId, isCorrect)
    },
    [current, orchestration],
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
      if (removedQuestionIdsRef.current.has(questionId)) return
      toast.error(error instanceof Error ? error.message : '保存标记失败。')
    }
  }, [current])

  const { confirmDialog: trashConfirmDialog, openDeleteConfirm } = useFreestyleQuestionTrash({
    current,
    questions,
    setQuestions,
    questionStates,
    setQuestionStates,
    questionStatesRef,
    index,
    setIndex,
    indexRef,
    persistProgress,
    roundIdRef,
    planVersionRef,
    storedConfigRef,
    onRoundSync,
    setOverlay,
    removedQuestionIdsRef,
  })

  useEffect(() => {
    setKeyboardOptionIndex(0)
  }, [current?.id])

  useQuizAnsweringShortcuts({
    enabled: open && !configOpen && current != null,
    questionCount: questions.length,
    optionCount: current?.options.length ?? 0,
    choiceShortcutsActive: current != null && isQuizChoiceShortcutActive(current.question_type, answerMode),
    attemptClosed: isQuizChoiceAttemptClosed({ selectedOptionId: currentState.selectedOptionId }),
    keyboardOptionIndex,
    setKeyboardOptionIndex,
    interactionRootRef: questionInteractionRef,
    onPreviousQuestion: () => goToIndex(Math.max(0, index - 1)),
    onNextQuestion: () => goToIndex(Math.min(Math.max(questions.length - 1, 0), index + 1)),
    onSelectOption: (optionIndex) => {
      if (!current) return
      const option = current.options[optionIndex]
      if (!option) return
      const correct = option.id === (current.answer_payload.correct_option_id || '')
      updateLocalState(current.id, (state) => ({
        ...state,
        selectedOptionId: option.id,
        resolved: true,
        correct,
      }))
      handleChoiceResolve(option.id, correct)
    },
    onToggleMark: () => {
      if (!current) return
      void handleToggleMark(!current.marked)
    },
  })

  const showConfig = !setupDone || configOpen
  const headerDetail = showConfig
    ? rangeLabel
    : loading
      ? '加载中…'
      : questions.length > 0
        ? [
            // The pager row owns 「第 n / m 题」 once there is more than one question.
            questions.length > 1 ? null : `第 ${index + 1} / ${questions.length} 题`,
            answeredCount > 0 ? `已答 ${answeredCount}` : null,
            current?.palace_id != null ? `宫殿 ${current.palace_id}` : null,
          ]
            .filter((part) => part != null && part !== '')
            .join(' · ')
        : rangeLabel

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          ref={fontScale.contentRef}
          floatingId="freestyle-scope-quiz"
          showCloseButton
          expandOnOpen
          dismissOnInteractOutside={false}
          className="max-h-[min(92vh,100dvh-1rem)] w-[min(46rem,calc(100vw-1rem))] max-w-none p-0"
          data-keyboard-shortcuts-suspended="true"
          data-testid="freestyle-scope-quiz-dialog"
        >
          <QuizFontScaleHint percent={fontScale.percent} visible={fontScale.hintVisible} />
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {setupDone ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={showConfig ? 'default' : 'outline'}
                    aria-label="做题配置"
                    title="做题配置"
                    onClick={() => setConfigOpen((value) => !value)}
                  >
                    <Settings2 className="size-4" />
                    配置
                  </Button>
                ) : null}
                <DialogTitle className="text-base">做题</DialogTitle>
              </div>
              {!showConfig && lookupPalaceId != null ? (
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
            {headerDetail ? (
              <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
                {headerDetail}
              </DialogDescription>
            ) : null}
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
            {showConfig ? (
              <OverlayQuizSetupPanel
                roundId={roundId}
                planVersion={planVersion}
                storedConfig={storedConfig}
                setupDone={setupDone}
                rangeLabel={rangeLabel}
                palaceCount={palaceCount}
                onRoundSync={onRoundSync}
                onConfirm={(choice) => {
                  onConfirmSetup(choice)
                  setConfigOpen(false)
                }}
              />
            ) : loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                加载题目…
              </div>
            ) : loadError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-4 text-sm text-destructive">
                {loadError}
              </div>
            ) : !current ? (
              <div className="py-12 text-center text-sm text-muted-foreground">当前宫殿范围内没有题目</div>
            ) : (
              <>
                {overlay?.limit_reached ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    已达本轮上限 {questions.length} 题（候选 {overlay.candidate_count}）。
                  </p>
                ) : null}
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
                  onSelect={goToIndex}
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
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label="删除本题"
                      title="移入回收站"
                      className="ml-auto text-muted-foreground hover:text-destructive"
                      onClick={openDeleteConfirm}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                <QuizFontScaleBody percent={fontScale.percent}>
                  <div className="text-base font-semibold leading-7 text-foreground">
                    <QuizQuestionStem question={current} />
                  </div>
                  <div ref={questionInteractionRef}>
                    <QuizQuestionInteraction
                      question={current}
                      state={currentState}
                      onStateChange={(updater) => updateLocalState(current.id, updater)}
                      onChoiceResolve={handleChoiceResolve}
                      onShortAnswerSubmit={() => orchestration.handleShortAnswerSubmit(current.id)}
                      mark={{
                        marked: Boolean(current.marked),
                        onToggle: (marked) => void handleToggleMark(marked),
                      }}
                    />
                  </div>
                </QuizFontScaleBody>
              </>
            )}
          </div>

          {!showConfig && current ? (
            <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3">
              <span className="min-w-0 truncate text-xs tabular-nums text-muted-foreground">
                {questions.length > 1
                  ? `已答 ${answeredCount} / ${questions.length} · ${overlayQuizScopeLabel(storedConfig.streams.quiz.quiz_scope)}`
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
                      onClick={() => goToIndex(Math.max(0, index - 1))}
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
                      onClick={() => goToIndex(Math.min(questions.length - 1, index + 1))}
                    >
                      下一题
                      <ChevronRight className="size-4" />
                    </Button>
                  </>
                ) : null}
                {index >= questions.length - 1 && currentState.resolved ? (
                  <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
                    <Check className="size-4" />
                    完成
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {trashConfirmDialog}
      <PalaceMemoryLookupDialog
        open={palaceLookupOpen}
        onOpenChange={setPalaceLookupOpen}
        currentPalaceId={lookupPalaceId}
        followCurrentPalace
        focusNodeUid={lookupFocusNodeUids[0] ?? null}
        focusNodeUids={lookupFocusNodeUids}
      />
      {aiRunConfigDialog}
    </>
  )
}
