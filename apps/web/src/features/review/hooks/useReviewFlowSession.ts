import * as React from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapSelection } from '@/shared/components/mindmap-host'
import { useRevealSession } from '@/entities/review/model/useRevealSession'
import { useTimedSession } from '@/shared/hooks/useTimedSession'
import { revealRemainingNodes, type ReviewFlowSnapshot } from '@/entities/review/model/review-flow-tree'
import { useReviewFeedback } from '@/features/review/hooks/useReviewFeedback'
import type { RevealFlowMode } from '@/entities/review/model/review-flow-tree'
import { useRouteResidency } from '@/app/router/RouteResidency'
import type { CompleteFlowPayload } from '@/features/review/model/mind-map-review-flow'

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
  const { isActive } = useRouteResidency()
  const timer = useTimedSession({
    kind: sessionKind,
    title,
    palaceId,
    sourceKind: palaceId != null ? 'palace' : null,
    persistKey,
    persistCompletionRecord: sessionKind !== 'review',
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
  const [fullscreen, setFullscreen] = React.useState(false)
  const submittingRef = React.useRef(false)
  const timerRef = React.useRef(timer)
  const hardUnloadRef = React.useRef(false)
  const lastSnapshotPayloadRef = React.useRef('')

  React.useEffect(() => {
    timer.setSceneActive?.(isActive, { source: isActive ? 'route_active' : 'route_inactive' })
  }, [isActive, timer])

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
      const currentTimer = timerRef.current
      if (hardUnloadRef.current) {
        return
      }
      if (currentTimer.startedAt && currentTimer.status !== 'completed') {
        void currentTimer.leaveScene({
          persist_progress: persistProgress,
        })
      }
    }
  }, [persistProgress])

  const finishFlow = React.useCallback(
    async (modeName: 'manual_complete' | 'auto_complete') => {
      if (reveal.completed || submittingRef.current) return

      const finishState = revealRemainingNodes(reveal.root, reveal.revealMap, reveal.redNodeIds)
      reveal.setRevealMap(finishState.revealMap)
      reveal.setRedNodeIds(finishState.redNodeIds)
      reveal.setCompleted(true)
      await feedback.runCompletionCeremony()
      timer.registerActivity('practice_interaction', { source: 'complete' })
      const record = await timer.complete(modeName, {
        revealed_remaining: finishState.revealedRemaining,
        red_marked_count: finishState.redNodeIds.size,
      })
      submittingRef.current = true
      try {
        await onComplete({
          durationSeconds: record?.effectiveSeconds ?? timer.effectiveSeconds,
          completionMode: modeName,
          revealedRemaining: finishState.revealedRemaining,
          redNodeIds: [...finishState.redNodeIds],
        })
      } finally {
        submittingRef.current = false
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
    if (reveal.completed || revealMode !== 'mini-checkpoint') return
    timer.registerActivity('practice_interaction', { source: 'mini_palace_space_pour' })
    reveal.handleSpacePour()
  }, [reveal, revealMode, timer])

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
    fullscreen,
    completed: reveal.completed,
    setFullscreen,
    handleNodeClick,
    handleNodeContextMenu,
    handleNodeHover,
    handleRestart,
    handleSpacePour,
    finishFlow,
    screenGlowClass,
  }
}
