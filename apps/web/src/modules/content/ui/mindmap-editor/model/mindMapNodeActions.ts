import type { MindMapEditorState } from '@/shared/api/contracts'
import type { ContextMenuAction } from '@/shared/ui/mindmap-canvas/NodeContextMenu'
import type { MindMapCapability } from '../capabilities'
import { buildSelectionFromDoc } from '../documentGraphProjection'

/**
 * Node context actions are composed from capabilities only. Keeping the
 * composition pure makes the surface a wiring host instead of a second place
 * that decides what a node menu can do.
 */
export function buildMindMapNodeActions(input: {
  nodeId: string
  editorDoc: MindMapEditorState['editor_doc']
  nodes: ReadonlyArray<{ id: string; parentId?: string | null }>
  capabilities: ReadonlyArray<MindMapCapability>
  readonly: boolean
  practiceModeActive: boolean
}): ContextMenuAction[] {
  const selection = buildSelectionFromDoc(input.editorDoc, input.nodeId)
  const context = {
    nodeId: input.nodeId,
    selection,
    isRoot: input.nodes.find((node) => node.id === input.nodeId)?.parentId == null,
    readonly: input.readonly,
    practiceModeActive: input.practiceModeActive,
  }
  return input.capabilities.flatMap((capability) => capability.getNodeActions?.(context) ?? [])
}
