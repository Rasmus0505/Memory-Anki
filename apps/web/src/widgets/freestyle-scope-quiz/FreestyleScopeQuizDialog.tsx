import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Check, ChevronLeft, ChevronRight, LoaderCircle, RotateCcw, Settings2, Trash2 } from 'lucide-react'
import { createOperationId } from '@/modules/practice/application/feedPersistence'
import { freestylePalaceScopeSignature } from '@/modules/practice/domain/feedConfig'
import { ensureFreestyleOverlayQuizApi } from '@/modules/practice/ui/freestyle/api'
import {
  overlayQuestionRating,
  overlayQuizScopeLabel,
  overlayScopeLeftPool,
  overlayScopeLeftPoolNotice,
  overlayScopeSummary,
} from '@/modules/practice/ui/freestyle/model/overlayQuizRange'
import { OverlayQuizSetupPanel, type OverlayQuizSetupChoice } from './OverlayQuizSetupPanel'
import { OverlayQuizScopeLeftNotice } from './OverlayQuizScopeList'
import { QuizQuestionRoundRatingBadge } from '@/widgets/quiz-round-rating'
import { useOverlayProgressPersistence } from './useOverlayProgressPersistence'
import { useOverlayQuizClear } from './useOverlayQuizClear'
import {
  getPalaceQuizQuestionsByIdsApi,
  listQuestionNodeBindingsApi,
} from '@/modules/quiz/domain/quiz-entity/api'
import {
  beginQuizQuestionMarkRequest,
  commitQuizQuestionMark,
  isCurrentQuizQuestionMarkRequest,
  isQuizChoiceAttemptClosed,
  isQuizChoiceShortcutActive,
  QuizAttemptStatsBadge,
  QUIZ_ANSWERING_DIALOG_CLASS,
  QUIZ_ANSWERING_SCROLL_CLASS,
  QuizQuestionIndexPager,
  QuizFontScaleBody,
  QuizFontScaleHint,
  QuizQuestionInteraction,
  QuizQuestionStem,
  useQuizAnswerMode,
  useQuizAnsweringShortcuts,
  useQuizAttemptOrchestration,
  useQuizDialogFontScale,
  readQuizSessionState,
  subscribeQuizSessionProgress,
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
import { QuizProgressClearDialog } from '@/widgets/quiz-progress-clear/QuizProgressClearDialog'

export function FreestyleScopeQuizDialog({
  open,
  onOpenChange,
  roundId,
  planVersion,
  storedConfig,
  setupDone,
  roundReviewPalaceCount,
  onConfirmSetup,
  onRoundSync,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  roundId: string
  planVersion: number
  storedConfig: FreestyleFeedConfig
  setupDone: boolean
  /** Round-scoped palace count for the settlement copy, not the 做题 pool. */
  roundReviewPalaceCount: number
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
  const scopePalaces = overlay?.scope_palaces ?? null
  /** Notice after a config change removed palaces from 做题. */
  const [scopeNotice, setScopeNotice] = useState('')
  const scopePalacesRef = useRef<FreestyleOverlayQuizState['scope_palaces']>(null)
  const [questions, setQuestions] = useState<PalaceQuizQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [questionStates, setQuestionStates] = useState<Record<number, QuizRuntimeState>>({})
  const [keyboardOptionIndex, setKeyboardOptionIndex] = useState(0)
  const [palaceLookupOpen, setPalaceLookupOpen] = useState(false)
  const [clearProgressOpen, setClearProgressOpen] = useState(false)
  const [lookupFocusNodeUids, setLookupFocusNodeUids] = useState<string[]>([])
  const [lookupPalaceIdOverride, setLookupPalaceIdOverride] = useState<number | null>(null)
  const questionInteractionRef = useRef<HTMLDivElement | null>(null)
  const answerScrollRef = useRef<HTMLDivElement | null>(null)
  const removedQuestionIdsRef = useRef(new Set<number>())
  const planVersionRef = useRef(planVersion)
  const storedConfigRef = useRef(storedConfig)
  const indexRef = useRef(0)
  const questionStatesRef = useRef<Record<number, QuizRuntimeState>>({})
  const roundIdRef = useRef(roundId)
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
    // Follow the 随心 config immediately, and say which palaces the edit took
    // out of 做题. Without this the pool shrank silently mid-session.
    const left = overlayScopeLeftPool(scopePalacesRef.current, next?.scope_palaces)
    if (left.length) setScopeNotice(overlayScopeLeftPoolNotice(left))
    scopePalacesRef.current = next?.scope_palaces ?? null
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

  /**
   * Follow a 随心 config change immediately while the dialog stays open.
   *
   * Without this the pool kept the scope it was first built with until the
   * dialog was closed and reopened, so an edit made in the config dialog looked
   * like it had been ignored. Keyed on the palace/subject scope only: question
   * kind and order choices are re-ensured by the setup panel itself.
   */
  const storedScopeSignature = freestylePalaceScopeSignature(storedConfig)
  const lastScopeSignatureRef = useRef(storedScopeSignature)
  useEffect(() => {
    if (!open || !setupDone) return
    if (lastScopeSignatureRef.current === storedScopeSignature) return
    lastScopeSignatureRef.current = storedScopeSignature
    storedConfigRef.current = storedConfig
    void ensureSession()
  }, [ensureSession, open, setupDone, storedConfig, storedScopeSignature])

  // Debounce, conflict retry and the pagehide/visibility flush live in the hook;
  // the dialog keeps owning what the current index and question states are.
  const { persistProgress } = useOverlayProgressPersistence({
    roundIdRef,
    planVersionRef,
    indexRef,
    questionStatesRef,
    open,
    onRoundSync,
    setOverlay,
  })

  const current = questions[index] ?? null
  useLayoutEffect(() => {
    const node = answerScrollRef.current
    if (node) node.scrollTop = 0
  }, [current?.id])
  const currentState = current ? questionStates[current.id] ?? {} : {}
  const answeredCount = questions.filter((item) => questionStates[item.id]?.resolved).length
  // Weakest 1–4 this round. 「本轮尚未复习」 only when the bar still has the
  // point open. A finished or never-scheduled point hides the badge.
  const currentRating = overlayQuestionRating(overlay?.question_node_ratings, current?.id)
  const currentPending = Boolean(
    current && (overlay?.question_pending_ids ?? []).includes(String(current.id)),
  )

  const handleClearChoice = useOverlayQuizClear({
    overlay,
    questions,
    current,
    questionStates,
    index,
    setQuestionStates,
    persistProgress,
  })
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

  useEffect(() => {
    if (!open) return
    return subscribeQuizSessionProgress(() => {
      setQuestionStates((current) => {
        let changed = false
        const next = { ...current }
        for (const question of questions) {
          const incoming = readQuizSessionState(question.id)
          if (!incoming.resolved && !incoming.selectedOptionId && !incoming.rating) continue
          if (JSON.stringify(next[question.id]) === JSON.stringify(incoming)) continue
          next[question.id] = incoming
          changed = true
        }
        return changed ? next : current
      })
    })
  }, [open, questions])

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
    const previousMarked = Boolean(current.marked)
    const token = beginQuizQuestionMarkRequest(questionId)
    const stillCurrent = () => (
      isCurrentQuizQuestionMarkRequest(questionId, token)
      && !removedQuestionIdsRef.current.has(questionId)
    )
    try {
      await commitQuizQuestionMark({
        questionId,
        marked,
        previousMarked,
        token,
        stillCurrent,
        apply: (nextMarked, saved) => {
          setQuestions((items) => items.map((item) => {
            if (item.id !== questionId) return item
            if (saved && saved.id === item.id) return { ...item, ...saved, marked: nextMarked }
            return { ...item, marked: nextMarked }
          }))
        },
      })
    } catch (error) {
      if (!stillCurrent()) return
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
    answerRevealed: Boolean(currentState.resolved),
    hasNextQuestion: index < questions.length - 1,
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
    onDeleteQuestion: openDeleteConfirm,
  })

  const showConfig = !setupDone || configOpen
  // The palace of the current question, by name from the backend scope report.
  // A bare `宫殿 27` is unreadable during a session and disagrees with the name
  // shown on the card and in the scope list, so an unknown name shows nothing
  // rather than an id.
  const currentPalaceTitle = (() => {
    const palaceId = current?.palace_id
    if (palaceId == null) return ''
    const row = scopePalaces?.palaces.find((item) => item.palace_id === palaceId)
    return row?.title || ''
  })()
  const scopeSummary = overlayScopeSummary(scopePalaces)
  const headerDetail = showConfig
    ? scopeSummary
    : loading
      ? '加载中…'
      : questions.length > 0
        ? [
            // The pager row owns 「第 n / m 题」 once there is more than one question.
            answeredCount > 0 ? `已答 ${answeredCount}` : null,
            currentPalaceTitle || null,
          ]
            .filter((part) => part != null && part !== '')
            .join(' · ')
        : scopeSummary
  const singleQuestionLabel = !showConfig && !loading && questions.length === 1
    ? `第 ${index + 1} / ${questions.length} 题`
    : null

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          ref={fontScale.contentRef}
          floatingId="freestyle-scope-quiz"
          showCloseButton
          expandOnOpen
          dismissOnInteractOutside={false}
          className={QUIZ_ANSWERING_DIALOG_CLASS}
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
              {!showConfig ? (
                <div className="flex shrink-0 items-center gap-2">
                  {lookupPalaceId != null ? (
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
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label="清除进度"
                    title="清除当前题、指定宫殿或全部题的已答记录"
                    onClick={() => setClearProgressOpen(true)}
                  >
                    <RotateCcw className="size-4" />
                    清除进度
                  </Button>
                </div>
              ) : null}
            </div>
            {singleQuestionLabel || headerDetail ? (
              <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
                {singleQuestionLabel ? (
                  <span className={current?.marked ? 'font-medium text-rose-700 dark:text-rose-300' : undefined}>
                    {singleQuestionLabel}
                    {current?.marked ? ' · 已标记' : ''}
                  </span>
                ) : null}
                {singleQuestionLabel && headerDetail ? ' · ' : null}
                {headerDetail}
              </DialogDescription>
            ) : null}
            <OverlayQuizScopeLeftNotice
              notice={scopeNotice}
              onDismiss={() => setScopeNotice('')}
            />
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col">
            {!showConfig && current ? (
              <QuizQuestionIndexPager
                pinned
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
            ) : null}
            <div ref={answerScrollRef} className={QUIZ_ANSWERING_SCROLL_CLASS}>
            {showConfig ? (
              <OverlayQuizSetupPanel
                roundId={roundId}
                planVersion={planVersion}
                storedConfig={storedConfig}
                setupDone={setupDone}
                scopePalaces={scopePalaces}
                palaceCount={roundReviewPalaceCount}
                // adoptRound, not raw onRoundSync: the setup panel's ensure is
                // what first populates `scope_palaces` on a fresh open, and the
                // list beside it renders that state.
                onRoundSync={adoptRound}
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
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <QuizAttemptStatsBadge
                      correctCount={current.correct_count}
                      attemptCount={current.attempt_count}
                    />
                    <Badge variant="outline">{getQuestionTypeLabel(current.question_type)}</Badge>
                    <QuizQuestionRoundRatingBadge
                      rating={currentRating}
                      pending={currentPending}
                      palaceId={current.palace_id ?? null}
                      onOpenSource={() => setPalaceLookupOpen(true)}
                    />
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
                {currentState.resolved && index < questions.length - 1 ? (
                  <span className="shrink-0 text-xs text-muted-foreground">Enter 下一题</span>
                ) : null}
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
      <QuizProgressClearDialog
        open={clearProgressOpen}
        onOpenChange={setClearProgressOpen}
        questionReady={current != null}
        defaultPalaceId={lookupPalaceId}
        onConfirm={handleClearChoice}
      />
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
