import * as React from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapSelection } from '@/modules/content/public'
import { useRevealSession } from '@/modules/memory/public'
import { revealRemainingNodes, type ReviewFlowSnapshot } from '@/modules/memory/public'
import { useReviewFeedback } from '@/modules/memory/public'
import type { RevealFlowMode } from '@/modules/memory/public'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import type { CompleteFlowPayload } from '@/modules/practice/ui/review/model/mind-map-review-flow'
import { useFlipCardRevealSettings } from '@/modules/settings/public'

interface UseReviewFlowSessionOptions {
  title: string
  sessionKind: 'practice' | 'review'
  revealMode?: RevealFlowMode
  checkpointNodeUids?: Iterable<string>
  /** Formal review frozen due UIDs — auto-reveal non-due cards on entry. */
  focusNodeUids?: Iterable<string>
  editorState: MindMapEditorState
  onComplete: (payload: CompleteFlowPayload) => void | Promise<void>
  onRestart?: () => boolean | void | Promise<boolean | void>
  initialSnapshot?: ReviewFlowSnapshot | null
  onSnapshotChange?: (snapshot: ReviewFlowSnapshot) => void
  onFullscreenChange?: (active: boolean) => void
}

const EMPTY_CHECKPOINT_NODE_UIDS: string[] = []
const EMPTY_FOCUS_NODE_UIDS: string[] = []
export function useReviewFlowSession({
  title,
  sessionKind,
  revealMode = 'standard',
  checkpointNodeUids = EMPTY_CHECKPOINT_NODE_UIDS,
  focusNodeUids = EMPTY_FOCUS_NODE_UIDS,
  editorState,
  onComplete,
  onRestart,
  initialSnapshot = null,
  onSnapshotChange,
  onFullscreenChange,
}: UseReviewFlowSessionOptions) {
  const { isActive } = useRouteResidency()
  const [fullscreen, setFullscreen] = React.useState(false)
  const flipCardRevealSettings = useFlipCardRevealSettings()
  const reveal = useRevealSession({
    title,
    editorState,
    initialSnapshot,
    resetCompletedOnDocChange: sessionKind === 'review',
    mode: revealMode,
    checkpointIds: checkpointNodeUids,
    focusNodeIds: sessionKind === 'review' ? focusNodeUids : EMPTY_FOCUS_NODE_UIDS,
    revealConfig: flipCardRevealSettings.settings,
  })
  const feedback = useReviewFeedback({
    root: reveal.root,
    revealMap: reveal.revealMap,
    revealedNonRootCount: reveal.revealedNonRootCount,
    totalNodeCount: reveal.totalNodeCount,
    revealMode,
  })
  const completionPendingRef = React.useRef(false)
  const lastSnapshotPayloadRef = React.useRef('')

  React.useEffect(() => {
    if (isActive) return
    setFullscreen(false)
  }, [isActive])

  React.useEffect(() => {
    if (!fullscreen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [fullscreen])

  React.useEffect(() => {
    onFullscreenChange?.(fullscreen)
  }, [fullscreen, onFullscreenChange])

  React.useEffect(() => {
    const payload = {
      revealMap: reveal.revealMap,
      redNodeIds: [...reveal.redNodeIds],
      completed: reveal.completed,
    }
    const fingerprint = JSON.stringify(payload)
    if (fingerprint === lastSnapshotPayloadRef.current) return
    lastSnapshotPayloadRef.current = fingerprint
    onSnapshotChange?.(payload)
  }, [onSnapshotChange, reveal.completed, reveal.redNodeIds, reveal.revealMap])

  const beginSettlement = React.useCallback(
    (modeName: 'manual_complete' | 'auto_complete'): CompleteFlowPayload | null => {
      // Allow re-opening settlement after a first complete so wrong bulk scores
      // can be amended. Still block concurrent settlement dialogs.
      if (completionPendingRef.current) return null

      // Opening the settlement dialog is not completion. Only finalize() after the
      // user confirms in the dialog marks the session completed / reveals remaining.
      completionPendingRef.current = true
      const alreadyCompleted = reveal.completed
      const finishState = alreadyCompleted
        ? {
            revealMap: reveal.revealMap,
            redNodeIds: reveal.redNodeIds,
            revealedRemaining: false,
          }
        : revealRemainingNodes(reveal.root, reveal.revealMap, reveal.redNodeIds)
      let settled = false
      const cancel = () => {
        if (settled) return
        settled = true
        completionPendingRef.current = false
        // Do not change reveal_map / completed — user cancelled settlement.
      }
      const finalize = async () => {
        if (settled) return
        settled = true
        // Confirmed end only: apply remaining reveals + mark completed.
        // Re-settlement after a prior complete keeps the map as-is (already open).
        if (!alreadyCompleted) {
          reveal.setRevealMap(finishState.revealMap)
          reveal.setRedNodeIds(finishState.redNodeIds)
          reveal.setCompleted(true)
        }
        try {
          if (!alreadyCompleted) {
            try {
              await feedback.runCompletionCeremony()
            } catch (error) {
              console.error('Review completion ceremony failed.', error)
            }
          }
        } finally {
          completionPendingRef.current = false
        }
      }

      return {
        completionMode: modeName,
        revealedRemaining: finishState.revealedRemaining,
        redNodeIds: [...finishState.redNodeIds],
        finalize,
        cancel,
      }
    },
    [feedback, reveal],
  )

  const finishFlow = React.useCallback(
    async (modeName: 'manual_complete' | 'auto_complete') => {
      const payload = beginSettlement(modeName)
      if (!payload) return
      try {
        await onComplete(payload)
      } catch (error) {
        payload.cancel()
        throw error
      }
    },
    [beginSettlement, onComplete],
  )

  const finishFlowWithPayload = React.useCallback(
    async (
      modeName: 'manual_complete' | 'auto_complete',
      handler: (payload: CompleteFlowPayload) => void | Promise<void>,
    ) => {
      const payload = beginSettlement(modeName)
      if (!payload) return
      try {
        await handler(payload)
      } catch (error) {
        payload.cancel()
        throw error
      }
    },
    [beginSettlement],
  )

  // Depend on stable action identities, not the whole reveal shell.
  /* eslint-disable react-hooks/exhaustive-deps -- use stable method identities from reveal */
  const handleNodeClick = React.useCallback(
    (nodes: MindMapSelection[]) => {
      if (reveal.completed) return
      reveal.handleNodeClick(nodes)
    },
    [reveal.completed, reveal.handleNodeClick],
  )

  const handleNodeContextMenu = React.useCallback(
    (nodes: MindMapSelection[]) => {
      if (reveal.completed) return
      reveal.handleNodeContextMenu(nodes)
    },
    [reveal.completed, reveal.handleNodeContextMenu],
  )

  /** 收卡 shortcut: returns true when the card actually folded back. */
  const handleNodeRetract = React.useCallback(
    (nodes: MindMapSelection[]) => {
      if (reveal.completed) return false
      return reveal.retractTarget(nodes)
    },
    [reveal.completed, reveal.retractTarget],
  )

  const handleNodeHover = React.useCallback(
    (nodes: MindMapSelection[]) => {
      if (reveal.completed) return
      reveal.handleNodeHover(nodes)
    },
    [reveal.completed, reveal.handleNodeHover],
  )

  const handleBulkRevealSubtree = React.useCallback(
    (fallbackNodeId: string | null = null): boolean => {
      if (reveal.completed) return false
      const handled = reveal.handleBulkRevealSubtree(fallbackNodeId)
      return handled
    },
    [reveal.completed, reveal.handleBulkRevealSubtree],
  )

  const handleBulkRevealDirectChildren = React.useCallback(
    (fallbackNodeId: string | null = null): boolean => {
      if (reveal.completed) return false
      const handled = reveal.handleBulkRevealDirectChildren(fallbackNodeId)
      return handled
    },
    [reveal.completed, reveal.handleBulkRevealDirectChildren],
  )

  const handleSpacePour = React.useCallback(() => {
    if (reveal.completed || revealMode !== 'segment-checkpoint') return
    reveal.handleSpacePour()
  }, [reveal.completed, reveal.handleSpacePour, revealMode])
  /* eslint-enable react-hooks/exhaustive-deps */

  const handleRestart = React.useCallback(async () => {
    const shouldRestart = await onRestart?.()
    if (shouldRestart === false) return
    reveal.reset()
    feedback.emitManualEvent('session_reset')
  }, [feedback, onRestart, reveal])

  return {
    feedback,
    root: reveal.root,
    visibleEditorState: reveal.visibleEditorState,
    totalNodeCount: reveal.totalNodeCount,
    visibleNonRootCount: reveal.visibleNonRootCount,
    revealedNonRootCount: reveal.revealedNonRootCount,
    visibleEditorSyncKey: reveal.visibleEditorSyncKey,
    redNodeCount: reveal.redNodeIds.size,
    redNodeIds: reveal.redNodeIds,
    fullscreen,
    completed: reveal.completed,
    setFullscreen,
    handleNodeClick,
    handleNodeContextMenu,
    handleNodeRetract,
    handleNodeHover,
    handleBulkRevealSubtree,
    handleBulkRevealDirectChildren,
    hoveredNodeId: reveal.hoveredNodeId,
    handleRestart,
    handleSpacePour,
    finishFlowWithPayload,
    finishFlow,
    flipCardRevealSettings,
  }
}
