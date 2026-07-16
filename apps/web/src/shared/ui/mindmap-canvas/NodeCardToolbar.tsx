import { useCallback, type ReactNode } from 'react'
import { NodeToolbar, Position, useStore } from '@xyflow/react'
import type { MindMapNodeStatusChip } from './adapter'
import type {
  SelectionToolbarAction,
  SelectionToolbarPreferPosition,
} from './selectionToolbar'

export function AdaptiveNodeToolbar({
  nodeId,
  children,
  preferPosition = 'auto',
  ariaLabel = '卡片快捷操作',
}: {
  nodeId: string
  children: ReactNode
  preferPosition?: SelectionToolbarPreferPosition
  ariaLabel?: string
}) {
  const placement = useStore(
    useCallback((state) => {
      const internalNode = state.nodeLookup.get(nodeId)
      if (!internalNode) {
        return preferPosition === 'bottom' ? 'bottom:center' : 'top:center'
      }
      const [translateX, translateY, zoom] = state.transform
      const absolute = internalNode.internals.positionAbsolute
      const measuredWidth = internalNode.measured.width ?? 220
      const measuredHeight = internalNode.measured.height ?? 48
      const screenTop = absolute.y * zoom + translateY
      const screenBottom = (absolute.y + measuredHeight) * zoom + translateY
      const screenCenterX = (absolute.x + measuredWidth / 2) * zoom + translateX
      const bottomSafe = state.height - 88
      let position: 'top' | 'bottom' =
        preferPosition === 'bottom'
          ? 'bottom'
          : preferPosition === 'top'
            ? 'top'
            : screenTop < 76
              ? 'bottom'
              : 'top'
      if (preferPosition === 'bottom' && screenBottom > bottomSafe) position = 'top'
      if (preferPosition === 'top' && screenTop < 76) position = 'bottom'
      if (preferPosition === 'auto') position = screenTop < 76 ? 'bottom' : 'top'
      const align =
        screenCenterX < 170
          ? 'start'
          : screenCenterX > state.width - 170
            ? 'end'
            : 'center'
      return `${position}:${align}`
    }, [nodeId, preferPosition]),
  )
  const [position, align] = placement.split(':') as [
    'top' | 'bottom',
    'start' | 'center' | 'end',
  ]

  return (
    <NodeToolbar
      isVisible
      position={position === 'bottom' ? Position.Bottom : Position.Top}
      align={align}
      offset={12}
      className="nodrag nopan flex max-w-[min(100vw-2rem,28rem)] flex-wrap items-center justify-center gap-1 rounded-xl border border-border bg-background p-1 shadow-xl"
      style={{ zIndex: 1000 }}
      aria-label={ariaLabel}
    >
      {children}
    </NodeToolbar>
  )
}

export function statusChipClassName(tone: MindMapNodeStatusChip['tone'], style: MindMapNodeStatusChip['style']) {
  if (style === 'filled') {
    return {
      danger: 'border-destructive bg-destructive text-white',
      warning: 'border-warning bg-warning text-white',
      success: 'border-success bg-success text-white',
      info: 'border-sky-500 bg-sky-500 text-white',
      neutral: 'border-muted-foreground/40 bg-muted text-foreground',
    }[tone] ?? 'border-muted-foreground/40 bg-muted text-foreground'
  }
  return {
    danger: 'border-destructive/70 bg-background/95 text-destructive',
    warning: 'border-warning/70 bg-background/95 text-warning',
    success: 'border-success/70 bg-background/95 text-success',
    info: 'border-sky-500/70 bg-background/95 text-sky-700',
    neutral: 'border-border bg-background/95 text-muted-foreground',
  }[tone] ?? 'border-border bg-background/95 text-muted-foreground'
}

export function selectionToolbarButtonClass(variant: SelectionToolbarAction['variant']) {
  const base =
    'nodrag nopan inline-flex min-h-10 min-w-0 shrink-0 items-center justify-center rounded-lg px-2 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50'
  switch (variant) {
    case 'destructive':
      return `${base} bg-destructive text-white hover:bg-destructive/90`
    case 'outline':
      return `${base} border border-border bg-background hover:bg-muted`
    case 'secondary':
      return `${base} bg-secondary text-secondary-foreground hover:bg-secondary/80`
    case 'ghost':
      return `${base} text-muted-foreground hover:bg-muted hover:text-foreground`
    default:
      return `${base} bg-primary text-primary-foreground hover:bg-primary/90`
  }
}
