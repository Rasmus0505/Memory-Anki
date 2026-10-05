import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listPalaceQuizNodeBindingsApi, palaceQuizNodeBindingsCacheKey } from '@/modules/quiz/domain/quiz-entity/api'
import { shareInFlightRequest } from '@/shared/api/inFlightRequest'
import { subscribeQuizQuestionMarked } from '@/modules/quiz/domain/quiz-entity/model/quizQuestionMarkSync'
import {
  markQuizSessionCompleted,
  readQuizSessionCompletedIds,
  readQuizSessionStates,
  subscribeQuizSessionProgress,
  writeQuizSessionState,
} from '@/modules/quiz/domain/quiz-entity/model/quizSessionProgress'
import type { QuizRuntimeState } from '@/modules/quiz/domain/quiz-entity/model/quizRuntime'
import type { MindMapDocumentInput } from '@/modules/content/public'
import type { QuizNodeBindingEdge } from '@/shared/api/contracts'
import {
  applyQuizQuestionMarkToBindings,
  buildBoundQuestionFacts,
  buildCountBadgeByNodeUid,
  buildDirectBindingMap,
  buildRemainingCountByNodeUid,
  buildSubtreeQuestionMap,
  firstIncompleteQuestionIndex,
  getQuestionIdsForNode,
  type NodeQuizCountBadge,
} from '@/modules/quiz/ui/palace-quiz/model/quizNodeBindingAggregation'

export function usePalaceQuizNodeBindings({
  palaceId,
  editorDoc,
  enabled = true,
}: {
  palaceId: number | null | undefined
  editorDoc: MindMapDocumentInput
  enabled?: boolean
}) {
  const [bindings, setBindings] = useState<QuizNodeBindingEdge[]>([])
  const [loading, setLoading] = useState(false)
  const [completedQuestionIds, setCompletedQuestionIds] = useState<Set<number>>(
    () => readQuizSessionCompletedIds(),
  )
  const [questionStates, setQuestionStates] = useState<Record<number, QuizRuntimeState>>(
    () => readQuizSessionStates(),
  )
  const refreshGenerationRef = useRef(0)

  useEffect(() => {
    const listener = () => {
      setCompletedQuestionIds(readQuizSessionCompletedIds())
      setQuestionStates(readQuizSessionStates())
    }
    const unsubscribe = subscribeQuizSessionProgress(listener)
    listener()
    return unsubscribe
  }, [])

  const refresh = useCallback(async () => {
    const generation = ++refreshGenerationRef.current
    if (!palaceId || !enabled) {
      setBindings([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      // A freestyle card mounts two independent consumers of this hook, and the
      // feed mounts one more per preloaded card. Without sharing they each open
      // their own connection for identical data, which is enough fan-out to
      // starve the SQLite pool on a burst-opened feed.
      const response = await shareInFlightRequest(
        palaceQuizNodeBindingsCacheKey(palaceId),
        () => listPalaceQuizNodeBindingsApi(palaceId),
      )
      if (generation === refreshGenerationRef.current) setBindings(response.items)
    } catch {
      if (generation === refreshGenerationRef.current) setBindings([])
    } finally {
      if (generation === refreshGenerationRef.current) setLoading(false)
    }
  }, [enabled, palaceId])

  useEffect(() => {
    if (!enabled || !palaceId) {
      refreshGenerationRef.current += 1
      setBindings([])
      setLoading(false)
      return
    }
    // Do not spend a database connection on a card that was only active during
    // a fast page turn. The active card remains responsive because the delay is
    // shorter than the feed transition, while rapid paging coalesces naturally.
    const timer = window.setTimeout(() => { void refresh() }, 120)
    return () => {
      window.clearTimeout(timer)
      refreshGenerationRef.current += 1
    }
  }, [enabled, palaceId, refresh])

  useEffect(() => {
    return subscribeQuizQuestionMarked((questionId, marked) => {
      setBindings((current) => applyQuizQuestionMarkToBindings(current, questionId, marked))
    })
  }, [])

  const subtreeQuestions = useMemo(() => {
    if (!editorDoc) return new Map<string, Set<number>>()
    return buildSubtreeQuestionMap(editorDoc, buildDirectBindingMap(bindings))
  }, [bindings, editorDoc])

  const remainingCountByNodeUid = useMemo(
    () => buildRemainingCountByNodeUid(subtreeQuestions, completedQuestionIds),
    [completedQuestionIds, subtreeQuestions],
  )

  const questionFacts = useMemo(() => buildBoundQuestionFacts(bindings), [bindings])

  const countBadgeByNodeUid = useMemo(
    () => buildCountBadgeByNodeUid(subtreeQuestions, questionFacts),
    [questionFacts, subtreeQuestions],
  )

  const markQuestionCompleted = useCallback((questionId: number) => {
    markQuizSessionCompleted(questionId, palaceId)
  }, [palaceId])

  const updateQuestionState = useCallback((questionId: number, next: QuizRuntimeState) => {
    writeQuizSessionState(questionId, next, palaceId)
  }, [palaceId])

  /** Bound ids for the node, including completed ones. `kind` keeps one badge side. */
  const getOpenQuestionIds = useCallback(
    (nodeUid: string, kind?: NodeQuizCountBadge['kind']) =>
      getQuestionIdsForNode(subtreeQuestions, nodeUid, completedQuestionIds, {
        includeCompleted: true,
        kind,
        facts: questionFacts,
      }),
    [completedQuestionIds, questionFacts, subtreeQuestions],
  )

  const getInitialQuestionIndex = useCallback(
    (questionIds: readonly number[]) =>
      firstIncompleteQuestionIndex(questionIds, completedQuestionIds),
    [completedQuestionIds],
  )

  return {
    bindings,
    loading,
    refresh,
    countBadgeByNodeUid,
    remainingCountByNodeUid,
    markQuestionCompleted,
    getOpenQuestionIds,
    getInitialQuestionIndex,
    completedQuestionIds,
    questionStates,
    updateQuestionState,
    setBindings,
  }
}
