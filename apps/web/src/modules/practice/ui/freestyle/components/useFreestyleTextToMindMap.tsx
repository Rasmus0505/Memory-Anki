import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { MindMapSelection } from '@/modules/content/public'
import { readClipboardTextForMindMapImport, useMindMapImport } from '@/modules/produce/public'
import type { RevealState } from '@/modules/session/public'
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
  permanentMarkMode: boolean
  permanentMarkHighlightsLength: number
  handleTogglePermanentMarkMode: () => void
  savingEdit: boolean
  onRevealMapChange?: (revealMap: Record<string, string>) => void
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
  permanentMarkMode,
  permanentMarkHighlightsLength,
  handleTogglePermanentMarkMode,
  savingEdit,
  onRevealMapChange,
  revealApiRef,
  displayModeRef,
  editRevealSnapshotRef,
  setPermanentMarkMode,
  setDisplayMode,
  setModeSyncVersion,
  handleEditorStateChange,
}: UseFreestyleTextToMindMapOptions) {
  const [selectedAppendNode, setSelectedAppendNode] = useState<{ uid: string; text: string } | null>(null)
  const onNodeActive = useCallback((nodes: MindMapSelection[]) => {
    const node = nodes[0]
    setSelectedAppendNode(node?.uid ? { uid: node.uid, text: node.text || '' } : null)
  }, [])
  const liveEditorState = isEditMode ? editEditorState : editorState
  const applyImportedEditorState = useCallback((nextState: MindMapEditorState) => {
    if (displayModeRef.current !== 'edit') {
      editRevealSnapshotRef.current = { ...revealApiRef.current.revealMap }
      onRevealMapChange?.(revealApiRef.current.revealMap)
      setPermanentMarkMode(false)
      setDisplayMode('edit')
      setModeSyncVersion((value) => value + 1)
    }
    handleEditorStateChange(nextState)
  }, [
    displayModeRef,
    editRevealSnapshotRef,
    handleEditorStateChange,
    onRevealMapChange,
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
    permanentMarkMode,
    permanentMarkHighlightsLength,
    handleTogglePermanentMarkMode,
    savingEdit,
    onTextToMindMap: openTextToMindMap,
  })

  const drawer = (
    <>
      <FreestyleMindMapImportDrawer
        mindMapImport={mindMapImport}
        targetNodeLabel={selectedAppendNode?.text ?? ''}
      />
      {mindMapImport.aiRunConfigDialog}
    </>
  )

  return { onNodeActive, moreActions, drawer }
}
