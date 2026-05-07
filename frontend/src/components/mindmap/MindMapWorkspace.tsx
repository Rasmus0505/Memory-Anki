import type { ReactNode } from 'react'

interface MindMapWorkspaceProps {
  leftSidebar?: ReactNode
  main: ReactNode
  rightSidebar?: ReactNode
  focusMode?: boolean
}

export function MindMapWorkspace({
  leftSidebar,
  main,
  rightSidebar,
  focusMode = false,
}: MindMapWorkspaceProps) {
  const hasLeft = !focusMode && Boolean(leftSidebar)
  const hasRight = !focusMode && Boolean(rightSidebar)
  const gridClass = focusMode
    ? 'grid-cols-1'
    : hasLeft && hasRight
      ? 'grid-cols-1 xl:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(260px,320px)]'
      : hasLeft
        ? 'grid-cols-1 xl:grid-cols-[minmax(220px,260px)_minmax(0,1fr)]'
        : hasRight
          ? 'grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]'
          : 'grid-cols-1'

  return (
    <div className={`grid min-h-0 flex-1 auto-rows-fr ${focusMode ? 'gap-2 xl:gap-2' : 'gap-4 xl:gap-5'} ${gridClass}`}>
      {hasLeft ? <aside className="min-h-0 h-full xl:overflow-y-auto">{leftSidebar}</aside> : null}
      <section className="min-h-0 h-full">{main}</section>
      {hasRight ? <aside className="min-h-0 h-full xl:overflow-y-auto">{rightSidebar}</aside> : null}
    </div>
  )
}
