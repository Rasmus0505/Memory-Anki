import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  getPalaceQuizQuestionsApi,
  getPalaceQuizQuestionsByIdsApi,
} from '@/modules/quiz/domain/quiz-entity/api'
import {
  applyQuizShuffleOrder,
  readQuizShuffleOrder,
  saveQuizShuffleOrder,
  type QuizRuntimeState,
} from '@/modules/quiz/public'
import { sortPalaceQuizQuestions } from '@/modules/quiz/ui/palace-quiz/model/questionBankOrder'
import { firstIncompleteQuestionIndex } from '@/modules/quiz/ui/palace-quiz/model/quizNodeBindingAggregation'
import {
  clearQuizSessionProgress,
  clearQuizSessionProgressForPalaces,
  readQuizSessionState,
  removeQuizSessionQuestions,
  writeQuizSessionState,
} from '@/modules/quiz/public'
import { shuffleQuizQuestionsForPractice } from '@/modules/quiz/public'
import type { QuizProgressClearChoice } from '@/widgets/quiz-progress-clear/QuizProgressClearDialog'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { toast } from '@/shared/feedback/toast'

/**
 * Direct question set source for the shared 做题 window.
 *
 * The 随心 toolbar opens the window on a round. A node badge, a mind-map review
 * card, or a 随心 unit card knows only a list of question ids, so this hook loads
 * that list and owns the session progress, shuffle order, and local clear/import
 * actions. Presentation stays in `FreestyleScopeQuizDialog`, so there is one
 * quiz window to change.
 */
export function useDirectQuestionSetQuiz({
  enabled,
  open,
  palaceId,
  nodeUid,
  questionIds,
  initialQuestionStates,
  onQuestionStateChange,
  onQuestionStateChangeRef,
}: {
  enabled: boolean
  open: boolean
  palaceId: number | null
  nodeUid?: string | null
  questionIds: readonly number[]
  initialQuestionStates?: Record<number, QuizRuntimeState>
  onQuestionStateChange?: (questionId: number, next: QuizRuntimeState) => void
  /** Same callback behind a ref so loading is not restarted by a new identity. */
  onQuestionStateChangeRef?: RefObject<((questionId: number, next: QuizRuntimeState) => void) | undefined>
}) {
  const [questions, setQuestions] = useState<PalaceQuizQuestion[]>([])
  const questionsRef = useRef<PalaceQuizQuestion[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [index, setIndex] = useState(0)
  const indexRef = useRef(0)
  const [questionStates, setQuestionStates] = useState<Record<number, QuizRuntimeState>>({})
  const questionStatesRef = useRef<Record<number, QuizRuntimeState>>({})
  const removedQuestionIdsRef = useRef(new Set<number>())
  const [reloadTick, setReloadTick] = useState(0)
  const forceReloadRef = useRef(false)
  const initialStatesRef = useRef(initialQuestionStates)
  initialStatesRef.current = initialQuestionStates
  const questionIdsKey = questionIds.join(',')

  useEffect(() => {
    indexRef.current = index
  }, [index])
  useEffect(() => {
    questionStatesRef.current = questionStates
  }, [questionStates])
  useEffect(() => {
    if (!open) removedQuestionIdsRef.current = new Set()
  }, [open])

  useEffect(() => {
    if (!enabled) return
    if (!open || !palaceId || questionIds.length === 0) {
      questionsRef.current = []
      setQuestions([])
      setIndex(0)
      setQuestionStates({})
      forceReloadRef.current = false
      setLoadError('')
      setLoading(false)
      return
    }
    const activeIds = questionIds.filter((id) => !removedQuestionIdsRef.current.has(id))
    if (activeIds.length === 0) {
      questionsRef.current = []
      setQuestions([])
      setLoading(false)
      return
    }
    const activeSet = new Set(activeIds)
    const shown = questionsRef.current
    const forceReload = forceReloadRef.current
    forceReloadRef.current = false
    if (
      !forceReload
      && shown.length > 0
      && activeIds.every((id) => shown.some((item) => item.id === id))
      && shown.every((item) => activeSet.has(item.id))
    ) {
      return
    }
    if (!forceReload && shown.length > 0 && activeIds.every((id) => shown.some((item) => item.id === id))) {
      const next = shown.filter((item) => activeSet.has(item.id))
      questionsRef.current = next
      setQuestions(next)
      setIndex((value) => Math.min(value, Math.max(next.length - 1, 0)))
      return
    }
    let cancelled = false
    if (shown.length === 0) setLoading(true)
    setLoadError('')
    void Promise.all([
      getPalaceQuizQuestionsByIdsApi(activeIds).then(
        (response) => ({ failed: false as const, items: response.items || [] }),
        () => ({ failed: true as const, items: [] as PalaceQuizQuestion[] }),
      ),
      getPalaceQuizQuestionsApi(palaceId).catch(() => ({ items: [] as PalaceQuizQuestion[] })),
    ])
      .then(([questionOutcome, palaceQuestions]) => {
        if (cancelled) return
        const byId = new Map<number, PalaceQuizQuestion>()
        // Palace list is only a fallback when by-ids fails. A successful by-ids
        // response omits deleted rows; filling those ids from a stale palace
        // payload would put the question back on screen.
        if (questionOutcome.failed) {
          for (const item of palaceQuestions.items || []) byId.set(item.id, item)
        }
        for (const item of questionOutcome.items) byId.set(item.id, item)
        const natural = sortPalaceQuizQuestions(
          activeIds
            .map((id) => byId.get(id))
            .filter((item): item is PalaceQuizQuestion => Boolean(item))
            .filter((item) => !removedQuestionIdsRef.current.has(item.id)),
        )
        const ordered = applyQuizShuffleOrder(
          natural,
          // 打乱题库 is a shared preference (palace+node, then the same question
          // set from another entry point), so reopening never reshuffles it.
          readQuizShuffleOrder({ palaceId, nodeUid: nodeUid ?? null }, natural.map((item) => item.id)),
        )
        questionsRef.current = ordered
        setQuestions(ordered)
        if (ordered.length < activeIds.length) {
          setLoadError('有些关联题目未能加载，可能已删除。')
        }
        // Restore the shared progress before choosing a resume position. Node
        // badges and the editor feed share this ledger even when their caller
        // supplied no local seed for the current question set.
        const restored: Record<number, QuizRuntimeState> = {}
        for (const question of ordered) {
          const shared = readQuizSessionState(question.id)
          const seeded = shared.resolved || shared.selectedOptionId || shared.rating
            ? shared
            : initialStatesRef.current?.[question.id]
          if (seeded) restored[question.id] = seeded
        }
        const completedIds = new Set(
          ordered
            .filter((question) => restored[question.id]?.resolved)
            .map((question) => question.id),
        )
        setIndex(
          firstIncompleteQuestionIndex(
            ordered.map((question) => question.id),
            completedIds,
          ),
        )
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
  }, [enabled, open, palaceId, questionIdsKey, nodeUid, reloadTick])

  const reload = useCallback(() => {
    forceReloadRef.current = true
    setReloadTick((value) => value + 1)
  }, [])

  const goToIndex = useCallback((nextIndex: number) => {
    setIndex(Math.max(0, Math.min(nextIndex, Math.max(questionsRef.current.length - 1, 0))))
  }, [])

  const updateLocalState = useCallback(
    (questionId: number, updater: (current: QuizRuntimeState) => QuizRuntimeState) => {
      const current = questionStatesRef.current
      const prev = current[questionId] ?? readQuizSessionState(questionId)
      const nextState = updater(prev)
      const next = { ...current, [questionId]: nextState }
      questionStatesRef.current = next
      setQuestionStates(next)
      writeQuizSessionState(questionId, nextState, palaceId)
      const notify = onQuestionStateChangeRef?.current ?? onQuestionStateChange
      notify?.(questionId, nextState)
    },
    [onQuestionStateChange, onQuestionStateChangeRef, palaceId],
  )

  const resetLocalAnswer = useCallback(
    (questionId: number) => {
      removeQuizSessionQuestions([questionId])
      setQuestionStates((current) => {
        if (current[questionId] == null) return current
        const next = { ...current }
        delete next[questionId]
        const notify = onQuestionStateChangeRef?.current ?? onQuestionStateChange
        notify?.(questionId, {})
        return next
      })
    },
    [onQuestionStateChange, onQuestionStateChangeRef],
  )

  /**
   * 打乱题库: shuffle only the questions still open, keep answered slots, and
   * remember the order so reopening the window does not undo it.
   */
  const handleShuffleQuestions = useCallback(() => {
    const loaded = questionsRef.current
    if (loaded.length < 2) {
      toast.info('这个窗口只有一道题，没有可打乱的顺序。')
      return
    }
    const answered = new Set(
      loaded
        .filter((question) => questionStatesRef.current[question.id]?.resolved)
        .map((question) => question.id),
    )
    const openCount = loaded.length - answered.size
    if (openCount === 1) {
      toast.info('只剩一道还没答的题，打乱后顺序不会变。')
      return
    }
    const next = shuffleQuizQuestionsForPractice(loaded, answered)
    questionsRef.current = next
    setQuestions(next)
    saveQuizShuffleOrder({ palaceId, nodeUid: nodeUid ?? null }, next.map((question) => question.id))
    setIndex(firstIncompleteQuestionIndex(next.map((question) => question.id), answered))
    toast.success(
      answered.size >= next.length
        ? '题目都答过了，已整份打乱，从第 1 题开始。'
        : '已打乱题库，从第一道还没答的题开始。',
    )
  }, [nodeUid, palaceId])

  const handleClearChoice = useCallback((choice: QuizProgressClearChoice) => {
    const loaded = questionsRef.current
    if (choice.scope === 'palace') {
      const targetPalaceId = choice.palaceId
      if (!targetPalaceId) return
      // Answers opened from this palace are stored against it, even when a
      // question itself belongs to another palace.
      clearQuizSessionProgressForPalaces([targetPalaceId])
      const ids = loaded
        .filter((item) => item.palace_id === targetPalaceId || palaceId === targetPalaceId)
        .map((item) => item.id)
      if (ids.length > 0) removeQuizSessionQuestions(ids)
      setQuestionStates((current) => {
        const next = { ...current }
        for (const id of ids) delete next[id]
        return next
      })
      toast.success('已清除所选宫殿的做题进度。')
      return
    }
    clearQuizSessionProgress()
    setQuestionStates({})
    toast.success('已清除全部题目的做题进度。')
  }, [palaceId])

  const handleImportedQuestions = useCallback((items: PalaceQuizQuestion[]) => {
    if (items.length === 0) return
    const updatedById = new Map(items.map((item) => [item.id, item]))
    setQuestions((currentQuestions) =>
      currentQuestions.map((item) => updatedById.get(item.id) ?? item),
    )
    const ids = items.map((item) => item.id)
    removeQuizSessionQuestions(ids)
    setQuestionStates((current) => {
      const next = { ...current }
      for (const id of ids) delete next[id]
      return next
    })
  }, [])

  return {
    questions,
    setQuestions,
    questionsRef,
    loading,
    loadError,
    reload,
    index,
    setIndex,
    indexRef,
    goToIndex,
    questionStates,
    setQuestionStates,
    questionStatesRef,
    removedQuestionIdsRef,
    updateLocalState,
    resetLocalAnswer,
    handleShuffleQuestions,
    handleClearChoice,
    handleImportedQuestions,
  }
}
