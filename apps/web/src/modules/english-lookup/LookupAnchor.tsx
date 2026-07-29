import type { LookupAnchorState } from './types'

export function LookupAnchor({
  anchor,
  onClick,
}: {
  anchor: LookupAnchorState | null
  onClick: () => void
}) {
  if (!anchor?.visible) return null
  return (
    <button
      type="button"
      data-lookup-anchor="true"
      data-testid="english-lookup-anchor"
      onMouseDown={(event) => {
        // Prevent clearing selection before click handler runs.
        event.preventDefault()
        event.stopPropagation()
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      className="fixed z-[60] flex h-9 min-w-9 items-center justify-center rounded-md border border-border bg-background px-2 text-sm font-medium shadow-md hover:bg-muted"
      style={{ left: anchor.left, top: anchor.top }}
      title={`查词：${anchor.query}`}
      aria-label={`查词 ${anchor.query}`}
    >
      查
    </button>
  )
}
