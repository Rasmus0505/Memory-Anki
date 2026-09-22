import { useCallback, useMemo, useState } from 'react'
import { copyMindMapToClipboard, exportMindMapToFile } from '@/modules/content/public'
import { usePalaceQuizNodeBindings } from '@/modules/quiz/public'
import type { FreestyleReviewUnitCard, MindMapEditorState } from '@/shared/api/contracts'
import { toast } from '@/shared/feedback/toast'

export function useFreestyleUnitReviewNodeQuiz({
  palaceId,
  editorDoc,
}: {
  palaceId: number
  editorDoc: MindMapEditorState['editor_doc']
}) {
  const quizNodeBindings = usePalaceQuizNodeBindings({
    palaceId,
    editorDoc,
    enabled: Boolean(palaceId),
  })
  const [nodeQuizOpen, setNodeQuizOpen] = useState(false)
  const [nodeQuizNodeUid, setNodeQuizNodeUid] = useState<string | null>(null)
  const [nodeQuizQuestionIds, setNodeQuizQuestionIds] = useState<number[]>([])
  const [nodeQuizInitialIndex, setNodeQuizInitialIndex] = useState(0)

  const handleOpenNodeQuiz = useCallback(
    (nodeUid: string, kind?: 'objective' | 'subjective') => {
      const ids = quizNodeBindings.getOpenQuestionIds(nodeUid, kind)
      if (!ids.length) {
        toast.message(
          kind === 'subjective'
            ? '该卡片没有关联主观题。'
            : kind === 'objective'
              ? '该卡片没有关联客观题。'
              : '该卡片没有关联题目。',
        )
        return
      }
      setNodeQuizNodeUid(nodeUid)
      setNodeQuizQuestionIds(ids)
      setNodeQuizInitialIndex(quizNodeBindings.getInitialQuestionIndex(ids))
      setNodeQuizOpen(true)
    },
    [quizNodeBindings],
  )

  return {
    quizNodeBindings,
    nodeQuizOpen,
    setNodeQuizOpen,
    nodeQuizNodeUid,
    nodeQuizQuestionIds,
    nodeQuizInitialIndex,
    handleOpenNodeQuiz,
  }
}

export function useFreestyleUnitReviewMoreActions({
  card,
  sessionTitle,
  editorState,
  isEditMode,
  handleToggleMode,
  setReviewUnitsPanelOpen,
  permanentMarkMode,
  permanentMarkHighlightsLength,
  handleTogglePermanentMarkMode,
  savingEdit,
  onTextToMindMap,
}: {
  card: FreestyleReviewUnitCard
  sessionTitle: string
  editorState: MindMapEditorState
  isEditMode: boolean
  handleToggleMode: () => void
  setReviewUnitsPanelOpen: (open: boolean) => void
  permanentMarkMode: boolean
  permanentMarkHighlightsLength: number
  handleTogglePermanentMarkMode: () => void
  savingEdit: boolean
  onTextToMindMap: () => void
}) {
  return useMemo(() => {
    const actions: Array<{
      label: string
      onClick: () => void
      disabled?: boolean
      separatorBefore?: boolean
      opensOverlay?: boolean
    }> = [
      {
        label: isEditMode ? '返回学习' : '进入编辑',
        onClick: handleToggleMode,
      },
      {
        label: '复习进度',
        onClick: () => setReviewUnitsPanelOpen(true),
        separatorBefore: true,
      },
    ]
    const palaceTitle = card.palace_title || sessionTitle || `宫殿 ${card.palace_id}`
    actions.push({
      label: '复制导图',
      onClick: () => {
        void copyMindMapToClipboard(editorState, palaceTitle)
          .then(() => toast.success('脑图已复制到剪切板'))
          .catch((error: unknown) => toast.error(error instanceof Error ? error.message : '复制脑图失败。'))
      },
      separatorBefore: true,
    })
    actions.push({
      label: '文字转脑图',
      onClick: () => { void onTextToMindMap() },
      opensOverlay: true,
    })
    actions.push({
      label: '导出脑图',
      onClick: () => {
        try {
          exportMindMapToFile(editorState, palaceTitle)
          toast.success('脑图已导出')
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '导出脑图失败。')
        }
      },
      disabled: !editorState?.editor_doc,
    })
    if (isEditMode) {
      actions.push({
        label: permanentMarkMode
          ? `退出永久标记${permanentMarkHighlightsLength ? `（已标 ${permanentMarkHighlightsLength}）` : ''}`
          : permanentMarkHighlightsLength
            ? `永久标记（已标 ${permanentMarkHighlightsLength}）`
            : '永久标记',
        onClick: handleTogglePermanentMarkMode,
        disabled: permanentMarkMode ? false : savingEdit,
        separatorBefore: true,
      })
    }
    return actions
  }, [
    card.palace_id,
    card.palace_title,
    editorState,
    handleToggleMode,
    handleTogglePermanentMarkMode,
    isEditMode,
    onTextToMindMap,
    permanentMarkHighlightsLength,
    permanentMarkMode,
    savingEdit,
    sessionTitle,
    setReviewUnitsPanelOpen,
  ])
}
