import { type ReactNode } from 'react'
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'

export type MindMapSplitSide = 'start' | 'end'

export interface MindMapSplitLayoutProps {
  side?: MindMapSplitSide
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  sidePanel: ReactNode
  children: ReactNode
  /** Hide the side panel and rail entirely (immersive / fullscreen). */
  hidden?: boolean
  className?: string
  sideClassName?: string
  collapseLabel?: string
  expandLabel?: string
}

/**
 * Mind-map host split: the canvas always keeps remaining space.
 * Adjacent chrome collapses to a thin rail, matching the app nav sidebar.
 * Below `md` the open panel overlays the canvas instead of stacking above it.
 */
export function MindMapSplitLayout({
  side = 'start',
  collapsed,
  onCollapsedChange,
  sidePanel,
  children,
  hidden = false,
  className,
  sideClassName,
  collapseLabel,
  expandLabel,
}: MindMapSplitLayoutProps) {
  const isStart = side === 'start'
  const resolvedCollapseLabel = collapseLabel ?? (isStart ? '收起侧栏' : '收起右侧栏')
  const resolvedExpandLabel = expandLabel ?? (isStart ? '展开侧栏' : '展开右侧栏')

  if (hidden) {
    return (
      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}>
        {children}
      </div>
    )
  }

  const OpenIcon = isStart ? PanelLeftOpen : PanelRightOpen
  const CloseIcon = isStart ? PanelLeftClose : PanelRightClose

  const toggle = (
    <button
      type="button"
      onClick={() => onCollapsedChange(!collapsed)}
      className="inline-flex size-9 items-center justify-center rounded-md border border-border/70 bg-background/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label={collapsed ? resolvedExpandLabel : resolvedCollapseLabel}
      title={collapsed ? resolvedExpandLabel : resolvedCollapseLabel}
    >
      {collapsed ? <OpenIcon className="size-4" /> : <CloseIcon className="size-4" />}
    </button>
  )

  const aside = (
    <aside
      className={cn(
        'min-h-0 overflow-hidden transition-[width] duration-300',
        collapsed
          ? 'pointer-events-none w-0'
          : cn(
              'w-[min(280px,85vw)] shrink-0',
              'max-md:absolute max-md:inset-y-0 max-md:z-20 max-md:bg-card max-md:shadow-soft',
              isStart ? 'max-md:left-0 max-md:border-r' : 'max-md:right-0 max-md:border-l',
              sideClassName,
            ),
      )}
      aria-hidden={collapsed}
    >
      <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto">
        {sidePanel}
      </div>
    </aside>
  )

  const rail = (
    <div
      className={cn(
        'flex w-10 shrink-0 flex-col items-center border-border/80 py-2',
        isStart ? 'border-r' : 'border-l',
      )}
    >
      {toggle}
    </div>
  )

  const main = (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {children}
    </section>
  )

  return (
    <div className={cn('relative flex min-h-0 min-w-0 flex-1', className)}>
      {!collapsed ? (
        <div
          className="absolute inset-0 z-10 bg-black/30 md:hidden"
          aria-hidden
          onClick={() => onCollapsedChange(true)}
        />
      ) : null}
      {isStart ? (
        <>
          {aside}
          {rail}
          {main}
        </>
      ) : (
        <>
          {main}
          {rail}
          {aside}
        </>
      )}
    </div>
  )
}
