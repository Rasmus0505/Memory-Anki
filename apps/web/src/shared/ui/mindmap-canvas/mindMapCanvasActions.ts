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
  onDeleteNodeOnly?: (nodeId: string) => void
  onStartEdit: (nodeId: string) => void
  isRootNode: (nodeId: string) => boolean
  getSubtreeSize: (nodeId: string) => number
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
  onDeleteNodeOnly,
  onStartEdit,
  isRootNode,
  getSubtreeSize,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: BuildNodeActionsInput): ContextMenuAction[] {
  if (!ctxMenu) return []
  const nodeId = ctxMenu.nodeId
  const customActions = buildCustomNodeActions?.(nodeId) ?? []
  if (readonly) return customActions
  const isRoot = isRootNode(nodeId)
  const subtreeSize = getSubtreeSize(nodeId)
  const structuralActions: ContextMenuAction[] = [
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
    ...(!isRoot ? [{
      label: '添加同级知识点 (Shift+Enter)',
      icon: Plus,
      onClick: () => {
        dispatchGlobalFeedback('node_create', {
          point: { x: ctxMenu.x, y: ctxMenu.y },
          origin: 'node',
        })
        onAddSibling(nodeId)
      },
    } satisfies ContextMenuAction] : []),
    ...(!isRoot ? [{
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
      disabled: canMoveUp ? !canMoveUp(nodeId) : true,
    } satisfies ContextMenuAction, {
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
      disabled: canMoveDown ? !canMoveDown(nodeId) : true,
    } satisfies ContextMenuAction] : []),
    {
      label: '编辑文字 (Enter / F2)',
      icon: Pencil,
      onClick: () => {
        dispatchGlobalFeedback('node_edit_start', {
          point: { x: ctxMenu.x, y: ctxMenu.y },
          origin: 'node',
        })
        onStartEdit(nodeId)
      },
    },
    ...(!isRoot && onDeleteNodeOnly ? [{
      label: '单独删除（保留子级）',
      icon: Trash2,
      onClick: () => {
        dispatchGlobalFeedback('node_delete', {
          point: { x: ctxMenu.x, y: ctxMenu.y },
          origin: 'node',
          label: 'NODE_ONLY',
        })
        onDeleteNodeOnly(nodeId)
      },
      variant: 'danger' as const,
      separatorBefore: true,
    } satisfies ContextMenuAction] : []),
    ...(!isRoot ? [{
      label: subtreeSize > 1 ? `删除整条分支（${subtreeSize} 张卡片）` : '删除整条分支 (Delete)',
      icon: Trash2,
      onClick: () => {
        dispatchGlobalFeedback('node_delete', {
          point: { x: ctxMenu.x, y: ctxMenu.y },
          origin: 'node',
        })
        onDelete(nodeId)
      },
      variant: 'danger' as const,
    } satisfies ContextMenuAction] : []),
  ]
  if (customActions.length === 0) return structuralActions
  return [
    ...structuralActions,
    ...customActions.map((action, index) =>
      index === 0 ? { ...action, separatorBefore: true } : action,
    ),
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
