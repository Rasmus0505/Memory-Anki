import type { MouseEvent, PointerEvent } from 'react'
import type { MindMapNodeVisual } from './adapter'

export function NodeCountBadge({
  countBadge,
  onClick,
}: {
  countBadge: NonNullable<MindMapNodeVisual['countBadge']>
  onClick?: () => void
}) {
  const toneClass =
    countBadge.tone === 'danger'
      ? 'bg-destructive'
      : countBadge.tone === 'warning'
        ? 'bg-warning'
        : countBadge.tone === 'neutral'
          ? 'bg-muted-foreground'
          : 'bg-success'

  return (
    <button
      type="button"
      title={countBadge.title || countBadge.text}
      className={`nodrag nopan absolute -bottom-2 -right-2 z-30 flex min-h-5 min-w-5 items-center justify-center rounded-full border-2 border-background px-1 text-[10px] font-semibold leading-none text-white shadow-sm ${toneClass}`}
      onClick={(event: MouseEvent) => {
        event.stopPropagation()
        event.preventDefault()
        onClick?.()
      }}
      onPointerDown={(event: PointerEvent) => event.stopPropagation()}
    >
      {countBadge.text}
    </button>
  )
}
