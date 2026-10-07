import { useCallback, type MutableRefObject } from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapSelection } from '@/modules/content/domain/mindmap-document-entity'
import { buildSelectionFromDoc, editEditorDocNode, getEditorDocStoredText } from './documentGraphProjection'
import {
  selectedInteraction,
  type MindMapInteractionState,
} from './mindMapEditorSurfaceKeyboard'

interface UseMindMapNodeEditingOptions {
  interactionRef: MutableRefObject<MindMapInteractionState>
  replaceInteraction: (next: MindMapInteractionState) => void
  getCurrentEditorDoc: () => MindMapEditorState['editor_doc']
  commitEditorDoc: (editorDoc: MindMapEditorState['editor_doc']) => void
  commitEditorDocFrom: (
    baseEditorDoc: MindMapEditorState['editor_doc'],
    editorDoc: MindMapEditorState['editor_doc'],
  ) => void
  stageEditorDoc: (editorDoc: MindMapEditorState['editor_doc']) => void
  onNodeActive?: (nodes: MindMapSelection[]) => void
}

/**
 * The node-text editing session: begin → type → commit/cancel.
 *
 * Keystrokes deliberately stay on `interactionRef` rather than React state. Lifting
 * each one into state rebuilt the editor surface and the canvas and fingerprinted
 * the whole palace document, so the live editor is owned by NodeCard and only the
 * commit reads the ref.
 */
export function useMindMapNodeEditing({
  interactionRef,
  replaceInteraction,
  getCurrentEditorDoc,
  commitEditorDoc,
  commitEditorDocFrom,
  stageEditorDoc,
  onNodeActive,
}: UseMindMapNodeEditingOptions) {
  const commitEditingDraft = useCallback(() => {
    const current = interactionRef.current
    if (current.mode !== 'editing') return
    const text = current.draftText.trim()
    if (text && text !== current.originalText) {
      const nextEditorDoc = editEditorDocNode(getCurrentEditorDoc(), current.nodeId, text)
      if (current.createdFromDoc) commitEditorDocFrom(current.createdFromDoc, nextEditorDoc)
      else commitEditorDoc(nextEditorDoc)
    } else if (current.createdFromDoc) {
      commitEditorDocFrom(current.createdFromDoc, getCurrentEditorDoc())
    }
    replaceInteraction(selectedInteraction(current.nodeId))
  }, [
    commitEditorDoc,
    commitEditorDocFrom,
    getCurrentEditorDoc,
    interactionRef,
    replaceInteraction,
  ])

  const cancelEditing = useCallback(() => {
    const current = interactionRef.current
    if (current.mode !== 'editing') return
    if (current.createdFromDoc) {
      stageEditorDoc(current.createdFromDoc)
      const returnNodeId = current.returnNodeId ?? null
      replaceInteraction(returnNodeId ? selectedInteraction(returnNodeId) : { mode: 'idle' })
      onNodeActive?.(buildSelectionFromDoc(current.createdFromDoc, returnNodeId))
      return
    }
    replaceInteraction(selectedInteraction(current.nodeId))
  }, [interactionRef, onNodeActive, replaceInteraction, stageEditorDoc])

  const beginEditingNode = useCallback(
    (nodeId: string) => {
      const current = interactionRef.current
      if (current.mode === 'editing' && current.nodeId === nodeId) {
        // Re-assert editing so a desynced card (e.g. after yellow-emphasis double-click
        // races) remounts the editor instead of silently no-oping.
        replaceInteraction({ ...current })
        return
      }
      if (current.mode === 'editing' && current.nodeId !== nodeId) commitEditingDraft()
      const editorDoc = getCurrentEditorDoc()
      const selection = buildSelectionFromDoc(editorDoc, nodeId)
      // Prefer stored markup (yellow emphasis HTML) so double-click edit keeps highlights.
      const stored = getEditorDocStoredText(editorDoc, nodeId).trim()
      const text = stored || selection[0]?.text || '未命名知识点'
      replaceInteraction({
        mode: 'editing',
        nodeId,
        originalText: text,
        draftText: text,
        selectAllOnStart: false,
      })
      onNodeActive?.(selection)
    },
    [
      commitEditingDraft,
      getCurrentEditorDoc,
      interactionRef,
      onNodeActive,
      replaceInteraction,
    ],
  )

  const updateEditingDraft = useCallback(
    (nodeId: string, draftText: string) => {
      const current = interactionRef.current
      if (current.mode !== 'editing' || current.nodeId !== nodeId) return
      if (current.draftText === draftText) return
      // See the hook docstring: keystrokes stay on the ref on purpose.
      interactionRef.current = { ...current, draftText }
    },
    [interactionRef],
  )

  return { commitEditingDraft, cancelEditing, beginEditingNode, updateEditingDraft }
}
