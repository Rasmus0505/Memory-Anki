import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { QuizOptionShuffleActions } from '@/modules/quiz/domain/quiz-entity/model/quizOptionShuffle'
import { LoaderCircle, Pencil, Settings2, Trash2 } from 'lucide-react'
import { createOperationId } from '@/modules/practice/application/feedPersistence'
import { freestylePalaceScopeSignature } from '@/modules/practice/domain/feedConfig'
import {
  ensureFreestyleOverlayQuizApi,
} from '@/modules/practice/ui/freestyle/api'
import {
  overlayQuestionRating,
  overlayQuizScopeLabel,
  overlayScopeLeftPool,
  overlayScopeLeftPoolNotice,
  overlayScopeSummary,
} from '@/modules/practice/ui/freestyle/model/overlayQuizRange'
import { OverlayQuizSetupPanel, type OverlayQuizSetupChoice } from './OverlayQuizSetupPanel'
import { FreestyleScopeQuizHeaderActions } from './FreestyleScopeQuizHeaderActions'
import { OverlayQuizScopeLeftNotice } from './OverlayQuizScopeList'
import { QuizQuestionRoundRatingBadge } from '@/widgets/quiz-round-rating'
import { useOverlayProgressPersistence } from './useOverlayProgressPersistence'
import { useOverlayQuizShuffle } from './useOverlayQuizShuffle'
import { useOverlayQuizClear } from './useOverlayQuizClear'
import { useOverlayRatingRefresh } from './useOverlayRatingRefresh'
import { useOverlayChoiceSelect } from './useOverlayChoiceSelect'
import { getPalaceQuizQuestionsByIdsApi } from '@/modules/quiz/domain/quiz-entity/api'
import {
  beginQuizQuestionMarkRequest,
  canManuallyEditQuestion,
  commitQuizQuestionMark,
  isCurrentQuizQuestionMarkRequest,
  isQuizChoiceAttemptClosed,
  isQuizChoiceShortcutActive,
  QuizAttemptStatsBadge,
  QUIZ_ANSWERING_DIALOG_CLASS,
  QUIZ_ANSWERING_SCROLL_CLASS,
  QuizMutationWorkflowStrip,
  QuizQuestionEditForm,
  QuizQuestionIndexPager,
  QuizFontScaleHint,
  QuizQuestionAnswerSurface,
  QuizQuestionVariantControl,
  useQuizAnswerMode,
  useQuizAnsweringShortcuts,
  useQuizAttemptOrchestration,
  useQuizDialogFontScale,
  useQuizDwellMs,
  readQuizSessionState,
  removeQuizSessionQuestions,
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
import { useFreestyleQuestionEdit } from './useFreestyleQuestionEdit'
import { useFreestylePalaceSkip } from './useFreestylePalaceSkip'
import { FreestyleScopeQuizFooter } from './FreestyleScopeQuizFooter'
import { useQuestionLookupFocus } from '@/widgets/palace-memory-lookup'
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
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import { isBusyResponseError } from '@/shared/api/busyRetry'
import { toast } from '@/shared/feedback/toast'
import { CLIENT_PREFERENCES_UPDATED_EVENT, getCachedClientPreference, saveClientPreference } from '@/shared/preferences/clientPreferences'
import {
  PalaceMemoryLookupDialog,
  useCopyPalaceMindMapOutline,
} from '@/widgets/palace-memory-lookup'
import { QuizProgressClearDialog } from '@/widgets/quiz-progress-clear/QuizProgressClearDialog'

export function FreestyleScopeQuizDialog({
  open,
  onOpenChange,
  roundId,
  planVersion,
  wrongUnitIds = [],
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
  wrongUnitIds?: readonly string[]
  storedConfig: FreestyleFeedConfig
  setupDone: boolean
  /** Round-scoped palace count for the settlement copy, not the 做题 pool. */
  roundReviewPalaceCount: number
  onConfirmSetup: (next: OverlayQuizSetupChoice) => void
  onRoundSync: (
    round: FreestyleRoundStatePayload,
    options?: { announceOrder?: boolean },
  ) => void
}) {
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const { mode: answerMode } = useQuizAnswerMode()
  const fontScale = useQuizDialogFontScale(open)
  const { copying: copyingOutline, copyOutline } = useCopyPalaceMindMapOutline()
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
  // A round update arrives before its questions do. Jumping `index` first would
  // render the new position against the old array for a frame, then swap again
  // when the fetch lands — a visible double jump. Keep the cursor still until
  // the question it points at actually exists.
  const questionsRef = useRef<PalaceQuizQuestion[]>([])
  const pendingIndexRef = useRef<number | null>(null)
  useEffect(() => {
    questionsRef.current = questions
  }, [questions])
  const [questionStates, setQuestionStates] = useState<Record<number, QuizRuntimeState>>({})
  const readWrongPriority = () => getCachedClientPreference('freestyle_wrong_priority', false, (value): value is boolean => typeof value === 'boolean')
  const [prioritizeWrong, setPrioritizeWrong] = useState(readWrongPriority)
  const prioritizeWrongRef = useRef(prioritizeWrong)
  prioritizeWrongRef.current = prioritizeWrong
  useEffect(() => {
    const update = (event: Event) => {
      const value = (event as CustomEvent<{ freestyle_wrong_priority?: boolean | null }>).detail?.freestyle_wrong_priority
      setPrioritizeWrong(typeof value === 'boolean' ? value : readWrongPriority())
    }
    window.addEventListener(CLIENT_PREFERENCES_UPDATED_EVENT, update)
    return () => window.removeEventListener(CLIENT_PREFERENCES_UPDATED_EVENT, update)
  }, [])
  const [keyboardOptionIndex, setKeyboardOptionIndex] = useState(0)
  const [palaceLookupOpen, setPalaceLookupOpen] = useState(false)
  // 「本轮最低」 chip opens the rating view; 「查看宫殿」 keeps the full map.
  const [ratingLookupOpen, setRatingLookupOpen] = useState(false)
  const [clearProgressOpen, setClearProgressOpen] = useState(false)
  const [canRestoreOptions, setCanRestoreOptions] = useState(false)
  const questionInteractionRef = useRef<HTMLDivElement | null>(null)
  const optionShuffleActionsRef = useRef<QuizOptionShuffleActions | null>(null)
  const answerScrollRef = useRef<HTMLDivElement | null>(null)
  const removedQuestionIdsRef = useRef(new Set<number>())
  const planVersionRef = useRef(planVersion)
  const storedConfigRef = useRef(storedConfig)
  const indexRef = useRef(0)
  const questionStatesRef = useRef<Record<number, QuizRuntimeState>>({})
  const roundIdRef = useRef(roundId)

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
      const desiredId = next.question_ids[nextIndex]
      if (desiredId == null || questionsRef.current.some((item) => item.id === desiredId)) {
        setIndex(nextIndex)
        indexRef.current = nextIndex
        pendingIndexRef.current = null
      } else {
        // loadQuestions owns the jump: it lands the new array and cursor together.
        pendingIndexRef.current = nextIndex
      }
    }
    return next
  }, [onRoundSync])

  const loadQuestions = useCallback(async (session: FreestyleOverlayQuizState) => {
    const ids = session.question_ids.filter((id) => !removedQuestionIdsRef.current.has(id))
    if (ids.length === 0) {
      questionsRef.current = []
      setQuestions([])
      return
    }
    const response = await getPalaceQuizQuestionsByIdsApi(ids)
    const byId = new Map((response.items || []).map((item) => [item.id, item]))
    const loaded = ids
      .map((id) => byId.get(id))
      .filter((item): item is PalaceQuizQuestion => Boolean(item))
      .filter((item) => !removedQuestionIdsRef.current.has(item.id))
    questionsRef.current = loaded
    setQuestions(loaded)
    const pending = pendingIndexRef.current
    if (pending != null) {
      pendingIndexRef.current = null
      setIndex(pending)
      indexRef.current = pending
    }
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
      const busy = isBusyResponseError(error)
        || (error instanceof Error && error.message.includes('数据正在写入中'))
      // The raw 503 names the write lock and the request URL. That is a pause,
      // not a broken quiz. Keep the calm line in the dialog; do not toast it.
      const message = busy
        ? '做题还在同步，请再点一次。'
        : error instanceof Error ? error.message : '加载做题会话失败。'
      setLoadError(message)
      if (!busy) toast.error(message)
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
  const { persistProgress, prioritizeNow, flushProgressNow } = useOverlayProgressPersistence({
    prioritizeWrongRef,
    roundIdRef,
    planVersionRef,
    indexRef,
    questionStatesRef,
    open,
    onRoundSync,
    setOverlay,
  })

  // 打乱题库 is a round write: flush pending answers first so the server keeps
  // exactly the questions the learner has already answered in place.
  const hasOpenQuestion = questions.some(
    (question) => !questionStates[question.id]?.resolved,
  )
  const { shuffling, shuffle: shuffleQuestions } = useOverlayQuizShuffle({
    roundId,
    planVersionRef,
    adoptRound,
    loadQuestions,
    flushProgressNow,
    hasOpenQuestions: hasOpenQuestion,
  })

  const current = questions[index] ?? null
  const currentId = current?.id ?? null
  const dwell = useQuizDwellMs()
  const { restart } = dwell
  // Each visit starts a fresh clock: leaving the question and coming back is a
  // new look, not a continuation of the first one.
  useEffect(() => {
    if (!open || currentId == null) return
    restart(currentId)
  }, [open, currentId, restart])
  useLayoutEffect(() => {
    const node = answerScrollRef.current
    if (node) node.scrollTop = 0
  }, [current?.id])
  const currentState = current ? questionStates[current.id] ?? {} : {}
  /** Only 选择题 / 简答题 have editable content; other kinds stay read-only. */
  const canEditCurrent = current != null && canManuallyEditQuestion(current.question_type)
  const answeredCount = questions.filter((item) => questionStates[item.id]?.resolved).length
  // 导出错题 follows the red dots on the pager: a question that was retried
  // correctly is no longer wrong.
  const wrongQuestions = useMemo(
    () => questions.filter((question) => {
      const state = questionStates[question.id]
      return state?.resolved === true && state.correct === false
    }),
    [questionStates, questions],
  )
  // Weakest 1–4 this round. 「本轮尚未复习」 only when the bar still has the
  // point open. A finished or never-scheduled point hides the badge.
  const currentRating = overlayQuestionRating(overlay?.question_node_ratings, current?.id)
  const currentPending = Boolean(
    current && (overlay?.question_pending_ids ?? []).includes(String(current.id)),
  )

  const handleClearChoice = useOverlayQuizClear({
    overlay,
    questions,
    questionStates,
    index,
    setQuestionStates,
    persistProgress,
  })
  const questionPalaceId = current?.palace_id ?? null
  // Only this round's 随心 pool changes: the palace's questions leave 做题, the
  // review units and their ratings stay exactly as scheduled.
  const skipPalaceQuestions = questions.filter((item) => item.palace_id === questionPalaceId)
  const skipPalaceTitle = current?.palace_id != null
    ? scopePalaces?.palaces.find((row) => row.palace_id === current.palace_id)?.title ?? ''
    : ''
  // Only this round's 随心 pool changes; see useFreestylePalaceSkip.
  const palaceSkip = useFreestylePalaceSkip({
    roundId,
    planVersionRef,
    palaceId: questionPalaceId,
    palaceTitle: skipPalaceTitle,
    palaceQuestions: skipPalaceQuestions,
    adoptRound,
    loadQuestions,
  })
  const { focusNodeUids: lookupFocusNodeUids, palaceIdOverride: lookupPalaceIdOverride, pending: lookupFocusPending } = useQuestionLookupFocus(current, open)
  const lookupPalaceId = lookupPalaceIdOverride ?? questionPalaceId

  useOverlayRatingRefresh({ open, roundId, roundIdRef, setOverlay })

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

  const resetLocalAnswer = useCallback(
    (questionId: number) => {
      removeQuizSessionQuestions([questionId])
      setQuestionStates((currentStates) => {
        if (currentStates[questionId] == null) return currentStates
        const next = { ...currentStates }
        delete next[questionId]
        persistProgress(index, next)
        return next
      })
    },
    [index, persistProgress],
  )

  // Editing happens here, in the window where the bad question was noticed.
  // Saving rewrites the row and clears its answered state (see the hook).
  const questionEdit = useFreestyleQuestionEdit({
    current,
    setQuestions,
    resetLocalAnswer,
  })
  const { closeEditor: closeQuestionEditor, editing: editingQuestion } = questionEdit

  useEffect(() => {
    if (!open) closeQuestionEditor()
  }, [closeQuestionEditor, open])

  const handleImportedQuestions = useCallback(
    (items: PalaceQuizQuestion[]) => {
      if (items.length === 0) return
      const updatedById = new Map(items.map((item) => [item.id, item]))
      setQuestions((currentQuestions) =>
        currentQuestions.map((item) => updatedById.get(item.id) ?? item),
      )
      const ids = items.map((item) => item.id)
      removeQuizSessionQuestions(ids)
      setQuestionStates((currentStates) => {
        const next = { ...currentStates }
        for (const questionId of ids) delete next[questionId]
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
    getDurationMs: dwell.elapsedMs,
  })

  const handleChoiceResolve = useCallback(
    (optionId: string | string[], isCorrect: boolean) => {
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

  const selectOption = useOverlayChoiceSelect(current, updateLocalState, handleChoiceResolve)

  useQuizAnsweringShortcuts({
    // The open editor owns the keyboard: arrows and answer keys would otherwise
    // page or answer the question underneath the text being rewritten.
    enabled: open && !configOpen && current != null && !editingQuestion,
    questionCount: questions.length,
    optionCount: current?.options.length ?? 0,
    choiceShortcutsActive: current != null && isQuizChoiceShortcutActive(current.question_type, answerMode),
    attemptClosed: isQuizChoiceAttemptClosed({ selectedOptionId: currentState.selectedOptionId, selectedOptionIds: currentState.selectedOptionIds }),
    answerRevealed: Boolean(currentState.resolved),
    hasNextQuestion: index < questions.length - 1,
    keyboardOptionIndex,
    setKeyboardOptionIndex,
    interactionRootRef: questionInteractionRef,
    onPreviousQuestion: () => goToIndex(Math.max(0, index - 1)),
    onNextQuestion: () => goToIndex(Math.min(Math.max(questions.length - 1, 0), index + 1)),
    onSelectOption: selectOption,
    onToggleMark: () => {
      if (!current) return
      void handleToggleMark(!current.marked)
    },
    onDeleteQuestion: openDeleteConfirm,
    onResetAnswer: () => {
      if (!current) return
      orchestration.invalidateQuestion(current.id)
      resetLocalAnswer(current.id)
      dwell.restart(current.id)
      setKeyboardOptionIndex(0)
    },
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
            <div className="flex flex-wrap items-center justify-between gap-3">
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
                    <span className="hidden sm:inline">配置</span>
                  </Button>
                ) : null}
                {/* Phone: the title is redundant with the sheet and costs a header slot. */}
                <DialogTitle className="sr-only text-base sm:not-sr-only">做题</DialogTitle>
              </div>
              {!showConfig ? (
                <FreestyleScopeQuizHeaderActions
                  copyPalaceId={questionPalaceId ?? lookupPalaceId}
                  lookupPalaceId={lookupPalaceId}
                  questions={questions}
                  wrongQuestions={wrongQuestions}
                  currentQuestion={current}
                  copyingOutline={copyingOutline}
                  onCopyOutline={(palaceId) => void copyOutline(palaceId)}
                  onOpenPalace={() => setPalaceLookupOpen(true)}
                  canShuffle={!loading && questions.length > 1}
                  shuffling={shuffling}
                  onShuffle={() => void shuffleQuestions()}
                  onShuffleOptions={() => optionShuffleActionsRef.current?.shuffle()}
                  onRestoreOptions={() => optionShuffleActionsRef.current?.restore()}
                  canShuffleOptions={!editingQuestion && current?.question_type === 'multiple_choice' && (current.options?.length ?? 0) > 1}
                  canRestoreOptions={canRestoreOptions && !editingQuestion}
                  actionsDisabled={editingQuestion}
                  onOpenClearProgress={() => setClearProgressOpen(true)}
                  prioritizeWrong={prioritizeWrong}
                  onPrioritizeWrongChange={(enabled) => {
                    setPrioritizeWrong(enabled)
                    prioritizeWrongRef.current = enabled
                    void saveClientPreference('freestyle_wrong_priority', enabled).then((result) => {
                      if (!result.persisted) toast.error('错题优先开关未保存，请稍后重试。')
                    })
                    // Only reorder once the overlay is loaded: an empty local
                    // state must never overwrite the round's saved answers.
                    if (!enabled) return
                    if (wrongUnitIds.length === 0) {
                      toast.info('错题优先已开启：本轮还没有答错的题，答错后会把对应复习单元提前')
                      return
                    }
                    if (!overlay) {
                      toast.info('错题优先已开启')
                      return
                    }
                    // Say what changed. Turning the switch on used to reorder
                    // silently, so there was no way to tell whether it took
                    // effect. The server counts the units it hoisted and the
                    // palaces they live in; only those units move now, not the
                    // whole palace.
                    void prioritizeNow().then((round) => {
                      const summary = round?.wrong_priority
                      if (!summary) return
                      if (summary.unit_count === 0) {
                        toast.info('错题优先已开启：答错的复习单元已完成，没有需要提前的')
                        return
                      }
                      const palaces = summary.palace_count > 0
                        ? `，涉及 ${summary.palace_count} 个宫殿`
                        : ''
                      toast.success(`错题优先：已把 ${summary.unit_count} 个复习单元提前${palaces}`)
                    })
                  }}
                />
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

          {!showConfig && !loading && questions.length > 0 ? (
            <QuizMutationWorkflowStrip
              questions={questions}
              onImported={handleImportedQuestions}
            />
          ) : null}

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
                    wrong: itemState?.resolved === true && itemState.correct === false,
                  }
                }}
                onSelect={(nextIndex) => {
                  // Half-edited text must not be carried to another question.
                  if (editingQuestion) return
                  goToIndex(nextIndex)
                }}
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
                <p>{loadError}</p>
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void ensureSession()}>
                  再试一次
                </Button>
              </div>
            ) : !current ? (
              <div className="py-12 text-center text-sm text-muted-foreground">当前做题范围内没有题目</div>
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
                    <QuizQuestionVariantControl
                      question={current}
                      onQuestionUpdated={(question) => adapter.applyUpdatedQuestion(question)}
                      onAnswerReset={resetLocalAnswer}
                      compact
                    />
                    <QuizQuestionRoundRatingBadge
                      rating={currentRating}
                      pending={currentPending}
                      palaceId={current.palace_id ?? null}
                      onOpenSource={() => setRatingLookupOpen(true)}
                    />
                    {current.marked ? (
                      <Badge className="border-rose-600 bg-rose-600 text-white">已标记</Badge>
                    ) : null}
                    {currentState.resolved ? (
                      <Badge variant={currentState.correct ? 'secondary' : 'destructive'}>
                        {currentState.correct ? '已答对' : '已作答'}
                      </Badge>
                    ) : null}
                    {canEditCurrent ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={editingQuestion ? 'default' : 'ghost'}
                        aria-label={editingQuestion ? '退出编辑本题' : '编辑本题'}
                        aria-pressed={editingQuestion}
                        title="就在这个弹窗里改题干、选项、答案和解析，不跳转页面"
                        className={editingQuestion ? 'ml-auto' : 'ml-auto text-muted-foreground'}
                        onClick={editingQuestion ? closeQuestionEditor : questionEdit.openEditor}
                      >
                        <Pencil className="size-4" />
                        <span className="hidden sm:inline">
                          {editingQuestion ? '正在编辑' : '编辑'}
                        </span>
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label="移除本宫殿本轮题目"
                      title="只从本轮随心做题移除这座宫殿的题，不影响复习评分"
                      className={canEditCurrent ? 'text-muted-foreground' : 'ml-auto text-muted-foreground'}
                      onClick={palaceSkip.openSkipConfirm}
                    >
                      移除本宫殿
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label="删除本题"
                      title="移入回收站"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={openDeleteConfirm}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                    {palaceSkip.confirmDialog}
                  </div>
                </div>
                {editingQuestion ? (
                  <QuizQuestionEditForm
                    key={current.id}
                    question={current}
                    saving={questionEdit.saving}
                    onSave={questionEdit.save}
                    onCancel={closeQuestionEditor}
                  />
                ) : (
                  <QuizQuestionAnswerSurface
                    question={current}
                    optionShuffleActionsRef={optionShuffleActionsRef}
                    onOptionShuffleAvailabilityChange={setCanRestoreOptions}
                    state={currentState}
                    fontScalePercent={fontScale.percent}
                    interactionRef={questionInteractionRef}
                    onStateChange={(updater) => updateLocalState(current.id, updater)}
                    onChoiceResolve={handleChoiceResolve}
                    onShortAnswerSubmit={() => orchestration.handleShortAnswerSubmit(current.id)}
                    getDurationMs={dwell.elapsedMs}
                    comboScopeKey={`freestyle-overlay:${roundId}`}
                    mark={{
                      marked: Boolean(current.marked),
                      onToggle: (marked) => void handleToggleMark(marked),
                    }}
                  />
                )}
              </>
            )}
            </div>
          </div>

          {!showConfig && current ? (
            <FreestyleScopeQuizFooter
              questionCount={questions.length}
              answeredCount={answeredCount}
              index={index}
              currentState={currentState}
              scopeLabel={overlayQuizScopeLabel(storedConfig.streams.quiz.quiz_scope)}
              navigationLocked={editingQuestion}
              goToIndex={goToIndex}
              onFinish={() => onOpenChange(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {trashConfirmDialog}
      <QuizProgressClearDialog
        open={clearProgressOpen}
        onOpenChange={setClearProgressOpen}
        defaultPalaceId={lookupPalaceId}
        onConfirm={handleClearChoice}
      />
      <PalaceMemoryLookupDialog
        key={palaceLookupOpen ? `view-lookup-${current?.id ?? 'none'}` : 'view-lookup-closed'}
        open={palaceLookupOpen}
        onOpenChange={setPalaceLookupOpen}
        currentPalaceId={lookupPalaceId}
        followCurrentPalace
        focusNodeUid={lookupFocusNodeUids[0] ?? null}
        focusNodeUids={lookupFocusNodeUids}
        focusPending={lookupFocusPending}
      />
      <PalaceMemoryLookupDialog
        key={ratingLookupOpen ? 'rating-lookup' : 'rating-lookup-closed'}
        open={ratingLookupOpen}
        onOpenChange={setRatingLookupOpen}
        currentPalaceId={lookupPalaceId}
        followCurrentPalace
        ratingMode
      />
      {aiRunConfigDialog}
    </>
  )
}
