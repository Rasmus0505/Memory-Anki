import {
  ArrowDown,
  ArrowUp,
  BetweenHorizontalStart,
  Pencil,
  Plus,
  Trash2,
  Unlink,
} from 'lucide-react'
import type { ContextMenuAction } from './NodeContextMenu'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'

interface NodeMenuState {
  x: number
  y: number
  nodeId: string
}

interface EdgeMenuState {
  x: number
  y: number
  edgeId: string
  sourceId: string
  targetId: string
}

interface BuildNodeActionsInput {
  ctxMenu: NodeMenuState | null
  buildCustomNodeActions?: (nodeId: string) => ContextMenuAction[]
  readonly: boolean
  onAddChild: (parentId: string) => void
  onAddSibling: (nodeId: string) => void
  onDelete: (nodeId: string) => void
  onMoveUp?: (nodeId: string) => void
  onMoveDown?: (nodeId: string) => void
  canMoveUp?: (nodeId: string) => boolean
  canMoveDown?: (nodeId: string) => boolean
}

interface BuildEdgeActionsInput {
  edgeMenu: EdgeMenuState | null
  onEdgeDelete: (edgeId: string, sourceId: string, targetId: string) => void
  onEdgeInsert: (edgeId: string, sourceId: string, targetId: string) => void
}

export function buildNodeActions({
  ctxMenu,
  buildCustomNodeActions,
  readonly,
  onAddChild,
  onAddSibling,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: BuildNodeActionsInput): ContextMenuAction[] {
  if (!ctxMenu) return []
  const nodeId = ctxMenu.nodeId
  if (buildCustomNodeActions) return buildCustomNodeActions(nodeId)
  return [
    {
      label: '添加子知识点 (Tab)',
      icon: Plus,
      onClick: () => {
        if (readonly) return
        dispatchGlobalFeedback('node_create', {
          point: { x: ctxMenu.x, y: ctxMenu.y },
          origin: 'node',
        })
        onAddChild(nodeId)
      },
    },
    {
      label: '添加同级知识点 (Enter)',
      icon: Plus,
      onClick: () => {
        if (readonly) return
        dispatchGlobalFeedback('node_create', {
          point: { x: ctxMenu.x, y: ctxMenu.y },
          origin: 'node',
        })
        onAddSibling(nodeId)
      },
    },
    {
      label: '上移',
      icon: ArrowUp,
      onClick: () => {
        if (readonly) return
        dispatchGlobalFeedback('node_move', {
          point: { x: ctxMenu.x, y: ctxMenu.y },
          origin: 'node',
        })
        onMoveUp?.(nodeId)
      },
      disabled: readonly || (canMoveUp ? !canMoveUp(nodeId) : true),
    },
    {
      label: '下移',
      icon: ArrowDown,
      onClick: () => {
        if (readonly) return
        dispatchGlobalFeedback('node_move', {
          point: { x: ctxMenu.x, y: ctxMenu.y },
          origin: 'node',
        })
        onMoveDown?.(nodeId)
      },
      disabled: readonly || (canMoveDown ? !canMoveDown(nodeId) : true),
    },
    {
      label: '重命名',
      icon: Pencil,
      onClick: () => {
        if (readonly) return
        dispatchGlobalFeedback('node_edit_start', {
          point: { x: ctxMenu.x, y: ctxMenu.y },
          origin: 'node',
        })
      },
      disabled: readonly,
    },
    {
      label: '删除 (Delete)',
      icon: Trash2,
      onClick: () => {
        if (readonly) return
        dispatchGlobalFeedback('node_delete', {
          point: { x: ctxMenu.x, y: ctxMenu.y },
          origin: 'node',
        })
        onDelete(nodeId)
      },
      variant: 'danger' as const,
      disabled: readonly,
    },
  ]
}

export function buildEdgeActions({
  edgeMenu,
  onEdgeDelete,
  onEdgeInsert,
}: BuildEdgeActionsInput): ContextMenuAction[] {
  if (!edgeMenu) return []
  return [
    {
      label: '插入知识点',
      icon: BetweenHorizontalStart,
      onClick: () => {
        dispatchGlobalFeedback('node_create', {
          point: { x: edgeMenu.x, y: edgeMenu.y },
          origin: 'edge',
          label: 'CARD',
        })
        onEdgeInsert(edgeMenu.edgeId, edgeMenu.sourceId, edgeMenu.targetId)
      },
    },
    {
      label: '删除关系',
      icon: Unlink,
      onClick: () => {
        dispatchGlobalFeedback('node_delete', {
          point: { x: edgeMenu.x, y: edgeMenu.y },
          origin: 'edge',
          label: 'EDGE',
        })
        onEdgeDelete(edgeMenu.edgeId, edgeMenu.sourceId, edgeMenu.targetId)
      },
      variant: 'danger' as const,
    },
  ]
}
