import * as React from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapSelection } from '@/entities/mindmap-document'
import { useRevealSession } from '@/entities/review/model/useRevealSession'
import { useTimedSession } from '@/shared/hooks/useTimedSession'
import { revealRemainingNodes, type ReviewFlowSnapshot } from '@/entities/review/model/review-flow-tree'
import { useReviewFeedback } from '@/entities/review/model/useReviewFeedback'
import type { RevealFlowMode } from '@/entities/review/model/review-flow-tree'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import type { CompleteFlowPayload } from '@/features/review/model/mind-map-review-flow'
import { useGlobalTimerRegistration } from '@/shared/components/session/GlobalTimerProvider'

interface UseReviewFlowSessionOptions {
  title: string
  palaceId: number | null
  sessionKind: 'practice' | 'review'
  revealMode?: RevealFlowMode
  checkpointNodeUids?: Iterable<string>
  persistKey?: string | null
  editorState: MindMapEditorState
  onComplete: (payload: CompleteFlowPayload) => void | Promise<void>
  onRestart?: () => void
  persistProgress?: boolean
  initialSnapshot?: ReviewFlowSnapshot | null
  onSnapshotChange?: (snapshot: ReviewFlowSnapshot) => void
  onFullscreenChange?: (active: boolean) => void
}

const EMPTY_CHECKPOINT_NODE_UIDS: string[] = []
const IMMERSIVE_REVIEW_AUTO_PAUSE_MS = 24 * 60 * 60 * 1000

export function useReviewFlowSession({
  title,
  palaceId,
  sessionKind,
  revealMode = 'standard',
  checkpointNodeUids = EMPTY_CHECKPOINT_NODE_UIDS,
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
    if (sessionKind !== 'review' || !isActive || completionPendingRef.current) return
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

  const finishFlow = React.useCallback(
    async (modeName: 'manual_complete' | 'auto_complete') => {
      if (reveal.completed || completionPendingRef.current) return

      completionPendingRef.current = true
      timer.pause({ source: 'completion_pending' })
      const finishState = revealRemainingNodes(reveal.root, reveal.revealMap, reveal.redNodeIds)
      let settled = false
      const cancel = () => {
        if (settled) return
        settled = true
        completionPendingRef.current = false
        timer.resume({ source: 'completion_cancelled' })
      }
      const finalize = async () => {
        if (settled) return
        settled = true
        reveal.setRevealMap(finishState.revealMap)
        reveal.setRedNodeIds(finishState.redNodeIds)
        reveal.setCompleted(true)
        await feedback.runCompletionCeremony()
        await timer.complete(modeName, {
          revealed_remaining: finishState.revealedRemaining,
          red_marked_count: finishState.redNodeIds.size,
        })
        completionPendingRef.current = false
      }

      try {
        await onComplete({
          durationSeconds: timer.getEffectiveSeconds(),
          completionMode: modeName,
          revealedRemaining: finishState.revealedRemaining,
          redNodeIds: [...finishState.redNodeIds],
          finalize,
          cancel,
        })
      } catch (error) {
        cancel()
        throw error
      }
    },
    [feedback, onComplete, reveal, timer],
  )

  const handleNodeClick = React.useCallback(
    (nodes: MindMapSelection[]) => {
      if (reveal.completed) return
      timer.registerActivity('practice_interaction', { source: 'left_click' })
      reveal.handleNodeClick(nodes)
    },
    [reveal, timer],
  )

  const handleNodeContextMenu = React.useCallback(
    (nodes: MindMapSelection[]) => {
      if (reveal.completed) return
      timer.registerActivity('practice_interaction', { source: 'right_click' })
      reveal.handleNodeContextMenu(nodes)
    },
    [reveal, timer],
  )

  const handleNodeHover = React.useCallback(
    (nodes: MindMapSelection[]) => {
      if (reveal.completed) return
      reveal.handleNodeHover(nodes)
    },
    [reveal],
  )

  const handleSpacePour = React.useCallback(() => {
    if (reveal.completed || revealMode !== 'segment-checkpoint') return
    timer.registerActivity('practice_interaction', { source: 'segment_checkpoint_space_pour' })
    reveal.handleSpacePour()
  }, [reveal, revealMode, timer])

  const startWeakRetryRound = React.useCallback((nodeUids: string[]) => {
    const weakSet = new Set(nodeUids)
    reveal.setRevealMap((current) => Object.fromEntries(Object.entries(current).map(([uid, state]) => [uid, weakSet.has(uid) ? 'placeholder' : state])))
  }, [reveal])
  const handleRestart = React.useCallback(() => {
    reveal.reset()
    feedback.emitManualEvent('session_reset')
    timer.registerActivity('practice_interaction', { source: 'restart' })
    onRestart?.()
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
    handleRestart,
    handleSpacePour,
    startWeakRetryRound,
    finishFlow,
    screenGlowClass,
  }
}

