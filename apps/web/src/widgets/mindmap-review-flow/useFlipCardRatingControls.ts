import { useCallback, useEffect, useRef, useState } from 'react'
import type { MindMapRecallRating, MindMapRecallRound } from '@/shared/api/contracts'
import type { RatingConflictPolicy } from '@/features/review/api'
import { isEditableKeyboardTarget } from '@/shared/keyboard/keyboardTargets'
import type { SelectionToolbarAction } from '@/shared/ui/mindmap-canvas'
import {
  collectSubtreeUids,
  toGuidedSelection,
  type GuidedMindMapNode,
} from './flipCardGuidedModel'

const EMPTY_DIRECT_RATED: ReadonlySet<string> = new Set()

type PendingSubtreeRating = {
  nodeUid: string
  rating: MindMapRecallRating
  source: 'manual' | 'inferred'
  conflictCount: number
}

export type FlipCardRateNodeHandler = (
  nodeUid: string,
  rating: MindMapRecallRating,
  round: MindMapRecallRound,
  scope?: 'single' | 'subtree',
  evidence?: { source?: 'manual' | 'inferred'; confidence?: number | null; responseMs?: number | null },
  conflictPolicy?: RatingConflictPolicy,
) => void | Promise<void>

export function useFlipCardRatingControls({
  ratingMode,
  isEditMode,
  guidedNodes,
  rootUid,
  byUid,
  guidedCurrentNode,
  recallRound,
  directRatedUids,
  onRateNode,
  onUndoRating,
  onNodeActive,
  selectGuidedNode,
}: {
  ratingMode: boolean
  isEditMode: boolean
  guidedNodes: GuidedMindMapNode[]
  rootUid: string | null
  byUid: Map<string, GuidedMindMapNode>
  guidedCurrentNode: GuidedMindMapNode | null
  recallRound: MindMapRecallRound
  directRatedUids?: ReadonlySet<string>
  onRateNode?: FlipCardRateNodeHandler
  onUndoRating?: () => { node_uid: string } | null
  onNodeActive?: (nodes: ReturnType<typeof toGuidedSelection>[]) => void
  selectGuidedNode: (nodeUid: string | null, options?: { syncCanvas?: boolean }) => void
}) {
  const [inferredNodeUid, setInferredNodeUid] = useState<string | null>(null)
  const [pendingSubtreeRating, setPendingSubtreeRating] = useState<PendingSubtreeRating | null>(null)
  const nodeEnteredAtRef = useRef(0)
  const directRatedSet = directRatedUids ?? EMPTY_DIRECT_RATED

  useEffect(() => {
    nodeEnteredAtRef.current = Date.now()
  }, [guidedCurrentNode?.uid])

  const getRatingScopeForNode = useCallback(
    (nodeUid: string): 'single' | 'subtree' =>
      guidedNodes.some((node) => node.parentUid === nodeUid) ? 'subtree' : 'single',
    [guidedNodes],
  )

  const countAffectedNodes = useCallback(
    (nodeUid: string, scope: 'single' | 'subtree') => {
      if (scope === 'single') return nodeUid === rootUid ? 0 : 1
      return collectSubtreeUids(guidedNodes, nodeUid, rootUid).length
    },
    [guidedNodes, rootUid],
  )

  const countDirectConflicts = useCallback(
    (nodeUid: string) => {
      const subtree = collectSubtreeUids(guidedNodes, nodeUid, rootUid)
      return subtree.filter((uid) => uid !== nodeUid && directRatedSet.has(uid)).length
    },
    [directRatedSet, guidedNodes, rootUid],
  )

  const submitRateNodeUid = useCallback(
    (
      nodeUid: string,
      rating: MindMapRecallRating,
      source: 'manual' | 'inferred' = 'manual',
      conflictPolicy: RatingConflictPolicy = 'overwrite',
    ) => {
      if (!ratingMode || !onRateNode) return
      const scope = getRatingScopeForNode(nodeUid)
      void onRateNode(
        nodeUid,
        rating,
        recallRound,
        scope,
        {
          source,
          confidence: source === 'inferred' ? 0.35 : null,
          responseMs: Math.max(0, Date.now() - nodeEnteredAtRef.current),
        },
        conflictPolicy,
      )
      if (source === 'inferred') setInferredNodeUid(nodeUid)
      else setInferredNodeUid(null)
      const node = byUid.get(nodeUid)
      if (node) onNodeActive?.([toGuidedSelection(node)])
    },
    [byUid, getRatingScopeForNode, onNodeActive, onRateNode, ratingMode, recallRound],
  )

  const handleRateNodeUid = useCallback(
    (nodeUid: string, rating: MindMapRecallRating, source: 'manual' | 'inferred' = 'manual') => {
      if (!ratingMode || !onRateNode) return
      const scope = getRatingScopeForNode(nodeUid)
      if (scope === 'subtree') {
        const conflictCount = countDirectConflicts(nodeUid)
        if (conflictCount > 0) {
          setPendingSubtreeRating({ nodeUid, rating, source, conflictCount })
          return
        }
      }
      submitRateNodeUid(nodeUid, rating, source, 'overwrite')
    },
    [countDirectConflicts, getRatingScopeForNode, onRateNode, ratingMode, submitRateNodeUid],
  )

  const handleGuidedRating = useCallback(
    (rating: MindMapRecallRating, source: 'manual' | 'inferred' = 'manual') => {
      if (!guidedCurrentNode) return
      handleRateNodeUid(guidedCurrentNode.uid, rating, source)
    },
    [guidedCurrentNode, handleRateNodeUid],
  )

  const resolvePendingSubtreeRating = useCallback(
    (policy: RatingConflictPolicy | 'cancel') => {
      const pending = pendingSubtreeRating
      setPendingSubtreeRating(null)
      if (!pending || policy === 'cancel') return
      submitRateNodeUid(pending.nodeUid, pending.rating, pending.source, policy)
    },
    [pendingSubtreeRating, submitRateNodeUid],
  )

  const handleUndoRating = useCallback(() => {
    const latest = onUndoRating?.()
    if (latest?.node_uid) selectGuidedNode(latest.node_uid, { syncCanvas: true })
  }, [onUndoRating, selectGuidedNode])

  const buildSelectionToolbarActions = useCallback(
    (nodeId: string): SelectionToolbarAction[] => {
      if (!ratingMode || !onRateNode || isEditMode || !nodeId) return []
      const scope = getRatingScopeForNode(nodeId)
      const count = countAffectedNodes(nodeId, scope)
      const actions: SelectionToolbarAction[] = []
      if (onUndoRating) {
        actions.push({
          id: 'undo',
          label: '撤销',
          variant: 'ghost',
          onClick: handleUndoRating,
        })
      }
      if (inferredNodeUid === nodeId) {
        actions.push({
          id: 'inferred-hint',
          label: '已自动记为模糊',
          variant: 'ghost',
          disabled: true,
          onClick: () => {},
        })
      }
      actions.push(
        { id: 'rate-1', label: `忘记 · ${count}`, variant: 'destructive', onClick: () => handleRateNodeUid(nodeId, 1) },
        { id: 'rate-2', label: `困难 · ${count}`, variant: 'outline', onClick: () => handleRateNodeUid(nodeId, 2) },
        { id: 'rate-3', label: `记得 · ${count}`, variant: 'default', onClick: () => handleRateNodeUid(nodeId, 3) },
        { id: 'rate-4', label: `轻松 · ${count}`, variant: 'secondary', onClick: () => handleRateNodeUid(nodeId, 4) },
      )
      return actions
    },
    [
      countAffectedNodes,
      getRatingScopeForNode,
      handleRateNodeUid,
      handleUndoRating,
      inferredNodeUid,
      isEditMode,
      onRateNode,
      onUndoRating,
      ratingMode,
    ],
  )

  useEffect(() => {
    if (isEditMode || !ratingMode || !onRateNode) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (isEditableKeyboardTarget(event.target) || pendingSubtreeRating || document.querySelector('[role="dialog"]')) return
      if (event.key === 'Backspace' && onUndoRating) {
        event.preventDefault()
        handleUndoRating()
        return
      }
      const key = event.key.toLowerCase()
      const rating =
        key === '1' || key === 'j'
          ? 1
          : key === '2' || key === 'k'
            ? 2
            : key === '3' || key === 'l'
              ? 3
              : key === '4' || key === ';'
                ? 4
                : null
      if (!rating || !guidedCurrentNode) return
      event.preventDefault()
      handleGuidedRating(rating)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    guidedCurrentNode,
    handleGuidedRating,
    handleUndoRating,
    isEditMode,
    onRateNode,
    onUndoRating,
    pendingSubtreeRating,
    ratingMode,
  ])

  return {
    pendingSubtreeRating,
    resolvePendingSubtreeRating,
    buildSelectionToolbarActions,
    handleGuidedRating,
    handleRateNodeUid,
    handleUndoRating,
  }
}
