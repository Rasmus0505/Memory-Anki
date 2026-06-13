import type { RevealState } from '@/entities/session/model'
import type { MindMapEditorState } from '@/shared/api/contracts'
import {
  buildInitialRevealState,
  checkpointNodesRevealed,
  pourCheckpointRevealState,
  sanitizeCheckpointNodeIds,
  buildVisibleEditorState,
  type ReviewMindMapNode,
} from '@/features/review/model/review-flow-tree'
import type { MindMapDoc } from '@/shared/api/contracts'

export function sanitizeMiniPalaceCheckpointIds(
  root: ReviewMindMapNode,
  checkpointIds: Iterable<string>,
) {
  return sanitizeCheckpointNodeIds(root, checkpointIds)
}

export function buildMiniPalaceRevealState(
  root: ReviewMindMapNode,
  checkpointIds: Iterable<string>,
  previous: Record<string, RevealState> | null = null,
): Record<string, RevealState> {
  return buildInitialRevealState(root, previous, {
    mode: 'mini-checkpoint',
    checkpointIds,
  })
}

export function pourMiniPalaceRevealState(
  startNodeId: string,
  root: ReviewMindMapNode,
  nodeMap: Map<string, ReviewMindMapNode>,
  checkpointIds: Iterable<string>,
  revealMap: Record<string, RevealState>,
): Record<string, RevealState> {
  return pourCheckpointRevealState(startNodeId, root, nodeMap, checkpointIds, revealMap)
}

export function isMiniPalaceRevealComplete(
  root: ReviewMindMapNode,
  checkpointIds: Iterable<string>,
  revealMap: Record<string, RevealState>,
) {
  return checkpointNodesRevealed(root, checkpointIds, revealMap)
}

export function buildMiniPalaceVisibleEditorState(
  editorState: MindMapEditorState,
  parsedDoc: MindMapDoc | null,
  revealMap: Record<string, RevealState>,
  nodeMap: Map<string, ReviewMindMapNode>,
  title: string,
): MindMapEditorState {
  return buildVisibleEditorState(
    editorState,
    parsedDoc,
    revealMap,
    nodeMap,
    title,
    new Set<string>(),
  )
}
