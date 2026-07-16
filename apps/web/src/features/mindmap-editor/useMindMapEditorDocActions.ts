import { useCallback } from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapExtractPlacement } from '@/entities/mindmap-document'
import { toast } from '@/shared/feedback/toast'
import {
  addEditorDocChildWithResult,
  addEditorDocSiblingWithResult,
  buildSelectionFromDoc,
  canMoveEditorDocNode,
  countEditorDocSubtree,
  deleteEditorDocNode,
  deleteEditorDocNodeOnly,
  deleteEditorDocNodes,
  editEditorDocNode,
  extractEditorDocSelectionWithResult,
  moveEditorDocNode,
  relocateEditorDocNodes,
} from './documentGraphProjection'
import {
  selectedInteraction,
  type MindMapInteractionState,
} from './mindMapEditorSurfaceKeyboard'

type EditorDoc = MindMapEditorState['editor_doc']

export function useMindMapEditorDocActions(deps: {
  canEdit: boolean
  getCurrentEditorDoc: () => EditorDoc
  commitEditorDoc: (next: EditorDoc) => boolean
  commitEditorDocFrom: (base: EditorDoc, next: EditorDoc) => boolean
  stageEditorDoc: (next: EditorDoc) => boolean
  replaceInteraction: (next: MindMapInteractionState) => void
  onNodeActive?: (nodes: ReturnType<typeof buildSelectionFromDoc>) => void
  undoEditorDoc: () => void
}) {
  const {
    canEdit,
    getCurrentEditorDoc,
    commitEditorDoc,
    commitEditorDocFrom,
    stageEditorDoc,
    replaceInteraction,
    onNodeActive,
    undoEditorDoc,
  } = deps

  const handleAddChild = useCallback(
    (nodeId: string) => {
      const baseEditorDoc = getCurrentEditorDoc()
      const result = addEditorDocChildWithResult(baseEditorDoc, nodeId)
      if (!result.nodeUid || !stageEditorDoc(result.editorDoc)) return
      const selection = buildSelectionFromDoc(result.editorDoc, result.nodeUid)
      const text = selection[0]?.text || '新知识点'
      replaceInteraction({
        mode: 'editing',
        nodeId: result.nodeUid,
        originalText: text,
        draftText: text,
        selectAllOnStart: true,
        createdFromDoc: baseEditorDoc,
        returnNodeId: nodeId,
      })
      onNodeActive?.(selection)
    },
    [getCurrentEditorDoc, onNodeActive, replaceInteraction, stageEditorDoc],
  )

  const handleAddChildWithoutFocus = useCallback(
    (nodeId: string) => {
      const result = addEditorDocChildWithResult(getCurrentEditorDoc(), nodeId)
      if (!result.nodeUid || !commitEditorDoc(result.editorDoc)) return
      replaceInteraction(selectedInteraction(nodeId))
      onNodeActive?.(buildSelectionFromDoc(result.editorDoc, nodeId))
    },
    [commitEditorDoc, getCurrentEditorDoc, onNodeActive, replaceInteraction],
  )

  const handleAddSibling = useCallback(
    (nodeId: string) => {
      const baseEditorDoc = getCurrentEditorDoc()
      const result = addEditorDocSiblingWithResult(baseEditorDoc, nodeId)
      if (!result.nodeUid || !stageEditorDoc(result.editorDoc)) return
      const selection = buildSelectionFromDoc(result.editorDoc, result.nodeUid)
      const text = selection[0]?.text || '新知识点'
      replaceInteraction({
        mode: 'editing',
        nodeId: result.nodeUid,
        originalText: text,
        draftText: text,
        selectAllOnStart: true,
        createdFromDoc: baseEditorDoc,
        returnNodeId: nodeId,
      })
      onNodeActive?.(selection)
    },
    [getCurrentEditorDoc, onNodeActive, replaceInteraction, stageEditorDoc],
  )

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      const currentEditorDoc = getCurrentEditorDoc()
      const removedCount = countEditorDocSubtree(currentEditorDoc, nodeId)
      if (removedCount === 0) return
      const nextEditorDoc = deleteEditorDocNode(currentEditorDoc, nodeId)
      if (!commitEditorDoc(nextEditorDoc)) return
      replaceInteraction({ mode: 'idle' })
      onNodeActive?.([])
      toast.success(
        removedCount > 1 ? `已删除整条分支（${removedCount} 张卡片）` : '已删除卡片',
        { action: { label: '撤销', onClick: undoEditorDoc } },
      )
    },
    [commitEditorDoc, getCurrentEditorDoc, onNodeActive, replaceInteraction, undoEditorDoc],
  )

  const handleDeleteNodes = useCallback(
    (nodeIds: readonly string[]) => {
      const unique = [...new Set(nodeIds.filter(Boolean))]
      if (unique.length === 0) return
      if (unique.length === 1) {
        handleDeleteNode(unique[0]!)
        return
      }
      const currentEditorDoc = getCurrentEditorDoc()
      let removedCount = 0
      for (const nodeId of unique) {
        removedCount += countEditorDocSubtree(currentEditorDoc, nodeId)
      }
      if (removedCount === 0) return
      const nextEditorDoc = deleteEditorDocNodes(currentEditorDoc, unique)
      if (!commitEditorDoc(nextEditorDoc)) return
      replaceInteraction({ mode: 'idle' })
      onNodeActive?.([])
      toast.success(`已删除 ${unique.length} 处选中（共 ${removedCount} 张卡片）`, {
        action: { label: '撤销', onClick: undoEditorDoc },
      })
    },
    [commitEditorDoc, getCurrentEditorDoc, handleDeleteNode, onNodeActive, replaceInteraction, undoEditorDoc],
  )

  const handleDeleteNodeOnly = useCallback(
    (nodeId: string) => {
      const nextEditorDoc = deleteEditorDocNodeOnly(getCurrentEditorDoc(), nodeId)
      if (!commitEditorDoc(nextEditorDoc)) return
      replaceInteraction({ mode: 'idle' })
      onNodeActive?.([])
      toast.success('已单独删除卡片，子级已提升', {
        action: { label: '撤销', onClick: undoEditorDoc },
      })
    },
    [commitEditorDoc, getCurrentEditorDoc, onNodeActive, replaceInteraction, undoEditorDoc],
  )

  const handleEditNode = useCallback(
    (nodeId: string, text: string, currentInteraction: MindMapInteractionState) => {
      const trimmed = text.trim()
      if (trimmed) {
        const nextEditorDoc = editEditorDocNode(getCurrentEditorDoc(), nodeId, trimmed)
        if (
          currentInteraction.mode === 'editing' &&
          currentInteraction.nodeId === nodeId &&
          currentInteraction.createdFromDoc
        ) {
          commitEditorDocFrom(currentInteraction.createdFromDoc, nextEditorDoc)
        } else {
          commitEditorDoc(nextEditorDoc)
        }
      }
      replaceInteraction(selectedInteraction(nodeId))
    },
    [commitEditorDoc, commitEditorDocFrom, getCurrentEditorDoc, replaceInteraction],
  )

  const handleRelocateNodes = useCallback(
    (sourceIds: string[], targetId: string, mode: 'before' | 'inside' | 'after') => {
      const nextEditorDoc = relocateEditorDocNodes(
        getCurrentEditorDoc(),
        sourceIds,
        targetId,
        mode,
      )
      if (!commitEditorDoc(nextEditorDoc)) return
      const primaryId = sourceIds[0] ?? targetId
      replaceInteraction(selectedInteraction(primaryId, sourceIds))
      onNodeActive?.(buildSelectionFromDoc(nextEditorDoc, primaryId))
    },
    [commitEditorDoc, getCurrentEditorDoc, onNodeActive, replaceInteraction],
  )

  const handleExtractSelection = useCallback(
    (payload: {
      sourceId: string
      liveText: string
      start: number
      end: number
      placement: MindMapExtractPlacement
    }) => {
      if (!canEdit) return
      const result = extractEditorDocSelectionWithResult(
        getCurrentEditorDoc(),
        payload.sourceId,
        payload.liveText,
        payload.start,
        payload.end,
        payload.placement,
      )
      if (!result.nodeUid || !result.extractedText || !commitEditorDoc(result.editorDoc)) return
      const selection = buildSelectionFromDoc(result.editorDoc, result.nodeUid)
      const text = selection[0]?.text || result.extractedText
      replaceInteraction({
        mode: 'editing',
        nodeId: result.nodeUid,
        originalText: text,
        draftText: text,
        selectAllOnStart: true,
      })
      onNodeActive?.(selection)
      toast.success('已提取为新卡片', { action: { label: '撤销', onClick: undoEditorDoc } })
    },
    [canEdit, commitEditorDoc, getCurrentEditorDoc, onNodeActive, replaceInteraction, undoEditorDoc],
  )

  const handleReorderSibling = useCallback(
    (sourceId: string, targetId: string, position: 'before' | 'after') =>
      handleRelocateNodes([sourceId], targetId, position),
    [handleRelocateNodes],
  )

  const handleMoveUp = useCallback(
    (nodeId: string) => commitEditorDoc(moveEditorDocNode(getCurrentEditorDoc(), nodeId, 'up')),
    [commitEditorDoc, getCurrentEditorDoc],
  )

  const handleMoveDown = useCallback(
    (nodeId: string) => commitEditorDoc(moveEditorDocNode(getCurrentEditorDoc(), nodeId, 'down')),
    [commitEditorDoc, getCurrentEditorDoc],
  )

  const canMoveNodeUp = useCallback(
    (nodeId: string) => canMoveEditorDocNode(getCurrentEditorDoc(), nodeId, 'up'),
    [getCurrentEditorDoc],
  )

  const canMoveNodeDown = useCallback(
    (nodeId: string) => canMoveEditorDocNode(getCurrentEditorDoc(), nodeId, 'down'),
    [getCurrentEditorDoc],
  )

  return {
    handleAddChild,
    handleAddChildWithoutFocus,
    handleAddSibling,
    handleDeleteNode,
    handleDeleteNodes,
    handleDeleteNodeOnly,
    handleEditNode,
    handleRelocateNodes,
    handleExtractSelection,
    handleReorderSibling,
    handleMoveUp,
    handleMoveDown,
    canMoveNodeUp,
    canMoveNodeDown,
  }
}
