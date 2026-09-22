import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Check, ChevronLeft, ChevronRight, LoaderCircle, Settings2 } from 'lucide-react'
import { createOperationId } from '@/modules/practice/application/feedPersistence'
import {
  ensureFreestyleOverlayQuizApi,
  progressFreestyleOverlayQuizApi,
} from '@/modules/practice/ui/freestyle/api'
import { overlayQuizScopeLabel } from '@/modules/practice/ui/freestyle/model/overlayQuizRange'
import {
  getPalaceQuizQuestionsByIdsApi,
  listQuestionNodeBindingsApi,
} from '@/modules/quiz/domain/quiz-entity/api'
import {
  beginQuizQuestionMarkRequest,
  isCurrentQuizQuestionMarkRequest,
  isQuizChoiceShortcutActive,
  QuizAttemptStatsBadge,
  QuizQuestionIndexPager,
  QuizQuestionInteraction,
  QuizQuestionMarkToggle,
  QuizQuestionStem,
  submitQuizQuestionMark,
  useQuizAnswerMode,
  useQuizAttemptOrchestration,
  writeQuizSessionState,
  type QuizRuntimeState,
} from '@/modules/quiz/public'
import {
  mergeOverlayAndSessionStates,
  overlayFromRound,
  resolveOverlayResumeIndex,
} from './overlayQuizHydrate'
import { useAiRunConfigDialog } from '@/modules/settings/public'
import { getQuestionTypeLabel } from '@/modules/quiz/ui/palace-quiz/model/palaceQuizPage'
import type {
  FreestyleFeedConfig,
  FreestyleOverlayQuestionRange,
  FreestyleOverlayQuizState,
  FreestyleQuizScope,
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
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import { toast } from '@/shared/feedback/toast'
import { cn } from '@/shared/lib/utils'
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
  onConfirmSetup: (next: {
    quizScope: FreestyleQuizScope
    overlayQuestionRange: FreestyleOverlayQuestionRange
  }) => void
  onRoundSync: (round: FreestyleRoundStatePayload) => void
}) {
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const { mode: answerMode } = useQuizAnswerMode()
  const [configOpen, setConfigOpen] = useState(!setupDone)
  const [draftScope, setDraftScope] = useState<FreestyleQuizScope>(storedConfig.streams.quiz.quiz_scope)
  const [draftRange, setDraftRange] = useState<FreestyleOverlayQuestionRange>(
    storedConfig.streams.quiz.overlay_question_range ?? storedConfig.overlay_question_range ?? 'all',
  )
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
  const planVersionRef = useRef(planVersion)
  const persistTimerRef = useRef<number | null>(null)
  const storedConfigRef = useRef(storedConfig)
  const indexRef = useRef(0)
  const questionStatesRef = useRef<Record<number, QuizRuntimeState>>({})
  const roundIdRef = useRef(roundId)
  const dirtyProgressRef = useRef(false)

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
    setDraftScope(storedConfig.streams.quiz.quiz_scope)
    setDraftRange(
      storedConfig.streams.quiz.overlay_question_range ?? storedConfig.overlay_question_range ?? 'all',
    )
  }, [
    open,
    setupDone,
    storedConfig.overlay_question_range,
    storedConfig.streams.quiz.overlay_question_range,
    storedConfig.streams.quiz.quiz_scope,
  ])

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
    if (session.question_ids.length === 0) {
      setQuestions([])
      return
    }
    const response = await getPalaceQuizQuestionsByIdsApi(session.question_ids)
    const byId = new Map((response.items || []).map((item) => [item.id, item]))
    setQuestions(
      session.question_ids
        .map((id) => byId.get(id))
        .filter((item): item is PalaceQuizQuestion => Boolean(item)),
    )
  }, [])

  const ensureSession = useCallback(async () => {
    if (!roundId) return
    setLoading(true)
    setLoadError('')
    try {
      const round = await ensureFreestyleOverlayQuizApi(roundId, {
        operation_id: createOperationId(),
        expected_version: planVersionRef.current,
        config: storedConfigRef.current,
      })
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
      toast.error(error instanceof Error ? error.message : '保存做题进度失败。')
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
        setQuestions((currentQuestions) =>
          currentQuestions.map((item) => (item.id === question.id ? question : item)),
        )
      },
    }),
    [questionStates, updateLocalState],
  )

  const orchestration = useQuizAttemptOrchestration({
    adapter,
    promptForAiOptions,
    shortAnswerEntrypointKey: 'freestyle.scope-quiz.short-answer',
    resultFeedbackMode: 'immediate',
    emitFeedback: dispatchGlobalFeedback,
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
      toast.error(error instanceof Error ? error.message : '保存标记失败。')
    }
  }, [current])

  useEffect(() => {
    setKeyboardOptionIndex(0)
  }, [current?.id])

  useEffect(() => {
    if (!open || configOpen || !current) return
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
        goToIndex(
          event.key === 'ArrowLeft'
            ? Math.max(0, index - 1)
            : Math.min(questions.length - 1, index + 1),
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
        event.key === 'Enter'
        && target instanceof HTMLElement
        && !focusedOption
        && target.closest('button, [role="button"], a')
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
    configOpen,
    current,
    currentState.resolved,
    goToIndex,
    handleChoiceResolve,
    index,
    keyboardOptionIndex,
    open,
    questions.length,
    updateLocalState,
  ])

  const showConfig = !setupDone || configOpen
  const headerDetail = showConfig
    ? rangeLabel
    : loading
      ? '加载中…'
      : questions.length > 0
        ? `第 ${index + 1} / ${questions.length} 题` +
          (answeredCount > 0 ? ` · 已答 ${answeredCount}` : '') +
          (current?.palace_id != null ? ` · 宫殿 ${current.palace_id}` : '')
        : rangeLabel

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          floatingId="freestyle-scope-quiz"
          showCloseButton
          expandOnOpen
          dismissOnInteractOutside={false}
          className="max-h-[min(92vh,100dvh-1rem)] w-[min(46rem,calc(100vw-1rem))] max-w-none p-0"
          data-keyboard-shortcuts-suspended="true"
          data-testid="freestyle-scope-quiz-dialog"
        >
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
            <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
              {headerDetail}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
            {showConfig ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{rangeLabel}。题目范围跟当前随心配置走，不会改训练方向。</p>
                <div role="radiogroup" aria-label="宫殿间顺序" className="grid gap-2">
                  {([
                    ['cross_palace_random', '跨宫殿乱序', '每道题可能来自不同宫殿'],
                    ['single_palace_random', '一个宫殿刷完再换', '先刷完一座宫殿的题再换下一座'],
                  ] as const).map(([value, label, hint]) => {
                    const selected = draftScope === value
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={cn(
                          'rounded-xl border px-3.5 py-3 text-left transition-colors',
                          selected ? 'border-primary bg-primary/10' : 'border-border/60 bg-background/80 hover:bg-muted/60',
                        )}
                        onClick={() => setDraftScope(value)}
                      >
                        <span className="block text-sm font-semibold">{label}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
                      </button>
                    )
                  })}
                </div>
                <div role="radiogroup" aria-label="做题范围" className="grid gap-2">
                  {([
                    ['all', '当前配置下宫殿全部题目', '标记过的题，序号用玫瑰色标出'],
                    ['due', '当前配置下宫殿已到期题目', '只收入题目自己的到期日已到的题'],
                  ] as const).map(([value, label, hint]) => {
                    const selected = draftRange === value
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={cn(
                          'rounded-xl border px-3.5 py-3 text-left transition-colors',
                          selected ? 'border-primary bg-primary/10' : 'border-border/60 bg-background/80 hover:bg-muted/60',
                        )}
                        onClick={() => setDraftRange(value)}
                      >
                        <span className="block text-sm font-semibold">{label}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
                      </button>
                    )
                  })}
                </div>
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => {
                    onConfirmSetup({ quizScope: draftScope, overlayQuestionRange: draftRange })
                    setConfigOpen(false)
                  }}
                >
                  {setupDone ? '保存并继续' : '开始做题'}
                </Button>
              </div>
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
                    onShortAnswerSubmit={() => orchestration.handleShortAnswerSubmit(current.id)}
                    onRequestShortAnswerFeedback={() => void orchestration.handleShortAnswerFeedback(current)}
                  />
                </div>
                <QuizQuestionMarkToggle
                  marked={Boolean(current.marked)}
                  onToggle={(marked) => void handleToggleMark(marked)}
                />
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
