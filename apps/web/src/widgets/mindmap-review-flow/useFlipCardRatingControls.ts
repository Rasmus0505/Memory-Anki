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
const EMPTY_RATEABLE: ReadonlySet<string> | null = null

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
  rateableNodeUids,
  onRateNode,
  onUndoRating,
  onNodeActive,
  selectGuidedNode,
  onCollapseAfterForgot,
}: {
  ratingMode: boolean
  isEditMode: boolean
  guidedNodes: GuidedMindMapNode[]
  rootUid: string | null
  byUid: Map<string, GuidedMindMapNode>
  guidedCurrentNode: GuidedMindMapNode | null
  recallRound: MindMapRecallRound
  directRatedUids?: ReadonlySet<string>
  /** When set, only these UIDs may be rated (formal due / node-review scope). */
  rateableNodeUids?: ReadonlySet<string> | null
  onRateNode?: FlipCardRateNodeHandler
  onUndoRating?: () => { node_uid: string } | null
  onNodeActive?: (nodes: ReturnType<typeof toGuidedSelection>[]) => void
  selectGuidedNode: (nodeUid: string | null, options?: { syncCanvas?: boolean }) => void
  /** Only for rating=1 (忘记): collapse/hide the card branch after a successful rate. */
  onCollapseAfterForgot?: (nodeUid: string) => void
}) {
  const [inferredNodeUid, setInferredNodeUid] = useState<string | null>(null)
  const [pendingSubtreeRating, setPendingSubtreeRating] = useState<PendingSubtreeRating | null>(null)
  const nodeEnteredAtRef = useRef(0)
  const directRatedSet = directRatedUids ?? EMPTY_DIRECT_RATED
  const rateableSet = rateableNodeUids ?? EMPTY_RATEABLE

  const isRateableNode = useCallback(
    (nodeUid: string) => {
      // Practice / unrestricted rating keeps root subtree cascade available.
      if (!rateableSet) return true
      return rateableSet.has(nodeUid)
    },
    [rateableSet],
  )

  useEffect(() => {
    nodeEnteredAtRef.current = Date.now()
  }, [guidedCurrentNode?.uid])

  const getRatingScopeForNode = useCallback(
    (nodeUid: string): 'single' | 'subtree' => {
      // Formal due-scope: only rate the selected due node itself so non-due
      // (muted) descendants are not cascade-scheduled from a parent click.
      if (rateableSet) return 'single'
      return guidedNodes.some((node) => node.parentUid === nodeUid) ? 'subtree' : 'single'
    },
    [guidedNodes, rateableSet],
  )

  const countAffectedNodes = useCallback(
    (nodeUid: string, scope: 'single' | 'subtree') => {
      if (!isRateableNode(nodeUid)) return 0
      if (scope === 'single') return 1
      return collectSubtreeUids(guidedNodes, nodeUid, rootUid).filter((uid) => isRateableNode(uid)).length
    },
    [guidedNodes, isRateableNode, rootUid],
  )

  const countDirectConflicts = useCallback(
    (nodeUid: string) => {
      const subtree = collectSubtreeUids(guidedNodes, nodeUid, rootUid).filter((uid) => isRateableNode(uid))
      return subtree.filter((uid) => uid !== nodeUid && directRatedSet.has(uid)).length
    },
    [directRatedSet, guidedNodes, isRateableNode, rootUid],
  )

  const submitRateNodeUid = useCallback(
    (
      nodeUid: string,
      rating: MindMapRecallRating,
      source: 'manual' | 'inferred' = 'manual',
      conflictPolicy: RatingConflictPolicy = 'overwrite',
    ) => {
      if (!ratingMode || !onRateNode || !isRateableNode(nodeUid)) return
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
      // 忘记：允许收起分支；困难/记得/轻松：保持选中，评分条不消失。
      if (rating === 1) {
        onCollapseAfterForgot?.(nodeUid)
      } else if (node) {
        onNodeActive?.([toGuidedSelection(node)])
        selectGuidedNode(nodeUid, { syncCanvas: false })
      }
    },
    [
      byUid,
      getRatingScopeForNode,
      isRateableNode,
      onCollapseAfterForgot,
      onNodeActive,
      onRateNode,
      ratingMode,
      recallRound,
      selectGuidedNode,
    ],
  )

  const handleRateNodeUid = useCallback(
    (nodeUid: string, rating: MindMapRecallRating, source: 'manual' | 'inferred' = 'manual') => {
      if (!ratingMode || !onRateNode || !isRateableNode(nodeUid)) return
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
    [countDirectConflicts, getRatingScopeForNode, isRateableNode, onRateNode, ratingMode, submitRateNodeUid],
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
      if (!isRateableNode(nodeId)) {
        const actions: SelectionToolbarAction[] = []
        if (onUndoRating) {
          actions.push({
            id: 'undo',
            label: '撤销',
            variant: 'ghost',
            onClick: handleUndoRating,
          })
        }
        actions.push({
          id: 'out-of-scope',
          label: '非本轮复习节点',
          variant: 'ghost',
          disabled: true,
          onClick: () => {},
        })
        return actions
      }
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
      isRateableNode,
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
      if (!rating || !guidedCurrentNode || !isRateableNode(guidedCurrentNode.uid)) return
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
    isRateableNode,
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
