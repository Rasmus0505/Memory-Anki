import { useCallback, useEffect, useMemo, useState } from 'react'
import { listPalaceQuizNodeBindingsApi } from '@/entities/quiz/api'
import type { MindMapDocumentInput } from '@/entities/mindmap-document'
import type { QuizNodeBindingEdge } from '@/shared/api/contracts'
import {
  buildDirectBindingMap,
  buildRemainingCountByNodeUid,
  buildSubtreeQuestionMap,
  getQuestionIdsForNode,
} from '@/features/palace-quiz/model/quizNodeBindingAggregation'

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
  const [completedQuestionIds, setCompletedQuestionIds] = useState<Set<number>>(() => new Set())

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

  // Reset session completions when leaving the palace page (palaceId change).
  useEffect(() => {
    setCompletedQuestionIds(new Set())
  }, [palaceId])

  const subtreeQuestions = useMemo(() => {
    if (!editorDoc) return new Map<string, Set<number>>()
    return buildSubtreeQuestionMap(editorDoc, buildDirectBindingMap(bindings))
  }, [bindings, editorDoc])

  const remainingCountByNodeUid = useMemo(
    () => buildRemainingCountByNodeUid(subtreeQuestions, completedQuestionIds),
    [completedQuestionIds, subtreeQuestions],
  )

  const countBadgeByNodeUid = useMemo(() => {
    const map: Record<string, { text: string; tone: 'success'; title: string }> = {}
    for (const [uid, count] of Object.entries(remainingCountByNodeUid)) {
      map[uid] = {
        text: String(count),
        tone: 'success',
        title: `${count} 道关联题未完成（本会话）`,
      }
    }
    return map
  }, [remainingCountByNodeUid])

  const markQuestionCompleted = useCallback((questionId: number) => {
    setCompletedQuestionIds((current) => {
      if (current.has(questionId)) return current
      const next = new Set(current)
      next.add(questionId)
      return next
    })
  }, [])

  const getOpenQuestionIds = useCallback(
    (nodeUid: string) => getQuestionIdsForNode(subtreeQuestions, nodeUid, completedQuestionIds),
    [completedQuestionIds, subtreeQuestions],
  )

  return {
    bindings,
    loading,
    refresh,
    countBadgeByNodeUid,
    remainingCountByNodeUid,
    markQuestionCompleted,
    getOpenQuestionIds,
    completedQuestionIds,
    setBindings,
  }
}
