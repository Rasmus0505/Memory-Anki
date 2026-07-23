import * as React from 'react'
import type { RevealState } from '@/modules/session/public'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapSelection } from '@/modules/content/public'
import {
  advanceBulkRevealState,
  advanceRevealStateForNodeClick,
  checkpointNodesRevealed,
  buildInitialRevealState,
  buildSelectionNodeId,
  buildVisibleEditorState,
  buildReviewTree,
  collectNodeIds,
  countNodes,
  flattenNodes,
  hasPendingBulkReveal,
  hideRevealStateBranch,
  parseEditorDoc,
  pourCheckpointRevealState,
  type BulkRevealScope,
  type RevealFlowMode,
  type RevealFlowOptions,
  sanitizeRedNodeIds,
  type ReviewFlowSnapshot,
} from '@/modules/memory/domain/review-entity/model/review-flow-tree'

interface UseRevealSessionOptions {
  title: string
  editorState: MindMapEditorState | null
  initialSnapshot?: ReviewFlowSnapshot | null
  resetCompletedOnDocChange?: boolean
  mode?: RevealFlowMode
  checkpointIds?: Iterable<string>
  /**
   * Optional legacy focus set: when non-empty, auto-reveal every non-focus node
   * on entry and skip placeholder for free cards on expand. Product formal review
   * no longer passes this (classic flip for all cards).
   */
  focusNodeIds?: Iterable<string>
}

const EMPTY_CHECKPOINT_IDS: string[] = []
const EMPTY_FOCUS_NODE_IDS: string[] = []

type RevealAction =
  | { type: 'advance'; nodeId: string }
  | { type: 'hide'; nodeId: string }
  | { type: 'bulk'; nodeId: string; scope: BulkRevealScope }

export function useRevealSession({
  title,
  editorState,
  initialSnapshot = null,
  resetCompletedOnDocChange = false,
  mode = 'standard',
  checkpointIds = EMPTY_CHECKPOINT_IDS,
  focusNodeIds = EMPTY_FOCUS_NODE_IDS,
}: UseRevealSessionOptions) {
  const parsedDoc = React.useMemo(
    () => parseEditorDoc(editorState?.editor_doc ?? null),
    [editorState?.editor_doc],
  )
  const root = React.useMemo(() => buildReviewTree(parsedDoc, title), [parsedDoc, title])
  const nodeMap = React.useMemo(() => flattenNodes(root), [root])
  const docFingerprint = React.useMemo(() => JSON.stringify(parsedDoc ?? {}), [parsedDoc])
  const checkpointIdsKey = React.useMemo(
    () => JSON.stringify(Array.from(checkpointIds, (value) => String(value || '').trim())),
    [checkpointIds],
  )
  const normalizedCheckpointIds = React.useMemo(
    () => JSON.parse(checkpointIdsKey) as string[],
    [checkpointIdsKey],
  )
  const focusNodeIdsKey = React.useMemo(
    () => JSON.stringify(Array.from(focusNodeIds, (value) => String(value || '').trim())),
    [focusNodeIds],
  )
  const normalizedFocusNodeIds = React.useMemo(
    () => JSON.parse(focusNodeIdsKey) as string[],
    [focusNodeIdsKey],
  )
  const revealOptions = React.useMemo<RevealFlowOptions>(
    () => ({
      mode,
      checkpointIds: normalizedCheckpointIds,
      focusNodeIds: normalizedFocusNodeIds,
    }),
    [mode, normalizedCheckpointIds, normalizedFocusNodeIds],
  )
  const [revealMap, setRevealMap] = React.useState<Record<string, RevealState>>(
    () => buildInitialRevealState(root, initialSnapshot?.revealMap ?? null, revealOptions),
  )
  const [redNodeIds, setRedNodeIds] = React.useState<Set<string>>(
    () => new Set((initialSnapshot?.redNodeIds ?? []).filter(Boolean)),
  )
  const [completed, setCompleted] = React.useState(Boolean(initialSnapshot?.completed))
  const [docVersion, setDocVersion] = React.useState(0)
  const [hoveredNodeId, setHoveredNodeId] = React.useState<string | null>(null)
  const revealMapRef = React.useRef(revealMap)
  /** Live hover (cleared on mouseleave). */
  const hoveredNodeIdRef = React.useRef<string | null>(null)
  /**
   * Last non-null hover for A/S bulk flip. Survives mouseleave caused by
   * reveal re-renders so the second phase press still has an anchor.
   * Cleared only on session reset (not on transient leave).
   */
  const stickyBulkTargetNodeIdRef = React.useRef<string | null>(null)
  /**
   * Locked bulk anchor while a two-phase A/S flip is incomplete.
   * Survives layout shifts that put the pointer over newly revealed children
   * (live hover would otherwise steal the target and make phase-2 a no-op).
   */
  const lockedBulkTargetNodeIdRef = React.useRef<string | null>(null)
  const revealActionQueueRef = React.useRef<RevealAction[]>([])
  const revealActionFrameRef = React.useRef<number | null>(null)

  const clearLockedBulkTarget = React.useCallback(() => {
    lockedBulkTargetNodeIdRef.current = null
  }, [])

  React.useEffect(() => {
    revealMapRef.current = revealMap
  }, [revealMap])

  React.useEffect(() => {
    hoveredNodeIdRef.current = hoveredNodeId
  }, [hoveredNodeId])

  React.useEffect(() => {
    return () => {
      if (revealActionFrameRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(revealActionFrameRef.current)
      }
      revealActionFrameRef.current = null
      revealActionQueueRef.current = []
    }
  }, [])

  React.useEffect(() => {
    const nextRevealMap = buildInitialRevealState(root, revealMapRef.current, revealOptions)
    setRevealMap(nextRevealMap)
    setRedNodeIds((current) => sanitizeRedNodeIds(root, current))
    if (resetCompletedOnDocChange) {
      setCompleted(false)
    }
  }, [docFingerprint, resetCompletedOnDocChange, revealOptions, root])

  React.useEffect(() => {
    setDocVersion((current) => current + 1)
  }, [docFingerprint])

  const visibleEditorState = React.useMemo(() => {
    if (!editorState) return null
    return buildVisibleEditorState(
      editorState,
      parsedDoc,
      revealMap,
      nodeMap,
      title,
      redNodeIds,
    )
  }, [editorState, nodeMap, parsedDoc, redNodeIds, revealMap, title])

  const visibleEditorSyncKey = React.useMemo(
    () =>
      JSON.stringify({
        docVersion,
        revealMap,
        redNodeIds: [...redNodeIds].sort(),
      }),
    [docVersion, redNodeIds, revealMap],
  )

  const flushRevealActions = React.useCallback(() => {
    revealActionFrameRef.current = null
    const actions = revealActionQueueRef.current
    revealActionQueueRef.current = []
    if (actions.length === 0) return

    // Urgent update: flip-card multi-click must paint on the next frame.
    // Do not wrap in startTransition — that deprioritizes reveal under load.
    setRevealMap((current) => {
      const nextMap = actions.reduce((nextRevealMap, action) => {
        if (action.type === 'advance') {
          return advanceRevealStateForNodeClick(
            action.nodeId,
            nodeMap,
            nextRevealMap,
            revealOptions,
            root,
          )
        }
        if (action.type === 'bulk') {
          const nextBulkMap = advanceBulkRevealState(
            action.nodeId,
            nodeMap,
            nextRevealMap,
            action.scope,
            revealOptions,
            root,
          )
          if (
            lockedBulkTargetNodeIdRef.current === action.nodeId &&
            !hasPendingBulkReveal(action.nodeId, nodeMap, nextBulkMap, action.scope)
          ) {
            lockedBulkTargetNodeIdRef.current = null
          }
          return nextBulkMap
        }
        return hideRevealStateBranch(
          action.nodeId,
          nodeMap,
          nextRevealMap,
          revealOptions,
          root,
        )
      }, current)
      // Keep bulk lock / pending checks current before the next React commit.
      revealMapRef.current = nextMap
      return nextMap
    })
  }, [nodeMap, revealOptions, root])

  const enqueueRevealAction = React.useCallback(
    (action: RevealAction) => {
      revealActionQueueRef.current.push(action)
      if (revealActionFrameRef.current !== null) return

      if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        flushRevealActions()
        return
      }

      let frameFlushedSynchronously = false
      revealActionFrameRef.current = 0
      const frameId = window.requestAnimationFrame((time) => {
        frameFlushedSynchronously = true
        flushRevealActions()
        void time
      })
      if (!frameFlushedSynchronously) {
        revealActionFrameRef.current = frameId
      }
    },
    [flushRevealActions],
  )

  const handleNodeClick = React.useCallback((nodes: MindMapSelection[]) => {
    const nodeId = buildSelectionNodeId(nodes[0] ?? null)
    if (!nodeId) return
    // Explicit click = new intent; drop incomplete A/S lock so the next bulk can retarget.
    clearLockedBulkTarget()
    // Due and non-due both advance/expand one step at a time (same flip ops as freestyle).
    enqueueRevealAction({ type: 'advance', nodeId })
  }, [clearLockedBulkTarget, enqueueRevealAction])

  const handleNodeContextMenu = React.useCallback((nodes: MindMapSelection[]) => {
    const nodeId = buildSelectionNodeId(nodes[0] ?? null)
    if (!nodeId) return
    // Hide works on every card (including non-due / root). Formal due-scope only
    // soft-dims non-due via rateableNodeUids — it must not block flip/hide ops.
    clearLockedBulkTarget()
    enqueueRevealAction({ type: 'hide', nodeId })
  }, [clearLockedBulkTarget, enqueueRevealAction])

  const handleNodeHover = React.useCallback((nodes: MindMapSelection[]) => {
    const nodeId = buildSelectionNodeId(nodes[0] ?? null)
    hoveredNodeIdRef.current = nodeId
    // Only advance sticky on enter; mouseleave must not wipe the bulk-flip anchor.
    // Locked bulk target is NOT updated here — child enter after phase-1 must not steal.
    if (nodeId) stickyBulkTargetNodeIdRef.current = nodeId
    setHoveredNodeId(nodeId)
  }, [])

  /**
   * Bulk two-phase flip under hover, with selection then sticky-hover fallbacks.
   * Priority while a bulk is incomplete:
   *   locked bulk target → live hover → selection fallback → sticky last hover.
   * Lock survives layout re-enter onto newly revealed children so A/S phase-2 works.
   * @returns true when a bulk action was enqueued.
   */
  const handleBulkReveal = React.useCallback(
    (scope: BulkRevealScope, fallbackNodeId: string | null = null): boolean => {
      const lockedId = lockedBulkTargetNodeIdRef.current
      const revealSnapshot = revealMapRef.current
      const targetId =
        lockedId && hasPendingBulkReveal(lockedId, nodeMap, revealSnapshot, scope)
          ? lockedId
          : (() => {
              if (lockedId) clearLockedBulkTarget()
              return (
                hoveredNodeIdRef.current ??
                fallbackNodeId ??
                stickyBulkTargetNodeIdRef.current
              )
            })()

      if (!targetId) return false
      if (!hasPendingBulkReveal(targetId, nodeMap, revealSnapshot, scope)) {
        clearLockedBulkTarget()
        return false
      }

      stickyBulkTargetNodeIdRef.current = targetId
      lockedBulkTargetNodeIdRef.current = targetId
      enqueueRevealAction({ type: 'bulk', nodeId: targetId, scope })
      return true
    },
    [clearLockedBulkTarget, enqueueRevealAction, nodeMap],
  )

  const handleBulkRevealSubtree = React.useCallback(
    (fallbackNodeId: string | null = null): boolean => {
      return handleBulkReveal('subtree', fallbackNodeId)
    },
    [handleBulkReveal],
  )

  const handleBulkRevealDirectChildren = React.useCallback(
    (fallbackNodeId: string | null = null): boolean => {
      return handleBulkReveal('direct-children', fallbackNodeId)
    },
    [handleBulkReveal],
  )

  const handleSpacePour = React.useCallback(() => {
    if (mode !== 'segment-checkpoint') return
    const targetId = hoveredNodeIdRef.current
    if (!targetId) return
    setRevealMap((current) =>
      pourCheckpointRevealState(
        targetId,
        root,
        nodeMap,
        normalizedCheckpointIds,
        current,
      ),
    )
  }, [mode, nodeMap, normalizedCheckpointIds, root])

  const reset = React.useCallback(() => {
    setRevealMap(buildInitialRevealState(root, null, revealOptions))
    setRedNodeIds(new Set<string>())
    setCompleted(false)
    hoveredNodeIdRef.current = null
    stickyBulkTargetNodeIdRef.current = null
    lockedBulkTargetNodeIdRef.current = null
    setHoveredNodeId(null)
  }, [revealOptions, root])

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
  const checkpointRevealComplete = React.useMemo(
    () =>
      mode === 'segment-checkpoint'
        ? checkpointNodesRevealed(root, normalizedCheckpointIds, revealMap)
        : false,
    [mode, normalizedCheckpointIds, revealMap, root],
  )

  return {
    checkpointRevealComplete,
    completed,
    docFingerprint,
    hoveredNodeId,
    nodeMap,
    parsedDoc,
    redNodeIds,
    reset,
    revealMap,
    root,
    setCompleted,
    setRedNodeIds,
    setRevealMap,
    totalNodeCount,
    visibleEditorState,
    visibleEditorSyncKey,
    visibleNonRootCount,
    revealedNonRootCount,
    handleNodeClick,
    handleNodeContextMenu,
    handleNodeHover,
    handleBulkReveal,
    handleBulkRevealSubtree,
    handleBulkRevealDirectChildren,
    handleSpacePour,
  }
}
