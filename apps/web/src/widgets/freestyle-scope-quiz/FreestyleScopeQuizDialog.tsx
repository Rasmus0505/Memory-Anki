import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { DEFAULT_FREESTYLE_FEED_CONFIG } from '@/modules/practice/domain/feedConfig'
import { QuizQuestionRoundRating } from '@/widgets/quiz-round-rating'
import { useDirectQuestionSetQuiz } from './useDirectQuestionSetQuiz'
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

/** A question set known outside a 随心 round: node badge, mind-map review, unit card. */
export interface FreestyleScopeQuizQuestionSet {
  palaceId: number | null
  nodeUid?: string | null
  questionIds: readonly number[]
  initialQuestionStates?: Record<number, QuizRuntimeState>
  onQuestionStateChange?: (questionId: number, next: QuizRuntimeState) => void
  onQuestionCompleted?: (questionId: number) => void
  onQuestionDeleted?: (questionId: number) => void
  /** The 随心 round this window was opened inside; only then the rating badge appears. */
  roundId?: string | null
}

export type FreestyleScopeQuizDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `questions` reuses this window for a direct question set without a round. */
  source?: 'round' | 'questions'
  roundId?: string
  planVersion?: number
  wrongUnitIds?: readonly string[]
  storedConfig?: FreestyleFeedConfig
  setupDone?: boolean
  /** Round-scoped palace count for the settlement copy, not the 做题 pool. */
  roundReviewPalaceCount?: number
  onConfirmSetup?: (next: OverlayQuizSetupChoice) => void
  onRoundSync?: (
    round: FreestyleRoundStatePayload,
    options?: { announceOrder?: boolean },
  ) => void
  questionSet?: FreestyleScopeQuizQuestionSet
}

export function FreestyleScopeQuizDialog(props: FreestyleScopeQuizDialogProps) {
  const { open, onOpenChange } = props
  const noop = useCallback(() => {}, [])
  const questionSet = props.source === 'questions' ? props.questionSet : null
  const isDirect = questionSet != null
  const roundId = isDirect ? '' : props.roundId ?? ''
  const planVersion = isDirect ? 0 : props.planVersion ?? 0
  const wrongUnitIds = isDirect ? [] : props.wrongUnitIds ?? []
  const storedConfig = isDirect
    ? DEFAULT_FREESTYLE_FEED_CONFIG
    : props.storedConfig ?? DEFAULT_FREESTYLE_FEED_CONFIG
  const setupDone = isDirect ? true : props.setupDone ?? true
  const roundReviewPalaceCount = isDirect ? 0 : props.roundReviewPalaceCount ?? 0
  const onConfirmSetup = isDirect ? noop : props.onConfirmSetup ?? noop
  const onRoundSync = isDirect ? noop : props.onRoundSync ?? noop
  const directPalaceId = questionSet?.palaceId ?? null
  const directNodeUid = questionSet?.nodeUid ?? null
  const directRoundId = questionSet?.roundId ?? null
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const { mode: answerMode } = useQuizAnswerMode()
  const fontScale = useQuizDialogFontScale(open)
  const { copying: copyingOutline, copyOutline } = useCopyPalaceMindMapOutline()
  const [configOpen, setConfigOpen] = useState(!setupDone)
  const [roundLoading, setRoundLoading] = useState(false)
  const [roundLoadError, setRoundLoadError] = useState('')
  const [overlay, setOverlay] = useState<FreestyleOverlayQuizState | null>(null)
  const scopePalaces = overlay?.scope_palaces ?? null
  /** Notice after a config change removed palaces from 做题. */
  const [scopeNotice, setScopeNotice] = useState('')
  const scopePalacesRef = useRef<FreestyleOverlayQuizState['scope_palaces']>(null)
  const [roundQuestions, setRoundQuestions] = useState<PalaceQuizQuestion[]>([])
  const [roundIndex, setRoundIndex] = useState(0)
  // A round update arrives before its questions do. Jumping `index` first would
  // render the new position against the old array for a frame, then swap again
  // when the fetch lands — a visible double jump. Keep the cursor still until
  // the question it points at actually exists.
  const roundQuestionsRef = useRef<PalaceQuizQuestion[]>([])
  const pendingIndexRef = useRef<number | null>(null)
  useEffect(() => {
    roundQuestionsRef.current = roundQuestions
  }, [roundQuestions])
  const [roundQuestionStates, setRoundQuestionStates] = useState<Record<number, QuizRuntimeState>>({})
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
  const questionInteractionRef = useRef<HTMLDivElement | null>(null)
  const answerScrollRef = useRef<HTMLDivElement | null>(null)
  const roundRemovedQuestionIdsRef = useRef(new Set<number>())
  const planVersionRef = useRef(planVersion)
  const storedConfigRef = useRef(storedConfig)
  const roundIndexRef = useRef(0)
  const roundQuestionStatesRef = useRef<Record<number, QuizRuntimeState>>({})
  const roundIdRef = useRef(roundId)
  /** Direct mode must never re-ensure a round after a delete. */
  const noRoundIdRef = useRef('')

  // The same window, fed by a direct question set instead of a round. Hooks stay
  // unconditional: the direct source is disabled while a round owns the window.
  const direct = useDirectQuestionSetQuiz({
    enabled: isDirect,
    open,
    palaceId: directPalaceId,
    nodeUid: directNodeUid,
    questionIds: questionSet?.questionIds ?? [],
    initialQuestionStates: questionSet?.initialQuestionStates,
    onQuestionStateChange: questionSet?.onQuestionStateChange,
  })
  const questions = isDirect ? direct.questions : roundQuestions
  const setQuestions = isDirect ? direct.setQuestions : setRoundQuestions
  const index = isDirect ? direct.index : roundIndex
  const setIndex = isDirect ? direct.setIndex : setRoundIndex
  const questionStates = isDirect ? direct.questionStates : roundQuestionStates
  const setQuestionStates = isDirect ? direct.setQuestionStates : setRoundQuestionStates
  const loading = isDirect ? direct.loading : roundLoading
  const loadError = isDirect ? direct.loadError : roundLoadError
  const setLoading = setRoundLoading
  const setLoadError = setRoundLoadError

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
    if (!isDirect) roundIndexRef.current = roundIndex
  }, [isDirect, roundIndex])

  useEffect(() => {
    if (!isDirect) roundQuestionStatesRef.current = roundQuestionStates
  }, [isDirect, roundQuestionStates])

  useEffect(() => {
    if (!open) return
    setConfigOpen(isDirect ? false : !setupDone)
  }, [isDirect, open, setupDone])

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
      setRoundQuestionStates(merged)
      roundQuestionStatesRef.current = merged
      const nextIndex = resolveOverlayResumeIndex(next, merged)
      const desiredId = next.question_ids[nextIndex]
      if (desiredId == null || roundQuestionsRef.current.some((item) => item.id === desiredId)) {
        setRoundIndex(nextIndex)
        roundIndexRef.current = nextIndex
        pendingIndexRef.current = null
      } else {
        // loadQuestions owns the jump: it lands the new array and cursor together.
        pendingIndexRef.current = nextIndex
      }
    }
    return next
  }, [onRoundSync])

  const loadQuestions = useCallback(async (session: FreestyleOverlayQuizState) => {
    const ids = session.question_ids.filter((id) => !roundRemovedQuestionIdsRef.current.has(id))
    if (ids.length === 0) {
      roundQuestionsRef.current = []
      setRoundQuestions([])
      return
    }
    const response = await getPalaceQuizQuestionsByIdsApi(ids)
    const byId = new Map((response.items || []).map((item) => [item.id, item]))
    const loaded = ids
      .map((id) => byId.get(id))
      .filter((item): item is PalaceQuizQuestion => Boolean(item))
      .filter((item) => !roundRemovedQuestionIdsRef.current.has(item.id))
    roundQuestionsRef.current = loaded
    setRoundQuestions(loaded)
    const pending = pendingIndexRef.current
    if (pending != null) {
      pendingIndexRef.current = null
      setRoundIndex(pending)
      roundIndexRef.current = pending
    }
  }, [])

  const ensureSession = useCallback(async () => {
    if (isDirect || !roundId) return
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
      if (round.conflict) throw new Error('本轮队列正在更新，请重试做题。')
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
  }, [adoptRound, isDirect, loadQuestions, roundId, setLoadError, setLoading])

  useEffect(() => {
    if (open) return
    roundRemovedQuestionIdsRef.current = new Set()
  }, [open])

  useEffect(() => {
    if (isDirect || !open || !setupDone || configOpen) return
    void ensureSession()
  }, [configOpen, ensureSession, isDirect, open, setupDone])

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
    if (isDirect || !open || !setupDone) return
    if (lastScopeSignatureRef.current === storedScopeSignature) return
    lastScopeSignatureRef.current = storedScopeSignature
    storedConfigRef.current = storedConfig
    void ensureSession()
  }, [ensureSession, isDirect, open, setupDone, storedConfig, storedScopeSignature])

  // Debounce, conflict retry and the pagehide/visibility flush live in the hook;
  // the dialog keeps owning what the current index and question states are.
  const {
    persistProgress: persistRoundProgress,
    prioritizeNow,
    flushProgressNow,
  } = useOverlayProgressPersistence({
    prioritizeWrongRef,
    roundIdRef,
    planVersionRef,
    indexRef: roundIndexRef,
    questionStatesRef: roundQuestionStatesRef,
    open,
    onRoundSync,
    setOverlay,
  })
  // A direct question set has no round to write to: the shared session mirror
  // already persisted the answer inside `updateLocalState`.
  const persistProgress = useCallback(
    (nextIndex: number, nextStates: Record<number, QuizRuntimeState>) => {
      if (isDirect) return
      persistRoundProgress(nextIndex, nextStates)
    },
    [isDirect, persistRoundProgress],
  )

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

  const handleRoundClearChoice = useOverlayQuizClear({
    overlay,
    questions,
    questionStates,
    index,
    setQuestionStates,
    persistProgress,
  })
  const handleClearChoice = isDirect ? direct.handleClearChoice : handleRoundClearChoice
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
  // A node badge knows which card opened the window; keep that node in focus.
  const effectiveLookupFocusNodeUids = isDirect && directNodeUid
    ? (lookupFocusNodeUids.includes(directNodeUid) ? lookupFocusNodeUids : [directNodeUid, ...lookupFocusNodeUids])
    : lookupFocusNodeUids
  const lookupPalaceId = isDirect
    ? (directPalaceId ?? questionPalaceId)
    : (lookupPalaceIdOverride ?? questionPalaceId)

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
  }, [open, questions, setQuestionStates])

  const updateRoundLocalState = useCallback(
    (questionId: number, updater: (current: QuizRuntimeState) => QuizRuntimeState) => {
      const currentStates = roundQuestionStatesRef.current
      const nextState = updater(currentStates[questionId] ?? {})
      const next = { ...currentStates, [questionId]: nextState }
      roundQuestionStatesRef.current = next
      setQuestionStates(next)
      writeQuizSessionState(questionId, nextState)
      persistProgress(index, next)
    },
    [index, persistProgress, setQuestionStates],
  )
  const updateLocalState = isDirect ? direct.updateLocalState : updateRoundLocalState

  const resetRoundLocalAnswer = useCallback(
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
    [index, persistProgress, setQuestionStates],
  )
  const resetLocalAnswer = isDirect ? direct.resetLocalAnswer : resetRoundLocalAnswer

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

  const handleRoundImportedQuestions = useCallback(
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
    [index, persistProgress, setQuestionStates, setQuestions],
  )
  const handleImportedQuestions = isDirect
    ? direct.handleImportedQuestions
    : handleRoundImportedQuestions

  const goToRoundIndex = useCallback((nextIndex: number) => {
    setIndex(nextIndex)
    persistProgress(nextIndex, questionStates)
  }, [persistProgress, questionStates, setIndex])
  const goToIndex = isDirect ? direct.goToIndex : goToRoundIndex

  const isQuestionRemoved = useCallback((questionId: number) => (
    (isDirect ? direct.removedQuestionIdsRef.current : roundRemovedQuestionIdsRef.current)
      .has(questionId)
  ), [direct.removedQuestionIdsRef, isDirect])

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
        if (isQuestionRemoved(question.id)) return
        setQuestions((currentQuestions) =>
          currentQuestions.map((item) => (item.id === question.id ? question : item)),
        )
      },
    }),
    [isQuestionRemoved, questionStates, setQuestions, updateLocalState],
  )

  const shouldToastAttemptError = useCallback(
    (questionId: number) => !isQuestionRemoved(questionId),
    [isQuestionRemoved],
  )


  const orchestration = useQuizAttemptOrchestration({
    adapter,
    promptForAiOptions,
    shortAnswerEntrypointKey: isDirect
      ? 'quiz.direct-question-set.short-answer'
      : 'freestyle.scope-quiz.short-answer',
    resultFeedbackMode: 'immediate',
    emitFeedback: dispatchGlobalFeedback,
    onChoiceStart: isDirect
      ? ({ question }) => questionSet?.onQuestionCompleted?.(question.id)
      : undefined,
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
      && !isQuestionRemoved(questionId)
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
  }, [current, isQuestionRemoved, setQuestions])

  const { confirmDialog: trashConfirmDialog, openDeleteConfirm } = useFreestyleQuestionTrash({
    current,
    questions,
    setQuestions,
    questionStates,
    setQuestionStates,
    questionStatesRef: isDirect ? direct.questionStatesRef : roundQuestionStatesRef,
    index,
    setIndex,
    indexRef: isDirect ? direct.indexRef : roundIndexRef,
    persistProgress,
    roundIdRef: isDirect ? noRoundIdRef : roundIdRef,
    planVersionRef,
    storedConfigRef,
    onRoundSync,
    onQuestionDeleted: questionSet?.onQuestionDeleted,
    onLastQuestionDeleted: () => onOpenChange(false),
    setOverlay,
    removedQuestionIdsRef: isDirect ? direct.removedQuestionIdsRef : roundRemovedQuestionIdsRef,
  })

  useEffect(() => {
    setKeyboardOptionIndex(0)
  }, [current?.id])

  const showConfig = isDirect ? configOpen : !setupDone || configOpen

  useQuizAnsweringShortcuts({
    // The open editor owns the keyboard: arrows and answer keys would otherwise
    // page or answer the question underneath the text being rewritten.
    enabled: open && !showConfig && current != null && !editingQuestion,
    questionCount: questions.length,
    optionCount: current?.options.length ?? 0,
    choiceShortcutsActive: current != null && isQuizChoiceShortcutActive(current.question_type, answerMode),
    attemptClosed: isQuizChoiceAttemptClosed(currentState),
    answerRevealed: Boolean(currentState.resolved),
    hasNextQuestion: index < questions.length - 1,
    keyboardOptionIndex,
    setKeyboardOptionIndex,
    interactionRootRef: questionInteractionRef,
    onPreviousQuestion: () => goToIndex(Math.max(0, index - 1)),
    onNextQuestion: () => goToIndex(Math.min(Math.max(questions.length - 1, 0), index + 1)),
    // Visible option buttons own selection, feedback and immediate shuffling.
    onSelectOption: noop,
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
    ? isDirect ? '' : scopeSummary
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
        : isDirect
          ? '当前没有关联题目'
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
                <Button
                  type="button"
                  size="sm"
                  variant={showConfig ? 'default' : 'outline'}
                  aria-label="做题配置"
                  title="做题配置"
                  disabled={!setupDone && showConfig}
                  onClick={() => setConfigOpen((value) => !value)}
                >
                  <Settings2 className="size-4" />
                  <span className="hidden sm:inline">配置</span>
                </Button>
                {/* Phone: the title is redundant with the sheet and costs a header slot. */}
                <DialogTitle className="sr-only text-base sm:not-sr-only">做题</DialogTitle>
              </div>
              <FreestyleScopeQuizHeaderActions
                  copyPalaceId={isDirect ? directPalaceId : questionPalaceId ?? lookupPalaceId}
                  lookupPalaceId={lookupPalaceId}
                  questions={questions}
                  wrongQuestions={wrongQuestions}
                  questionStates={questionStates}
                  currentQuestion={current}
                  copyingOutline={copyingOutline}
                  onCopyOutline={(palaceId) => void copyOutline(palaceId)}
                  onOpenPalace={() => setPalaceLookupOpen(true)}
                  canShuffle={!loading && questions.length > 1}
                  shuffling={isDirect ? false : shuffling}
                  onShuffle={isDirect ? direct.handleShuffleQuestions : () => void shuffleQuestions()}
                  actionsDisabled={editingQuestion || showConfig}
                  onOpenClearProgress={() => setClearProgressOpen(true)}
                  roundActionsAvailable={!isDirect}
                  prioritizeWrong={prioritizeWrong}
                  onPrioritizeWrongChange={isDirect ? undefined : (enabled) => {
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
                directMode={isDirect}
                directQuestionCount={questions.length}
                onClose={() => setConfigOpen(false)}
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => (isDirect ? direct.reload() : void ensureSession())}
                >
                  再试一次
                </Button>
              </div>
            ) : !current ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {isDirect ? '当前没有关联题目' : '当前做题范围内没有题目'}
              </div>
            ) : (
              <>
                {!isDirect && overlay?.limit_reached ? (
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
                    {isDirect ? (
                      directRoundId ? (
                        <QuizQuestionRoundRating
                          roundId={directRoundId}
                          questionId={current.id}
                          palaceId={current.palace_id ?? directPalaceId ?? null}
                          open={open}
                          onOpenSource={() => setPalaceLookupOpen(true)}
                        />
                      ) : null
                    ) : (
                      <QuizQuestionRoundRatingBadge
                        rating={currentRating}
                        pending={currentPending}
                        palaceId={current.palace_id ?? null}
                        onOpenSource={() => setRatingLookupOpen(true)}
                      />
                    )}
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
                      title={isDirect ? '仅随心轮次可用' : '只从本轮随心做题移除这座宫殿的题，不影响复习评分'}
                      disabled={isDirect || editingQuestion}
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
                    {!isDirect ? palaceSkip.confirmDialog : null}
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
                    state={currentState}
                    fontScalePercent={fontScale.percent}
                    interactionRef={questionInteractionRef}
                    onStateChange={(updater) => updateLocalState(current.id, updater)}
                    onChoiceResolve={handleChoiceResolve}
                    onShortAnswerSubmit={() => {
                      orchestration.handleShortAnswerSubmit(current.id)
                      if (isDirect) questionSet?.onQuestionCompleted?.(current.id)
                    }}
                    getDurationMs={dwell.elapsedMs}
                    comboScopeKey={isDirect
                      ? `quiz-direct:${directPalaceId ?? 'unknown'}:${directNodeUid ?? 'all'}`
                      : `freestyle-overlay:${roundId}`}
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
              scopeLabel={isDirect ? '关联题目' : overlayQuizScopeLabel(storedConfig.streams.quiz.quiz_scope)}
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
        focusNodeUid={effectiveLookupFocusNodeUids[0] ?? null}
        focusNodeUids={effectiveLookupFocusNodeUids}
        focusAncestorNodeUid={isDirect ? directNodeUid : undefined}
        focusPending={lookupFocusPending}
      />
      {!isDirect ? (
        <PalaceMemoryLookupDialog
          key={ratingLookupOpen ? 'rating-lookup' : 'rating-lookup-closed'}
          open={ratingLookupOpen}
          onOpenChange={setRatingLookupOpen}
          currentPalaceId={lookupPalaceId}
          followCurrentPalace
          ratingMode
        />
      ) : null}
      {aiRunConfigDialog}
    </>
  )
}
