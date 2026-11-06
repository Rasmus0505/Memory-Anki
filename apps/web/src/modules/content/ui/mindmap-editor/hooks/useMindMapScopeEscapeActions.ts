import { useCallback } from 'react'
import type { MindMapBranchScope } from '@/modules/content/domain/mindmap-document-entity/model/subtree'

type NodeAction = (nodeId: string) => void
type NodesAction = (nodeIds: string[]) => void
type RelocateAction = (
  sourceIds: string[],
  targetId: string,
  mode: 'before' | 'inside' | 'after',
) => void

export interface UseMindMapScopeEscapeActionsOptions {
  branchScope: MindMapBranchScope | null
  onRequestFullScope?: () => void
  /** Dedupes the effect of several structure actions in one interaction. */
  scopeEscapeRef: { current: boolean }
  handleAddChild: NodeAction
  handleAddChildWithoutFocus: NodeAction
  handleInsertChildLayer: NodeAction
  handleAddSibling: NodeAction
  handleDeleteNode: NodeAction
  handleDeleteNodes: NodesAction
  handleDeleteNodeOnly: NodeAction
  handleDeleteNodesOnly: NodesAction
  handleMoveUp: NodeAction
  handleMoveDown: NodeAction
  handleRelocateNodes: RelocateAction
}

/**
 * The scoped projection only hides sibling branches; it must not shorten the
 * menu. A structure row on a spine card asks the host to show the whole
 * palace, then runs, so the card it creates or removes stays visible.
 */
export function useMindMapScopeEscapeActions({
  branchScope,
  onRequestFullScope,
  scopeEscapeRef,
  handleAddChild,
  handleAddChildWithoutFocus,
  handleInsertChildLayer,
  handleAddSibling,
  handleDeleteNode,
  handleDeleteNodes,
  handleDeleteNodeOnly,
  handleDeleteNodesOnly,
  handleMoveUp,
  handleMoveDown,
  handleRelocateNodes,
}: UseMindMapScopeEscapeActionsOptions) {
  const runOutsideScope = useCallback(
    (escapes: boolean, run: () => void) => {
      if (!escapes || !onRequestFullScope) {
        run()
        return
      }
      onRequestFullScope()
      scopeEscapeRef.current = true
      try {
        run()
      } finally {
        scopeEscapeRef.current = false
      }
    },
    [onRequestFullScope, scopeEscapeRef],
  )

  const escapesStructure = useCallback(
    (nodeId: string) => Boolean(branchScope)
      && (!branchScope!.subtreeUids.has(nodeId) || nodeId === branchScope!.branchUid),
    [branchScope],
  )

  const addChildOutsideScope = useCallback(
    (nodeId: string) => runOutsideScope(
      Boolean(branchScope) && !branchScope!.subtreeUids.has(nodeId),
      () => handleAddChild(nodeId),
    ),
    [branchScope, handleAddChild, runOutsideScope],
  )
  const addChildWithoutFocusOutsideScope = useCallback(
    (nodeId: string) => runOutsideScope(
      Boolean(branchScope) && !branchScope!.subtreeUids.has(nodeId),
      () => handleAddChildWithoutFocus(nodeId),
    ),
    [branchScope, handleAddChildWithoutFocus, runOutsideScope],
  )
  const insertChildLayerOutsideScope = useCallback(
    (nodeId: string) => runOutsideScope(
      Boolean(branchScope) && !branchScope!.subtreeUids.has(nodeId),
      () => handleInsertChildLayer(nodeId),
    ),
    [branchScope, handleInsertChildLayer, runOutsideScope],
  )
  const addSiblingOutsideScope = useCallback(
    (nodeId: string) => runOutsideScope(escapesStructure(nodeId), () => handleAddSibling(nodeId)),
    [escapesStructure, handleAddSibling, runOutsideScope],
  )
  const deleteNodeOutsideScope = useCallback(
    (nodeId: string) => runOutsideScope(escapesStructure(nodeId), () => handleDeleteNode(nodeId)),
    [escapesStructure, handleDeleteNode, runOutsideScope],
  )
  const deleteNodesOutsideScope = useCallback(
    (nodeIds: string[]) => runOutsideScope(
      nodeIds.some((nodeId) => escapesStructure(nodeId)),
      () => handleDeleteNodes(nodeIds),
    ),
    [escapesStructure, handleDeleteNodes, runOutsideScope],
  )
  const deleteNodeOnlyOutsideScope = useCallback(
    (nodeId: string) => runOutsideScope(escapesStructure(nodeId), () => handleDeleteNodeOnly(nodeId)),
    [escapesStructure, handleDeleteNodeOnly, runOutsideScope],
  )
  const deleteNodesOnlyOutsideScope = useCallback(
    (nodeIds: string[]) => runOutsideScope(
      nodeIds.some((nodeId) => escapesStructure(nodeId)),
      () => handleDeleteNodesOnly(nodeIds),
    ),
    [escapesStructure, handleDeleteNodesOnly, runOutsideScope],
  )
  const moveUpOutsideScope = useCallback(
    (nodeId: string) => runOutsideScope(escapesStructure(nodeId), () => handleMoveUp(nodeId)),
    [escapesStructure, handleMoveUp, runOutsideScope],
  )
  const moveDownOutsideScope = useCallback(
    (nodeId: string) => runOutsideScope(escapesStructure(nodeId), () => handleMoveDown(nodeId)),
    [escapesStructure, handleMoveDown, runOutsideScope],
  )
  const relocateOutsideScope = useCallback(
    (sourceIds: string[], targetId: string, mode: 'before' | 'inside' | 'after') => runOutsideScope(
      sourceIds.some((nodeId) => escapesStructure(nodeId)) || escapesStructure(targetId),
      () => handleRelocateNodes(sourceIds, targetId, mode),
    ),
    [escapesStructure, handleRelocateNodes, runOutsideScope],
  )
  const reorderSiblingOutsideScope = useCallback(
    (sourceId: string, targetId: string, position: 'before' | 'after') => (
      relocateOutsideScope([sourceId], targetId, position)
    ),
    [relocateOutsideScope],
  )

  return {
    runOutsideScope,
    escapesStructure,
    addChildOutsideScope,
    addChildWithoutFocusOutsideScope,
    insertChildLayerOutsideScope,
    addSiblingOutsideScope,
    deleteNodeOutsideScope,
    deleteNodesOutsideScope,
    deleteNodeOnlyOutsideScope,
    deleteNodesOnlyOutsideScope,
    moveUpOutsideScope,
    moveDownOutsideScope,
    relocateOutsideScope,
    reorderSiblingOutsideScope,
  }
}
