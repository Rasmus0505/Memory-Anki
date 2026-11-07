import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { copyMindMapToClipboard, getPalaceEditorApi, type MindMapSelection } from '@/modules/content/public'
import { buildQuizQuestionsCopyText, getPalaceQuizQuestionsApi } from '@/modules/quiz/public'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { toast } from '@/shared/feedback/toast'
import { buildMindMapOutlineText } from '@/shared/lib/mindMapOutlineText'
import { readClipboardTextForMindMapImport, useMindMapImport } from '@/modules/produce/public'
import type { RevealState } from '@/modules/memory/public'
import type { FreestyleReviewUnitCard, MindMapEditorState } from '@/shared/api/contracts'
import { FreestyleMindMapImportDrawer } from './FreestyleMindMapImportDrawer'
import { useFreestyleUnitReviewMoreActions } from './freestyleUnitReviewFlipToolbar'

interface UseFreestyleTextToMindMapOptions {
  palaceId: number
  card: FreestyleReviewUnitCard
  sessionTitle: string
  isEditMode: boolean
  editorState: MindMapEditorState
  editEditorState: MindMapEditorState
  handleToggleMode: () => void
  setReviewUnitsPanelOpen: (open: boolean) => void
  revealApiRef: { readonly current: { revealMap: Record<string, RevealState> } }
  displayModeRef: MutableRefObject<'review' | 'edit'>
  editRevealSnapshotRef: MutableRefObject<Record<string, RevealState> | null>
  setPermanentMarkMode: Dispatch<SetStateAction<boolean>>
  setDisplayMode: Dispatch<SetStateAction<'review' | 'edit'>>
  setModeSyncVersion: Dispatch<SetStateAction<number>>
  handleEditorStateChange: (nextState: MindMapEditorState) => void
}

export function useFreestyleTextToMindMap({
  palaceId,
  card,
  sessionTitle,
  isEditMode,
  editorState,
  editEditorState,
  handleToggleMode,
  setReviewUnitsPanelOpen,
  revealApiRef,
  displayModeRef,
  editRevealSnapshotRef,
  setPermanentMarkMode,
  setDisplayMode,
  setModeSyncVersion,
  handleEditorStateChange,
}: UseFreestyleTextToMindMapOptions) {
  const [selectedAppendNode, setSelectedAppendNode] = useState<{ uid: string; text: string } | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copying, setCopying] = useState(false)
  const openCopy = useCallback(() => setCopyOpen(true), [])
  const copyMap = async (withQuestions: boolean) => {
    if (copying) return
    setCopying(true)
    try {
      const title = card.palace_title || sessionTitle || `宫殿 ${palaceId}`
      if (withQuestions) {
        const [palace, response] = await Promise.all([
          getPalaceEditorApi(palaceId),
          getPalaceQuizQuestionsApi(palaceId),
        ])
        const outline = buildMindMapOutlineText(palace.editor_doc, { title: palace.palace?.title ?? title })
        if (!outline) throw new Error('当前脑图还没加载完成。')
        if (!navigator.clipboard?.writeText) throw new Error('当前环境不支持写入剪贴板。')
        const questions = buildQuizQuestionsCopyText(response.items ?? [])
        await navigator.clipboard.writeText(questions ? `${outline}\n\n全部题目\n\n${questions}` : `${outline}\n\n本宫殿暂无题目。`)
        toast.success(`已复制导图和 ${response.items?.length ?? 0} 道题。`)
      } else {
        await copyMindMapToClipboard(editorState, title)
        toast.success('脑图已复制到剪切板')
      }
      setCopyOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制脑图失败。')
    } finally {
      setCopying(false)
    }
  }
  const onNodeActive = useCallback((nodes: MindMapSelection[]) => {
    const node = nodes[0]
    setSelectedAppendNode(node?.uid ? { uid: node.uid, text: node.text || '' } : null)
  }, [])
  const liveEditorState = isEditMode ? editEditorState : editorState
  const applyImportedEditorState = useCallback((nextState: MindMapEditorState) => {
    if (displayModeRef.current !== 'edit') {
      editRevealSnapshotRef.current = { ...revealApiRef.current.revealMap }
      setPermanentMarkMode(false)
      setDisplayMode('edit')
      setModeSyncVersion((value) => value + 1)
    }
    handleEditorStateChange(nextState)
  }, [
    displayModeRef,
    editRevealSnapshotRef,
    handleEditorStateChange,
    revealApiRef,
    setDisplayMode,
    setModeSyncVersion,
    setPermanentMarkMode,
  ])
  const mindMapImport = useMindMapImport({
    entityKey: palaceId ? `palace_${palaceId}` : null,
    editorState: liveEditorState,
    setEditorState: applyImportedEditorState,
    applyEditorState: applyImportedEditorState,
    selectedNodeUid: selectedAppendNode?.uid ?? null,
  })
  const openTextToMindMap = useCallback(() => {
    void readClipboardTextForMindMapImport().then((text) => {
      mindMapImport.openManualJsonPreview(text)
    })
  }, [mindMapImport])
  const moreActions = useFreestyleUnitReviewMoreActions({
    card,
    sessionTitle,
    editorState,
    isEditMode,
    handleToggleMode,
    setReviewUnitsPanelOpen,
    onTextToMindMap: openTextToMindMap,
    onCopyMindMap: openCopy,
  })

  const drawer = (
    <>
      <FreestyleMindMapImportDrawer
        mindMapImport={mindMapImport}
        targetNodeLabel={selectedAppendNode?.text ?? ''}
      />
      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent floating={false} className="max-w-sm" showCloseButton>
          <DialogHeader><DialogTitle>复制导图</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-2 p-4">
            <Button disabled={copying} onClick={() => void copyMap(false)}>导出导图</Button>
            <Button variant="outline" disabled={copying} onClick={() => void copyMap(true)}>导图 + 本宫殿全部题</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )

  return { onNodeActive, moreActions, drawer }
}
