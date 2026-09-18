import { useCallback, useEffect, useMemo, useState } from 'react'
import { listPalaceQuizNodeBindingsApi } from '@/modules/quiz/domain/quiz-entity/api'
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
  buildCountBadgeByNodeUid,
  buildDirectBindingMap,
  buildRemainingCountByNodeUid,
  buildSubtreeQuestionMap,
  firstIncompleteQuestionIndex,
  getQuestionIdsForNode,
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
    if (!palaceId || !enabled) {
      setBindings([])
      return
    }
    setLoading(true)
    try {
      const response = await listPalaceQuizNodeBindingsApi(palaceId)
      setBindings(response.items)
    } catch {
      setBindings([])
    } finally {
      setLoading(false)
    }
  }, [enabled, palaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const subtreeQuestions = useMemo(() => {
    if (!editorDoc) return new Map<string, Set<number>>()
    return buildSubtreeQuestionMap(editorDoc, buildDirectBindingMap(bindings))
  }, [bindings, editorDoc])

  const remainingCountByNodeUid = useMemo(
    () => buildRemainingCountByNodeUid(subtreeQuestions, completedQuestionIds),
    [completedQuestionIds, subtreeQuestions],
  )

  const countBadgeByNodeUid = useMemo(
    () => buildCountBadgeByNodeUid(subtreeQuestions, completedQuestionIds),
    [completedQuestionIds, subtreeQuestions],
  )

  const markQuestionCompleted = useCallback((questionId: number) => {
    markQuizSessionCompleted(questionId, palaceId)
  }, [palaceId])

  const updateQuestionState = useCallback((questionId: number, next: QuizRuntimeState) => {
    writeQuizSessionState(questionId, next, palaceId)
  }, [palaceId])

  /** All bound ids for the node (including completed) so dialog can review past answers. */
  const getOpenQuestionIds = useCallback(
    (nodeUid: string) =>
      getQuestionIdsForNode(subtreeQuestions, nodeUid, completedQuestionIds, {
        includeCompleted: true,
      }),
    [completedQuestionIds, subtreeQuestions],
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
