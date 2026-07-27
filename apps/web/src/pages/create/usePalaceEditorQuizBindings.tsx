import { useCallback, useRef, useState } from 'react'
import type { MindMapDocumentInput } from '@/modules/content/public'
import { getPalaceQuizQuestionsApi } from '@/modules/quiz/public'
import { QuizNodeBindingDialog } from '@/modules/quiz/public'
import {
  QuizNodeDeleteGuardDialog,
  type QuizNodeDeleteGuardRequest,
} from '@/modules/quiz/public'
import { usePalaceQuizNodeBindings } from '@/modules/quiz/public'
import { NodeBoundQuizDialog } from '@/widgets/node-bound-quiz'
import type { PalaceQuizQuestion, QuizNodeBindingEdge } from '@/shared/api/contracts'
import { toast } from '@/shared/feedback/toast'

/** Host wiring for 题库结合: overflow entry, count badges, preview/apply + floating quiz. */
export function usePalaceEditorQuizBindings({
  palaceId,
  editorDoc,
}: {
  palaceId: number | null | undefined
  editorDoc: MindMapDocumentInput
}) {
  const quizNodeBindings = usePalaceQuizNodeBindings({
    palaceId,
    editorDoc,
    enabled: Boolean(palaceId),
  })
  const [quizBindingOpen, setQuizBindingOpen] = useState(false)
  const [nodeQuizOpen, setNodeQuizOpen] = useState(false)
  const [nodeQuizNodeUid, setNodeQuizNodeUid] = useState<string | null>(null)
  const [nodeQuizQuestionIds, setNodeQuizQuestionIds] = useState<number[]>([])

  const [nodeQuizInitialIndex, setNodeQuizInitialIndex] = useState(0)

  const [deleteGuardRequest, setDeleteGuardRequest] =
    useState<QuizNodeDeleteGuardRequest | null>(null)
  const [guardQuestionById, setGuardQuestionById] = useState<Map<number, PalaceQuizQuestion>>(
    () => new Map(),
  )
  const deleteGuardResolveRef = useRef<((proceed: boolean) => void) | null>(null)

  const openNodeQuiz = (nodeUid: string) => {
    const ids = quizNodeBindings.getOpenQuestionIds(nodeUid)
    if (!ids.length) {
      toast.message('该卡片没有关联题目。')
      return
    }
    setNodeQuizNodeUid(nodeUid)
    setNodeQuizQuestionIds(ids)
    setNodeQuizInitialIndex(quizNodeBindings.getInitialQuestionIndex(ids))
    setNodeQuizOpen(true)
  }

  const handleBindingsApplied = (items: QuizNodeBindingEdge[]) => {
    quizNodeBindings.setBindings(items)
  }

  /**
   * Gate for card deletion: if any card going away still carries quiz bindings,
   * show the user those questions and let them re-home or drop each one.
   */
  const confirmDeleteNodes = useCallback(
    async (removedNodeUids: readonly string[]) => {
      if (!palaceId) return true
      const removed = new Set(removedNodeUids)
      const affectedEdges = quizNodeBindings.bindings.filter((edge) =>
        removed.has(edge.node_uid),
      )
      if (affectedEdges.length === 0) return true

      // Stems are what make the list judgeable; a fetch failure still shows ids.
      try {
        const response = await getPalaceQuizQuestionsApi(palaceId)
        setGuardQuestionById(new Map(response.items.map((item) => [item.id, item])))
      } catch {
        setGuardQuestionById(new Map())
      }

      const proceed = await new Promise<boolean>((resolve) => {
        deleteGuardResolveRef.current = resolve
        setDeleteGuardRequest({ removedNodeUids, affectedEdges })
      })
      setDeleteGuardRequest(null)
      deleteGuardResolveRef.current = null
      if (proceed) void quizNodeBindings.refresh()
      return proceed
    },
    [palaceId, quizNodeBindings],
  )

  const moreAction = {
    label: '题库结合',
    onClick: () => setQuizBindingOpen(true),
    opensOverlay: true as const,
    separatorBefore: true,
  }

  const dialogs = (
    <>
      <QuizNodeBindingDialog
        open={quizBindingOpen}
        onOpenChange={setQuizBindingOpen}
        palaceId={palaceId ?? null}
        editorDoc={editorDoc}
        onApplied={handleBindingsApplied}
      />
      <QuizNodeDeleteGuardDialog
        request={deleteGuardRequest}
        palaceId={palaceId ?? null}
        editorDoc={editorDoc}
        questionById={guardQuestionById}
        onResolve={(proceed) => deleteGuardResolveRef.current?.(proceed)}
      />
      <NodeBoundQuizDialog
        open={nodeQuizOpen}
        onOpenChange={setNodeQuizOpen}
        palaceId={palaceId ?? null}
        nodeUid={nodeQuizNodeUid}
        questionIds={nodeQuizQuestionIds}
        initialIndex={nodeQuizInitialIndex}
        initialQuestionStates={quizNodeBindings.questionStates}
        onQuestionStateChange={quizNodeBindings.updateQuestionState}
        onQuestionCompleted={quizNodeBindings.markQuestionCompleted}
      />
    </>
  )

  return {
    countBadgeByNodeUid: quizNodeBindings.countBadgeByNodeUid,
    openNodeQuiz,
    confirmDeleteNodes,
    moreAction,
    dialogs,
  }
}
