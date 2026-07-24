import {
  ArrowDown,
  ArrowUp,
  BetweenHorizontalStart,
  CircleHelp,
  Highlighter,
  PaintBucket,
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
  /** Nodes the multi-capable actions should apply to (resolved at menu open). */
  targetNodeIds?: string[]
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
  onDeleteNodes?: (nodeIds: string[]) => void
  onDeleteNodeOnly?: (nodeId: string) => void
  onHighlightNodes?: (nodeIds: string[]) => void
  /**
   * Apply last-used mark color (or open palette if none).
   * Main menu row click.
   */
  onApplyLastMarkColor?: (nodeIds: string[]) => void
  /** Open mark-color flyout for the current targets. */
  onOpenMarkColorPalette?: (nodeIds: string[], point: { x: number; y: number }) => void
  /** Last used / current swatch for the trailing palette control. */
  markColorSwatch?: string | null
  /** Toggle question-card flag (auto-reveal under parent in review). */
  onToggleQuestionCards?: (nodeIds: string[], enabled: boolean) => void
  isQuestionCard?: (nodeId: string) => boolean
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

export function resolveContextMenuTargetIds(ctxMenu: NodeMenuState | null): string[] {
  if (!ctxMenu) return []
  const fromMenu = (ctxMenu.targetNodeIds ?? []).filter(Boolean)
  if (fromMenu.length > 0) return [...new Set(fromMenu)]
  return ctxMenu.nodeId ? [ctxMenu.nodeId] : []
}

export function buildNodeActions({
  ctxMenu,
  buildCustomNodeActions,
  readonly,
  onAddChild,
  onAddSibling,
  onDelete,
  onDeleteNodes,
  onDeleteNodeOnly,
  onHighlightNodes,
  onApplyLastMarkColor,
  onOpenMarkColorPalette,
  markColorSwatch,
  onToggleQuestionCards,
  isQuestionCard,
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
  const targetNodeIds = resolveContextMenuTargetIds(ctxMenu)
  const multiTarget = targetNodeIds.length > 1
  const customActions = buildCustomNodeActions?.(nodeId) ?? []
  if (readonly) return customActions
  const isRoot = isRootNode(nodeId)
  const subtreeSize = getSubtreeSize(nodeId)
  const deletableTargets = targetNodeIds.filter((id) => !isRootNode(id))
  const questionCardTargets = targetNodeIds.filter((id) => !isRootNode(id))
  const allQuestionCards =
    questionCardTargets.length > 0 &&
    questionCardTargets.every((id) => Boolean(isQuestionCard?.(id)))
  const enableQuestionCards = !allQuestionCards
  const structuralActions: ContextMenuAction[] = [
    ...(multiTarget
      ? []
      : [{
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
        } satisfies ContextMenuAction]),
    ...(!multiTarget && !isRoot ? [{
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
    ...(!multiTarget && !isRoot ? [{
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
    ...(!multiTarget ? [{
      label: '编辑文字 (Enter / F2)',
      icon: Pencil,
      onClick: () => {
        dispatchGlobalFeedback('node_edit_start', {
          point: { x: ctxMenu.x, y: ctxMenu.y },
          origin: 'node',
        })
        onStartEdit(nodeId)
      },
    } satisfies ContextMenuAction] : []),
    ...(onHighlightNodes ? [{
      label: multiTarget ? `标记重点（${targetNodeIds.length} 张）` : '标记重点',
      icon: Highlighter,
      onClick: () => {
        dispatchGlobalFeedback('toolbar_action', {
          point: { x: ctxMenu.x, y: ctxMenu.y },
          origin: 'node',
          label: 'HIGHLIGHT',
        })
        onHighlightNodes(targetNodeIds)
      },
      separatorBefore: true,
    } satisfies ContextMenuAction] : []),
    ...(onApplyLastMarkColor || onOpenMarkColorPalette ? [{
      label: multiTarget ? `标记颜色（${targetNodeIds.length} 张）` : '标记颜色',
      icon: PaintBucket,
      onClick: () => {
        dispatchGlobalFeedback('toolbar_action', {
          point: { x: ctxMenu.x, y: ctxMenu.y },
          origin: 'node',
          label: 'MARK_COLOR_LAST',
        })
        if (onApplyLastMarkColor) {
          onApplyLastMarkColor(targetNodeIds)
          return
        }
        onOpenMarkColorPalette?.(targetNodeIds, { x: ctxMenu.x + 220, y: ctxMenu.y })
      },
      separatorBefore: !onHighlightNodes,
      trailing: onOpenMarkColorPalette
        ? {
            ariaLabel: '打开调色板',
            showPalette: true,
            swatchColor: markColorSwatch ?? null,
            onClick: () => {
              dispatchGlobalFeedback('toolbar_action', {
                point: { x: ctxMenu.x, y: ctxMenu.y },
                origin: 'node',
                label: 'MARK_COLOR_PALETTE',
              })
              onOpenMarkColorPalette(targetNodeIds, { x: ctxMenu.x + 220, y: ctxMenu.y })
            },
          }
        : undefined,
    } satisfies ContextMenuAction] : []),
    ...(onToggleQuestionCards && questionCardTargets.length > 0 ? [{
      label: enableQuestionCards
        ? multiTarget
          ? `设置为题目卡（${questionCardTargets.length} 张）`
          : '设置为题目卡'
        : multiTarget
          ? `取消题目卡（${questionCardTargets.length} 张）`
          : '取消题目卡',
      icon: CircleHelp,
      onClick: () => {
        dispatchGlobalFeedback('toolbar_action', {
          point: { x: ctxMenu.x, y: ctxMenu.y },
          origin: 'node',
          label: enableQuestionCards ? 'QUESTION_CARD_ON' : 'QUESTION_CARD_OFF',
        })
        onToggleQuestionCards(questionCardTargets, enableQuestionCards)
      },
      separatorBefore: !onHighlightNodes && !onApplyLastMarkColor && !onOpenMarkColorPalette,
    } satisfies ContextMenuAction] : []),
    ...(!multiTarget && !isRoot && onDeleteNodeOnly ? [{
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
    ...(deletableTargets.length > 0 ? [{
      label: multiTarget
        ? `删除选中（${deletableTargets.length} 处）`
        : subtreeSize > 1
          ? `删除整条分支（${subtreeSize} 张卡片）`
          : '删除整条分支 (Delete)',
      icon: Trash2,
      onClick: () => {
        dispatchGlobalFeedback('node_delete', {
          point: { x: ctxMenu.x, y: ctxMenu.y },
          origin: 'node',
        })
        if (deletableTargets.length > 1 && onDeleteNodes) {
          onDeleteNodes(deletableTargets)
          return
        }
        const onlyId = deletableTargets[0] ?? nodeId
        onDelete(onlyId)
      },
      variant: 'danger' as const,
      separatorBefore:
        (!onHighlightNodes && !onApplyLastMarkColor && !onOpenMarkColorPalette && !onToggleQuestionCards)
        || multiTarget
        || isRoot,
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
