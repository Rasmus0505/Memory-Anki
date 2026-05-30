import * as React from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapSelection } from '@/shared/components/mindmap-host'
import { type RevealState } from '@/entities/session/model'
import { useTimedSession } from '@/shared/hooks/useTimedSession'
import {
  buildInitialRevealState,
  buildSelectionNodeId,
  buildVisibleEditorState,
  collectNodeIds,
  countNodes,
  findNextHiddenChild,
  flattenNodes,
  hideNodeAndDescendants,
  parseEditorDoc,
  revealRemainingNodes,
  sanitizeRedNodeIds,
  buildReviewTree,
  type ReviewFlowSnapshot,
} from '@/features/review/model/review-flow-tree'

interface CompleteFlowPayload {
  durationSeconds: number
  completionMode: 'manual_complete' | 'auto_complete'
  revealedRemaining: boolean
  redNodeIds: string[]
}

interface UseReviewFlowSessionOptions {
  title: string
  palaceId: number | null
  sessionKind: 'practice' | 'review'
  editorState: MindMapEditorState
  onComplete: (payload: CompleteFlowPayload) => void | Promise<void>
  onRestart?: () => void
  persistProgress?: boolean
  initialSnapshot?: ReviewFlowSnapshot | null
  onSnapshotChange?: (snapshot: ReviewFlowSnapshot) => void
  onFullscreenChange?: (active: boolean) => void
}

export function useReviewFlowSession({
  title,
  palaceId,
  sessionKind,
  editorState,
  onComplete,
  onRestart,
  persistProgress = false,
  initialSnapshot = null,
  onSnapshotChange,
  onFullscreenChange,
}: UseReviewFlowSessionOptions) {
  const timer = useTimedSession({
    kind: sessionKind,
    title,
    palaceId,
  })
  const parsedDoc = React.useMemo(
    () => parseEditorDoc(editorState.editor_doc),
    [editorState.editor_doc],
  )
  const root = React.useMemo(() => buildReviewTree(parsedDoc, title), [parsedDoc, title])
  const nodeMap = React.useMemo(() => flattenNodes(root), [root])
  const [revealMap, setRevealMap] = React.useState<Record<string, RevealState>>(
    () => buildInitialRevealState(root, initialSnapshot?.revealMap ?? null),
  )
  const [redNodeIds, setRedNodeIds] = React.useState<Set<string>>(
    () => new Set((initialSnapshot?.redNodeIds ?? []).filter(Boolean)),
  )
  const [fullscreen, setFullscreen] = React.useState(false)
  const [completed, setCompleted] = React.useState(
    Boolean(initialSnapshot?.completed),
  )
  const [docVersion, setDocVersion] = React.useState(0)
  const submittingRef = React.useRef(false)
  const timerRef = React.useRef(timer)
  const userAdvancedReviewRef = React.useRef(Boolean(initialSnapshot?.completed))
  const revealMapRef = React.useRef(revealMap)
  const docFingerprint = React.useMemo(
    () => JSON.stringify(parsedDoc ?? {}),
    [parsedDoc],
  )
  const lastSnapshotPayloadRef = React.useRef('')

  React.useEffect(() => {
    revealMapRef.current = revealMap
  }, [revealMap])

  React.useEffect(() => {
    const nextRevealMap = buildInitialRevealState(root, revealMapRef.current)
    setRevealMap(nextRevealMap)
    setRedNodeIds((current) => sanitizeRedNodeIds(root, current))
    if (sessionKind === 'review') {
      setCompleted(false)
    }
    userAdvancedReviewRef.current = false
  }, [docFingerprint, root, sessionKind])

  React.useEffect(() => {
    setDocVersion((current) => current + 1)
  }, [docFingerprint])

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
      revealMap,
      redNodeIds: [...redNodeIds],
      completed,
    }
    const fingerprint = JSON.stringify(payload)
    if (fingerprint === lastSnapshotPayloadRef.current) return
    lastSnapshotPayloadRef.current = fingerprint
    onSnapshotChange?.(payload)
  }, [completed, onSnapshotChange, redNodeIds, revealMap])

  React.useEffect(() => {
    return () => {
      const currentTimer = timerRef.current
      if (currentTimer.startedAt && currentTimer.status !== 'completed') {
        void currentTimer.complete('left_page', {
          persist_progress: persistProgress,
        })
      }
    }
  }, [persistProgress])

  const visibleEditorState = React.useMemo(
    () =>
      buildVisibleEditorState(
        editorState,
        parsedDoc,
        revealMap,
        nodeMap,
        title,
        redNodeIds,
      ),
    [editorState, nodeMap, parsedDoc, redNodeIds, revealMap, title],
  )
  const visibleEditorSyncKey = React.useMemo(
    () =>
      JSON.stringify({
        docVersion,
        revealMap,
        redNodeIds: [...redNodeIds].sort(),
      }),
    [docVersion, redNodeIds, revealMap],
  )

  const totalNodeCount = React.useMemo(() => countNodes(root), [root])
  const visibleNonRootCount = React.useMemo(
    () =>
      collectNodeIds(root).filter(
        (id) => id !== root.id && (revealMap[id] ?? 'hidden') !== 'hidden',
      ).length,
    [revealMap, root],
  )
  const revealedNonRootCount = React.useMemo(
    () =>
      collectNodeIds(root).filter(
        (id) => id !== root.id && (revealMap[id] ?? 'hidden') === 'revealed',
      ).length,
    [revealMap, root],
  )

  const finishFlow = React.useCallback(
    async (modeName: 'manual_complete' | 'auto_complete') => {
      if (completed || submittingRef.current) return

      const finishState = revealRemainingNodes(root, revealMap, redNodeIds)
      setRevealMap(finishState.revealMap)
      setRedNodeIds(finishState.redNodeIds)
      setCompleted(true)
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
    [completed, onComplete, redNodeIds, revealMap, root, timer],
  )

  const handleNodeClick = React.useCallback(
    (nodes: MindMapSelection[]) => {
      if (completed) return
      const nodeId = buildSelectionNodeId(nodes[0] ?? null)
      if (!nodeId) return
      const node = nodeMap.get(nodeId)
      if (!node) return
      timer.registerActivity('practice_interaction', { source: 'left_click' })
      setRevealMap((current) => {
        const state = current[nodeId] ?? 'hidden'
        if (state === 'placeholder') {
          userAdvancedReviewRef.current = true
          return { ...current, [nodeId]: 'revealed' }
        }
        if (state !== 'revealed') return current
        const nextChild = findNextHiddenChild(node, current)
        if (!nextChild) return current
        userAdvancedReviewRef.current = true
        return { ...current, [nextChild.id]: 'placeholder' }
      })
    },
    [completed, nodeMap, timer],
  )

  const handleNodeContextMenu = React.useCallback(
    (nodes: MindMapSelection[]) => {
      if (completed) return
      const nodeId = buildSelectionNodeId(nodes[0] ?? null)
      if (!nodeId) return
      timer.registerActivity('practice_interaction', { source: 'right_click' })
      setRevealMap((current) => hideNodeAndDescendants(nodeId, nodeMap, current))
    },
    [completed, nodeMap, timer],
  )

  const handleRestart = React.useCallback(() => {
    const initialRevealMap = buildInitialRevealState(root)
    setRevealMap(initialRevealMap)
    setRedNodeIds(new Set())
    setCompleted(false)
    userAdvancedReviewRef.current = false
    timer.registerActivity('practice_interaction', { source: 'restart' })
    onRestart?.()
  }, [onRestart, root, timer])

  const screenGlowClass =
    timer.glowState === 'running'
      ? 'memory-anki-session-glow-running'
      : timer.glowState === 'paused'
        ? 'memory-anki-session-glow-paused'
        : ''

  return {
    timer,
    root,
    visibleEditorState,
    totalNodeCount,
    visibleNonRootCount,
    revealedNonRootCount,
    visibleEditorSyncKey,
    redNodeCount: redNodeIds.size,
    fullscreen,
    completed,
    setFullscreen,
    handleNodeClick,
    handleNodeContextMenu,
    handleRestart,
    finishFlow,
    screenGlowClass,
  }
}
