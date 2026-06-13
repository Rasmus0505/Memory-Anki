import * as React from 'react'
import type { RevealState } from '@/entities/session/model'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapSelection } from '@/shared/components/mindmap-host'
import {
  advanceRevealStateForNodeClick,
  checkpointNodesRevealed,
  buildInitialRevealState,
  buildSelectionNodeId,
  buildVisibleEditorState,
  buildReviewTree,
  collectNodeIds,
  countNodes,
  flattenNodes,
  hideRevealStateBranch,
  parseEditorDoc,
  pourCheckpointRevealState,
  type RevealFlowMode,
  type RevealFlowOptions,
  sanitizeRedNodeIds,
  type ReviewFlowSnapshot,
} from '@/features/review/model/review-flow-tree'

interface UseRevealSessionOptions {
  title: string
  editorState: MindMapEditorState | null
  initialSnapshot?: ReviewFlowSnapshot | null
  resetCompletedOnDocChange?: boolean
  mode?: RevealFlowMode
  checkpointIds?: Iterable<string>
}

const EMPTY_CHECKPOINT_IDS: string[] = []

export function useRevealSession({
  title,
  editorState,
  initialSnapshot = null,
  resetCompletedOnDocChange = false,
  mode = 'standard',
  checkpointIds = EMPTY_CHECKPOINT_IDS,
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
  const revealOptions = React.useMemo<RevealFlowOptions>(
    () => ({ mode, checkpointIds: normalizedCheckpointIds }),
    [checkpointIdsKey, mode],
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
  const hoveredNodeIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    revealMapRef.current = revealMap
  }, [revealMap])

  React.useEffect(() => {
    hoveredNodeIdRef.current = hoveredNodeId
  }, [hoveredNodeId])

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

  const handleNodeClick = React.useCallback((nodes: MindMapSelection[]) => {
    const nodeId = buildSelectionNodeId(nodes[0] ?? null)
    if (!nodeId) return
    setRevealMap((current) => advanceRevealStateForNodeClick(nodeId, nodeMap, current))
  }, [nodeMap])

  const handleNodeContextMenu = React.useCallback((nodes: MindMapSelection[]) => {
    const nodeId = buildSelectionNodeId(nodes[0] ?? null)
    if (!nodeId) return
    setRevealMap((current) => hideRevealStateBranch(nodeId, nodeMap, current))
  }, [nodeMap])

  const handleNodeHover = React.useCallback((nodes: MindMapSelection[]) => {
    const nodeId = buildSelectionNodeId(nodes[0] ?? null)
    hoveredNodeIdRef.current = nodeId
    setHoveredNodeId(nodeId)
  }, [])

  const handleSpacePour = React.useCallback(() => {
    if (mode !== 'mini-checkpoint') return
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
      mode === 'mini-checkpoint'
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
    handleSpacePour,
  }
}
