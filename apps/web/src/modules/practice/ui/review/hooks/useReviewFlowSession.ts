import * as React from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapSelection } from '@/modules/content/public'
import { useRevealSession } from '@/modules/memory/public'
import { useTimedSession } from '@/shared/hooks/useTimedSession'
import { revealRemainingNodes, type ReviewFlowSnapshot } from '@/modules/memory/public'
import { useReviewFeedback } from '@/modules/memory/public'
import type { RevealFlowMode } from '@/modules/memory/public'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import type { CompleteFlowPayload } from '@/modules/practice/ui/review/model/mind-map-review-flow'
import { useGlobalTimerRegistration } from '@/shared/components/session/GlobalTimerProvider'

interface UseReviewFlowSessionOptions {
  title: string
  palaceId: number | null
  sessionKind: 'practice' | 'review'
  revealMode?: RevealFlowMode
  checkpointNodeUids?: Iterable<string>
  /** Formal review frozen due UIDs — auto-reveal non-due cards on entry. */
  focusNodeUids?: Iterable<string>
  persistKey?: string | null
  editorState: MindMapEditorState
  onComplete: (payload: CompleteFlowPayload) => void | Promise<void>
  onRestart?: () => boolean | void | Promise<boolean | void>
  persistProgress?: boolean
  initialSnapshot?: ReviewFlowSnapshot | null
  onSnapshotChange?: (snapshot: ReviewFlowSnapshot) => void
  onFullscreenChange?: (active: boolean) => void
}

const EMPTY_CHECKPOINT_NODE_UIDS: string[] = []
const EMPTY_FOCUS_NODE_UIDS: string[] = []
const IMMERSIVE_REVIEW_AUTO_PAUSE_MS = 24 * 60 * 60 * 1000

export function useReviewFlowSession({
  title,
  palaceId,
  sessionKind,
  revealMode = 'standard',
  checkpointNodeUids = EMPTY_CHECKPOINT_NODE_UIDS,
  focusNodeUids = EMPTY_FOCUS_NODE_UIDS,
  persistKey = null,
  editorState,
  onComplete,
  onRestart,
  persistProgress = false,
  initialSnapshot = null,
  onSnapshotChange,
  onFullscreenChange,
}: UseReviewFlowSessionOptions) {
  const { isActive, becameActiveAt, fullPath } = useRouteResidency()
  const [fullscreen, setFullscreen] = React.useState(false)
  const timer = useTimedSession({
    kind: sessionKind,
    title,
    palaceId,
    sourceKind: palaceId != null ? 'palace' : null,
    autoPauseMs: fullscreen ? IMMERSIVE_REVIEW_AUTO_PAUSE_MS : undefined,
    persistKey,
    persistCompletionRecord: sessionKind !== 'review',
  })
  const registerTimerActivity = timer.registerActivity
  useGlobalTimerRegistration({
    scene: persistProgress ? 'practice' : 'review',
    title,
    timer,
    isRouteActive: isActive,
    becameActiveAt,
    routePath: fullPath,
  })
  const reveal = useRevealSession({
    title,
    editorState,
    initialSnapshot,
    resetCompletedOnDocChange: sessionKind === 'review',
    mode: revealMode,
    checkpointIds: checkpointNodeUids,
    focusNodeIds: sessionKind === 'review' ? focusNodeUids : EMPTY_FOCUS_NODE_UIDS,
  })
  const feedback = useReviewFeedback({
    root: reveal.root,
    revealMap: reveal.revealMap,
    revealedNonRootCount: reveal.revealedNonRootCount,
    totalNodeCount: reveal.totalNodeCount,
    revealMode,
  })
  const completionPendingRef = React.useRef(false)
  const autoStartedSessionRef = React.useRef<string | null>(null)
  const previousFullscreenRef = React.useRef(false)
  const timerRef = React.useRef(timer)
  const hardUnloadRef = React.useRef(false)
  const lastSnapshotPayloadRef = React.useRef('')

  React.useEffect(() => {
    timer.setSceneActive?.(isActive, { source: isActive ? 'route_active' : 'route_inactive' })
  }, [isActive, timer])

  React.useEffect(() => {
    if (!isActive || completionPendingRef.current) return
    const sessionKey = `${persistKey ?? `${sessionKind}:${palaceId ?? 'none'}`}:${becameActiveAt ?? 'initial'}`
    if (autoStartedSessionRef.current === sessionKey) return
    autoStartedSessionRef.current = sessionKey
    if (timer.status === 'idle') {
      timer.start({ source: 'review_route_ready' })
    } else if (timer.status === 'paused') {
      timer.resume({ source: 'review_route_ready' })
    }
  }, [becameActiveAt, isActive, palaceId, persistKey, sessionKind, timer])

  React.useEffect(() => {
    if (isActive) return
    setFullscreen(false)
  }, [isActive])

  React.useEffect(() => {
    if (fullscreen !== previousFullscreenRef.current) {
      previousFullscreenRef.current = fullscreen
      registerTimerActivity('practice_interaction', {
        source: fullscreen ? 'review_fullscreen_enter' : 'review_fullscreen_exit',
      })
    }
    if (!fullscreen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [fullscreen, registerTimerActivity])

  React.useEffect(() => {
    onFullscreenChange?.(fullscreen)
  }, [fullscreen, onFullscreenChange])

  React.useEffect(() => {
    timerRef.current = timer
  }, [timer])

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

  React.useEffect(() => {
    const markHardUnload = () => {
      hardUnloadRef.current = true
    }

    window.addEventListener('beforeunload', markHardUnload)
    window.addEventListener('pagehide', markHardUnload)

    return () => {
      window.removeEventListener('beforeunload', markHardUnload)
      window.removeEventListener('pagehide', markHardUnload)
    }
  }, [])

  React.useEffect(() => {
    return () => {
      if (hardUnloadRef.current) {
        return
      }
    }
  }, [persistProgress])

  const beginSettlement = React.useCallback(
    (modeName: 'manual_complete' | 'auto_complete'): CompleteFlowPayload | null => {
      // Allow re-opening settlement after a first complete so wrong bulk scores
      // can be amended. Still block concurrent settlement dialogs.
      if (completionPendingRef.current) return null

      // Opening the settlement dialog is not completion. Only finalize() after the
      // user confirms in the dialog marks the session completed / reveals remaining.
      completionPendingRef.current = true
      timer.pause({ source: 'completion_pending' })
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
        timer.resume({ source: 'completion_cancelled' })
      }
      const finalize = async (options?: { persistTimeRecord?: boolean }) => {
        if (settled) return
        settled = true
        // Confirmed end only: apply remaining reveals + mark completed.
        // Re-settlement after a prior complete keeps the map as-is (already open).
        if (!alreadyCompleted) {
          reveal.setRevealMap(finishState.revealMap)
          reveal.setRedNodeIds(finishState.redNodeIds)
          reveal.setCompleted(true)
        }
        const completionMeta = {
          revealed_remaining: finishState.revealedRemaining,
          red_marked_count: finishState.redNodeIds.size,
        }
        try {
          if (!alreadyCompleted) {
            try {
              await feedback.runCompletionCeremony()
            } catch (error) {
              console.error('Review completion ceremony failed.', error)
            }
            if (options?.persistTimeRecord === false) {
              await timer.complete(modeName, completionMeta, { persistRecord: false })
            } else {
              await timer.complete(modeName, completionMeta)
            }
          }
        } finally {
          completionPendingRef.current = false
        }
      }

      return {
        durationSeconds: timer.getEffectiveSeconds(),
        completionMode: modeName,
        revealedRemaining: finishState.revealedRemaining,
        redNodeIds: [...finishState.redNodeIds],
        finalize,
        cancel,
      }
    },
    [feedback, reveal, timer],
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

  // Depend on stable action identities, not the whole timer/reveal shells — timer
  // effectiveSeconds updates every second and used to recreate these handlers.
  /* eslint-disable react-hooks/exhaustive-deps -- use stable method identities from reveal/timer */
  const handleNodeClick = React.useCallback(
    (nodes: MindMapSelection[]) => {
      if (reveal.completed) return
      timer.registerActivity('practice_interaction', { source: 'left_click' })
      reveal.handleNodeClick(nodes)
    },
    [reveal.completed, reveal.handleNodeClick, timer.registerActivity],
  )

  const handleNodeContextMenu = React.useCallback(
    (nodes: MindMapSelection[]) => {
      if (reveal.completed) return
      timer.registerActivity('practice_interaction', { source: 'right_click' })
      reveal.handleNodeContextMenu(nodes)
    },
    [reveal.completed, reveal.handleNodeContextMenu, timer.registerActivity],
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
      if (handled) {
        timer.registerActivity('practice_interaction', { source: 'bulk_flip_subtree' })
      }
      return handled
    },
    [reveal.completed, reveal.handleBulkRevealSubtree, timer.registerActivity],
  )

  const handleBulkRevealDirectChildren = React.useCallback(
    (fallbackNodeId: string | null = null): boolean => {
      if (reveal.completed) return false
      const handled = reveal.handleBulkRevealDirectChildren(fallbackNodeId)
      if (handled) {
        timer.registerActivity('practice_interaction', { source: 'bulk_flip_direct_children' })
      }
      return handled
    },
    [reveal.completed, reveal.handleBulkRevealDirectChildren, timer.registerActivity],
  )

  const handleSpacePour = React.useCallback(() => {
    if (reveal.completed || revealMode !== 'segment-checkpoint') return
    timer.registerActivity('practice_interaction', { source: 'segment_checkpoint_space_pour' })
    reveal.handleSpacePour()
  }, [reveal.completed, reveal.handleSpacePour, revealMode, timer.registerActivity])
  /* eslint-enable react-hooks/exhaustive-deps */

  /** @deprecated No-op: rating mode must not change flip/placeholder reveal state. */
  const startWeakRetryRound = React.useCallback(() => {
    // Intentionally empty — weak scores only affect FSRS scheduling, not the map face.
  }, [])
  const handleRestart = React.useCallback(async () => {
    const shouldRestart = await onRestart?.()
    if (shouldRestart === false) return
    reveal.reset()
    feedback.emitManualEvent('session_reset')
    timer.reset()
    timer.registerActivity('practice_interaction', { source: 'restart' })
  }, [feedback, onRestart, reveal, timer])

  const screenGlowClass =
    timer.glowState === 'running'
      ? 'memory-anki-session-glow-running'
      : timer.glowState === 'paused'
        ? 'memory-anki-session-glow-paused'
        : ''

  return {
    timer,
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
    handleNodeHover,
    handleBulkRevealSubtree,
    handleBulkRevealDirectChildren,
    hoveredNodeId: reveal.hoveredNodeId,
    handleRestart,
    handleSpacePour,
    startWeakRetryRound,
    finishFlowWithPayload,
    finishFlow,
    screenGlowClass,
  }
}

