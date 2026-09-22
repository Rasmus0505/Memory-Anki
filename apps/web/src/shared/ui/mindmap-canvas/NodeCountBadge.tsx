import type { MouseEvent, PointerEvent } from 'react'
import type { MindMapCountBadge } from './adapter'

export function NodeCountBadge({
  countBadge,
  onClick,
  embedded = false,
}: {
  countBadge: MindMapCountBadge
  onClick?: () => void
  /** Inside a corner cluster the badge is in normal flow, not absolutely placed. */
  embedded?: boolean
}) {
  const toneClass =
    countBadge.tone === 'danger'
      ? 'bg-destructive'
      : countBadge.tone === 'warning'
        ? 'bg-warning'
        : countBadge.tone === 'neutral'
          ? 'bg-muted-foreground'
          : countBadge.tone === 'rose'
            ? 'bg-rose-600'
            : countBadge.tone === 'info'
              ? 'bg-sky-600'
              : 'bg-success'
  const label = countBadge.title || countBadge.text

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-quiz-count-badge={countBadge.kind || 'count'}
      data-has-marked={countBadge.tone === 'rose' ? 'true' : 'false'}
      className={[
        'nodrag nopan z-30 flex min-h-5 min-w-5 items-center justify-center rounded-full border-2 border-background px-1 text-[10px] font-semibold leading-none text-white shadow-sm',
        embedded ? 'relative' : 'absolute -bottom-2 -right-2',
        toneClass,
      ].join(' ')}
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

/** Bottom-right cluster shared by mind-map nodes and bookshelf palace cards. */
export function NodeCountBadgeCluster({
  countBadges,
  onBadgeClick,
  className,
}: {
  countBadges: MindMapCountBadge[]
  onBadgeClick?: (kind?: MindMapCountBadge['kind']) => void
  className?: string
}) {
  if (countBadges.length === 0) return null
  return (
    <div
      className={[
        'nodrag nopan absolute -bottom-2 -right-2 z-30 flex items-center gap-1',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {countBadges.map((countBadge, index) => (
        <NodeCountBadge
          key={`${countBadge.kind || countBadge.title || countBadge.text}-${index}`}
          countBadge={countBadge}
          embedded
          onClick={() => onBadgeClick?.(countBadge.kind)}
        />
      ))}
    </div>
  )
}
