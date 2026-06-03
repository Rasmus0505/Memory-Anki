import * as React from 'react'
import type { RevealState } from '@/entities/session/model'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapSelection } from '@/shared/components/mindmap-host'
import {
  advanceRevealStateForNodeClick,
  buildInitialRevealState,
  buildSelectionNodeId,
  buildVisibleEditorState,
  buildReviewTree,
  collectNodeIds,
  countNodes,
  flattenNodes,
  hideRevealStateBranch,
  parseEditorDoc,
  sanitizeRedNodeIds,
  type ReviewFlowSnapshot,
} from '@/features/review/model/review-flow-tree'

interface UseRevealSessionOptions {
  title: string
  editorState: MindMapEditorState | null
  initialSnapshot?: ReviewFlowSnapshot | null
  resetCompletedOnDocChange?: boolean
}

export function useRevealSession({
  title,
  editorState,
  initialSnapshot = null,
  resetCompletedOnDocChange = false,
}: UseRevealSessionOptions) {
  const parsedDoc = React.useMemo(
    () => parseEditorDoc(editorState?.editor_doc ?? null),
    [editorState?.editor_doc],
  )
  const root = React.useMemo(() => buildReviewTree(parsedDoc, title), [parsedDoc, title])
  const nodeMap = React.useMemo(() => flattenNodes(root), [root])
  const docFingerprint = React.useMemo(() => JSON.stringify(parsedDoc ?? {}), [parsedDoc])
  const [revealMap, setRevealMap] = React.useState<Record<string, RevealState>>(
    () => buildInitialRevealState(root, initialSnapshot?.revealMap ?? null),
  )
  const [redNodeIds, setRedNodeIds] = React.useState<Set<string>>(
    () => new Set((initialSnapshot?.redNodeIds ?? []).filter(Boolean)),
  )
  const [completed, setCompleted] = React.useState(Boolean(initialSnapshot?.completed))
  const [docVersion, setDocVersion] = React.useState(0)
  const revealMapRef = React.useRef(revealMap)

  React.useEffect(() => {
    revealMapRef.current = revealMap
  }, [revealMap])

  React.useEffect(() => {
    const nextRevealMap = buildInitialRevealState(root, revealMapRef.current)
    setRevealMap(nextRevealMap)
    setRedNodeIds((current) => sanitizeRedNodeIds(root, current))
    if (resetCompletedOnDocChange) {
      setCompleted(false)
    }
  }, [docFingerprint, resetCompletedOnDocChange, root])

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

  const reset = React.useCallback(() => {
    setRevealMap(buildInitialRevealState(root))
    setRedNodeIds(new Set<string>())
    setCompleted(false)
  }, [root])

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

  return {
    completed,
    docFingerprint,
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
  }
}
