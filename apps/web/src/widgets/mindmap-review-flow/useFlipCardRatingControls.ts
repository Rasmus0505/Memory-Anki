import { useCallback, useEffect, useRef, useState } from 'react'
import type { MindMapRecallRating, MindMapRecallRound } from '@/shared/api/contracts'
import type { RatingConflictPolicy } from '@/modules/practice/public'
import { isEditableKeyboardTarget } from '@/shared/keyboard/keyboardTargets'
import type { SelectionToolbarAction } from '@/shared/ui/mindmap-canvas'
import {
  collectSubtreeUids,
  toGuidedSelection,
  type GuidedMindMapNode,
} from './flipCardGuidedModel'
import type { RatingSubtreeDialogChoice } from './RatingSubtreeConflictOverlay'

const EMPTY_DIRECT_RATED: ReadonlySet<string> = new Set()
const EMPTY_SESSION_RATED: ReadonlySet<string> = new Set()
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
  sessionRatedUids,
  rateableNodeUids,
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
  /** Any node with a score this round (direct or batch_inherited). Used for 避开 skip set size. */
  sessionRatedUids?: ReadonlySet<string>
  /** When set, only these UIDs may be rated (formal due / node-review scope). */
  rateableNodeUids?: ReadonlySet<string> | null
  onRateNode?: FlipCardRateNodeHandler
  onUndoRating?: () => { node_uid: string } | null
  onNodeActive?: (nodes: ReturnType<typeof toGuidedSelection>[]) => void
  selectGuidedNode: (nodeUid: string | null, options?: { syncCanvas?: boolean }) => void
}) {
  const [inferredNodeUid, setInferredNodeUid] = useState<string | null>(null)
  const [pendingSubtreeRating, setPendingSubtreeRating] = useState<PendingSubtreeRating | null>(null)
  const nodeEnteredAtRef = useRef(0)
  const directRatedSet = directRatedUids ?? EMPTY_DIRECT_RATED
  const sessionRatedSet = sessionRatedUids ?? EMPTY_SESSION_RATED
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
      // rateableSet only gates *who can start* a rating. Parent ratings still
      // cascade on the full rating tree (including unrevealed due children),
      // matching backend formal subtree behavior.
      return guidedNodes.some((node) => node.parentUid === nodeUid) ? 'subtree' : 'single'
    },
    [guidedNodes],
  )

  const countAffectedNodes = useCallback(
    (nodeUid: string, scope: 'single' | 'subtree') => {
      if (!isRateableNode(nodeUid)) return 0
      if (scope === 'single') return 1
      // Count full cascade targets (revealed or not). Backend subtree updates
      // all non-root descendants, not only frozen-due / currently visible ones.
      return collectSubtreeUids(guidedNodes, nodeUid, rootUid).length
    },
    [guidedNodes, isRateableNode, rootUid],
  )

  const countSubtreeConflicts = useCallback(
    (nodeUid: string) => {
      // Prompt whenever *any* descendant already has a score this round — direct
      // or batch_inherited. Re-rating a parent after its own cascade (or after a
      // child subtree score) must still ask 覆盖/避开; silent re-cascade would
      // hide that choice. Count matches backend skip_direct skip-set size.
      const subtree = collectSubtreeUids(guidedNodes, nodeUid, rootUid).filter(
        (uid) => uid !== nodeUid,
      )
      const ratedSet = sessionRatedSet.size > 0 ? sessionRatedSet : directRatedSet
      return subtree.filter((uid) => ratedSet.has(uid)).length
    },
    [directRatedSet, guidedNodes, rootUid, sessionRatedSet],
  )

  const submitRateNodeUid = useCallback(
    (
      nodeUid: string,
      rating: MindMapRecallRating,
      source: 'manual' | 'inferred' = 'manual',
      conflictPolicy: RatingConflictPolicy = 'overwrite',
      scopeOverride?: 'single' | 'subtree',
    ) => {
      if (!ratingMode || !onRateNode || !isRateableNode(nodeUid)) return
      const scope = scopeOverride ?? getRatingScopeForNode(nodeUid)
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
        // Single-node rating has no cascade conflicts to resolve.
        scope === 'single' ? 'overwrite' : conflictPolicy,
      )
      if (source === 'inferred') setInferredNodeUid(nodeUid)
      else setInferredNodeUid(null)
      // Rating mode is score-only: never collapse/hide/placeholder-flip the card.
      // Keep selection so the toolbar stays on the node the user just scored.
      const node = byUid.get(nodeUid)
      if (node) {
        onNodeActive?.([toGuidedSelection(node)])
        selectGuidedNode(nodeUid, { syncCanvas: false })
      }
    },
    [
      byUid,
      getRatingScopeForNode,
      isRateableNode,
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
      // Any parent with children opens the scope dialog (not only when conflicts exist).
      if (scope === 'subtree') {
        const conflictCount = countSubtreeConflicts(nodeUid)
        setPendingSubtreeRating({ nodeUid, rating, source, conflictCount })
        return
      }
      submitRateNodeUid(nodeUid, rating, source, 'overwrite', 'single')
    },
    [countSubtreeConflicts, getRatingScopeForNode, isRateableNode, onRateNode, ratingMode, submitRateNodeUid],
  )

  const handleGuidedRating = useCallback(
    (rating: MindMapRecallRating, source: 'manual' | 'inferred' = 'manual') => {
      if (!guidedCurrentNode) return
      handleRateNodeUid(guidedCurrentNode.uid, rating, source)
    },
    [guidedCurrentNode, handleRateNodeUid],
  )

  const resolvePendingSubtreeRating = useCallback(
    (policy: RatingSubtreeDialogChoice) => {
      const pending = pendingSubtreeRating
      setPendingSubtreeRating(null)
      if (!pending || policy === 'cancel') return
      if (policy === 'single') {
        submitRateNodeUid(pending.nodeUid, pending.rating, pending.source, 'overwrite', 'single')
        return
      }
      submitRateNodeUid(pending.nodeUid, pending.rating, pending.source, policy, 'subtree')
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
      if (
        isEditableKeyboardTarget(event.target) ||
        pendingSubtreeRating ||
        (event.target instanceof Element && event.target.closest('[role="dialog"]')) ||
        Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'))
      ) {
        return
      }
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
