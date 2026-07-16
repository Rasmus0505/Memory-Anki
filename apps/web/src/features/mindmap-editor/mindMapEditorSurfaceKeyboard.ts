import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import {
  isEditableKeyboardTarget,
  isNonNodeInteractiveTarget,
} from './mindMapEditorSurfaceDom'

export type MindMapInteractionState =
  | { mode: 'idle' }
  | { mode: 'selected'; nodeIds: string[]; primaryId: string }
  | {
      mode: 'editing'
      nodeId: string
      originalText: string
      draftText: string
      selectAllOnStart?: boolean
      createdFromDoc?: MindMapEditorState['editor_doc']
      returnNodeId?: string
    }

export function selectedInteraction(
  primaryId: string,
  nodeIds?: readonly string[],
): MindMapInteractionState {
  const ids = [...new Set((nodeIds?.length ? nodeIds : [primaryId]).filter(Boolean))]
  if (ids.length === 0) return { mode: 'idle' }
  const nextPrimary = ids.includes(primaryId) ? primaryId : ids[ids.length - 1]!
  return { mode: 'selected', nodeIds: ids, primaryId: nextPrimary }
}

export function createMindMapCanvasKeyDownHandler(deps: {
  canEdit: boolean
  selectedNodeId: string | null
  selectedNodeIds: string[]
  editingNodeId: string | null
  graphNodes: Array<{ id: string; parentId?: string | null }>
  undoEditorDoc: () => void
  redoEditorDoc: () => void
  handleAddChildWithoutFocus: (nodeId: string) => void
  handleAddSibling: (nodeId: string) => void
  beginEditingNode: (nodeId: string) => void
  handleDeleteNodes: (nodeIds: string[]) => void
  pendingKeyboardFocusNodeIdRef: { current: string | null }
}) {
  return (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!deps.canEdit) return
    const target = event.target instanceof HTMLElement ? event.target : null
    if (isEditableKeyboardTarget(target)) return

    const primaryModifier = event.ctrlKey || event.metaKey
    const lowerKey = event.key.toLowerCase()
    if (primaryModifier && lowerKey === 'z') {
      event.preventDefault()
      if (event.shiftKey) deps.redoEditorDoc()
      else deps.undoEditorDoc()
      return
    }
    if (primaryModifier && lowerKey === 'y') {
      event.preventDefault()
      deps.redoEditorDoc()
      return
    }
    if (isNonNodeInteractiveTarget(target)) return
    if (!deps.selectedNodeId || deps.editingNodeId || event.repeat) return
    const selectedNode = deps.graphNodes.find((node) => node.id === deps.selectedNodeId)
    if (!selectedNode) return
    const multiSelected = deps.selectedNodeIds.length > 1

    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (multiSelected) return
      event.preventDefault()
      deps.pendingKeyboardFocusNodeIdRef.current = deps.selectedNodeId
      deps.handleAddChildWithoutFocus(deps.selectedNodeId)
      return
    }
    if (
      event.key === 'Enter' &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      selectedNode.parentId != null
    ) {
      if (multiSelected) return
      event.preventDefault()
      deps.handleAddSibling(deps.selectedNodeId)
      return
    }
    if (
      (event.key === 'Enter' || event.key === 'F2') &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      if (multiSelected) return
      event.preventDefault()
      deps.beginEditingNode(deps.selectedNodeId)
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      const deletableIds = deps.selectedNodeIds.filter((id) => {
        const node = deps.graphNodes.find((item) => item.id === id)
        return node != null && node.parentId != null
      })
      if (deletableIds.length === 0) return
      event.preventDefault()
      deps.handleDeleteNodes(deletableIds)
    }
  }
}
