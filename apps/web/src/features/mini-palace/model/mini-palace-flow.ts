import type { RevealState } from '@/entities/session/model'
import type { MindMapEditorState } from '@/shared/api/contracts'
import {
  buildVisibleEditorState,
  collectNodeIds,
  type ReviewMindMapNode,
} from '@/features/review/model/review-flow-tree'
import type { MindMapDoc } from '@/shared/api/contracts'

export function sanitizeMiniPalaceCheckpointIds(
  root: ReviewMindMapNode,
  checkpointIds: Iterable<string>,
) {
  const validIds = new Set(collectNodeIds(root))
  validIds.delete(root.id)
  const result: string[] = []
  for (const value of checkpointIds) {
    const id = String(value || '').trim()
    if (id && validIds.has(id) && !result.includes(id)) {
      result.push(id)
    }
  }
  return result
}

export function buildMiniPalaceRevealState(
  root: ReviewMindMapNode,
  checkpointIds: Iterable<string>,
  previous: Record<string, RevealState> | null = null,
): Record<string, RevealState> {
  const checkpoints = new Set(sanitizeMiniPalaceCheckpointIds(root, checkpointIds))
  const order = collectNodeIds(root)
  const next: Record<string, RevealState> = {}
  let blocked = false

  order.forEach((nodeId) => {
    if (nodeId === root.id) {
      next[nodeId] = 'revealed'
      return
    }
    if (blocked) {
      next[nodeId] = 'hidden'
      return
    }
    if (!checkpoints.has(nodeId)) {
      next[nodeId] = 'revealed'
      return
    }
    const previousState = previous?.[nodeId]
    next[nodeId] = previousState === 'revealed' ? 'revealed' : 'placeholder'
    if (next[nodeId] !== 'revealed') {
      blocked = true
    }
  })

  return next
}

export function advanceMiniPalaceRevealStateForNodeClick(
  nodeId: string | null,
  root: ReviewMindMapNode,
  checkpointIds: Iterable<string>,
  revealMap: Record<string, RevealState>,
) {
  if (!nodeId) return revealMap
  const checkpoints = new Set(sanitizeMiniPalaceCheckpointIds(root, checkpointIds))
  if (!checkpoints.has(nodeId)) return revealMap
  if ((revealMap[nodeId] ?? 'hidden') !== 'placeholder') return revealMap
  return buildMiniPalaceRevealState(root, checkpointIds, {
    ...revealMap,
    [nodeId]: 'revealed',
  })
}

export function isMiniPalaceRevealComplete(
  root: ReviewMindMapNode,
  checkpointIds: Iterable<string>,
  revealMap: Record<string, RevealState>,
) {
  const checkpoints = sanitizeMiniPalaceCheckpointIds(root, checkpointIds)
  return (
    checkpoints.length > 0 &&
    checkpoints.every((nodeId) => (revealMap[nodeId] ?? 'hidden') === 'revealed')
  )
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
