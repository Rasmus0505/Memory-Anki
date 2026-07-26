import { useCallback, useEffect, useMemo, useState } from 'react'
import { listPalaceQuizNodeBindingsApi } from '@/modules/quiz/domain/quiz-entity/api'
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

/**
 * Session-wide (SPA lifetime) so freestyle remounts / multi-unit windows share
 * completed badges and answer drafts. Page reload clears it.
 */
const sessionCompletedQuestionIds = new Set<number>()
const sessionQuestionStates: Record<number, QuizRuntimeState> = {}
const sessionListeners = new Set<() => void>()

function notifySessionQuizBindings() {
  for (const listener of sessionListeners) listener()
}

function readSessionCompletedIds() {
  return new Set(sessionCompletedQuestionIds)
}

function readSessionQuestionStates() {
  return { ...sessionQuestionStates }
}

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
    () => readSessionCompletedIds(),
  )
  const [questionStates, setQuestionStates] = useState<Record<number, QuizRuntimeState>>(
    () => readSessionQuestionStates(),
  )

  useEffect(() => {
    const listener = () => {
      setCompletedQuestionIds(readSessionCompletedIds())
      setQuestionStates(readSessionQuestionStates())
    }
    sessionListeners.add(listener)
    // Sync in case another instance wrote while this one was mounting.
    listener()
    return () => {
      sessionListeners.delete(listener)
    }
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
    if (sessionCompletedQuestionIds.has(questionId)) return
    sessionCompletedQuestionIds.add(questionId)
    notifySessionQuizBindings()
  }, [])

  const updateQuestionState = useCallback((questionId: number, next: QuizRuntimeState) => {
    sessionQuestionStates[questionId] = next
    notifySessionQuizBindings()
  }, [])

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
