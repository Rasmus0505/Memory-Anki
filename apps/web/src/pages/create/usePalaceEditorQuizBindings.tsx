import { useState } from 'react'
import type { MindMapDocumentInput } from '@/modules/content/public'
import { QuizNodeBindingDialog } from '@/modules/quiz/public'
import { usePalaceQuizNodeBindings } from '@/modules/quiz/public'
import { NodeBoundQuizDialog } from '@/widgets/node-bound-quiz'
import type { QuizNodeBindingEdge } from '@/shared/api/contracts'
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
    moreAction,
    dialogs,
  }
}
