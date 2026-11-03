import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'

export type MindMapSplitSide = 'start' | 'end'
/**
 * Where the collapse rail is rendered. `below-lg` keeps the rail on narrow
 * viewports only, so a host whose collapse control lives elsewhere (the app
 * sidebar) does not reserve a whole column for a second button.
 */
export type MindMapSplitRailMode = 'always' | 'below-lg' | 'never'

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
  railMode?: MindMapSplitRailMode
  /** Let the divider be dragged (or arrow-keyed) to resize the side panel. */
  resizable?: boolean
}

const DEFAULT_SIDE_WIDTH = 280
const MIN_SIDE_WIDTH = 180
const MAX_SIDE_WIDTH = 640
/** Width the canvas must keep when the panel is resized. */
const MIN_MAIN_WIDTH = 320
const SIDE_WIDTH_STORAGE_KEY = 'memory_anki.mind_map_split_side_width'
const RESIZE_STEP = 16
const RESIZE_STEP_LARGE = 48

function isSideWidth(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_SIDE_WIDTH && value <= MAX_SIDE_WIDTH
}

/** The width is a per-screen habit, so it stays on this machine's storage. */
function readStoredSideWidth() {
  if (typeof window === 'undefined') return DEFAULT_SIDE_WIDTH
  try {
    const raw = window.localStorage.getItem(SIDE_WIDTH_STORAGE_KEY)
    if (raw == null) return DEFAULT_SIDE_WIDTH
    const parsed: unknown = JSON.parse(raw)
    return isSideWidth(parsed) ? parsed : DEFAULT_SIDE_WIDTH
  } catch {
    return DEFAULT_SIDE_WIDTH
  }
}

function writeStoredSideWidth(width: number) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SIDE_WIDTH_STORAGE_KEY, JSON.stringify(width))
  } catch {
    // Private-mode storage failures must not break resizing.
  }
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
  railMode = 'always',
  resizable = false,
}: MindMapSplitLayoutProps) {
  const isStart = side === 'start'
  const resolvedCollapseLabel = collapseLabel ?? (isStart ? '收起侧栏' : '收起右侧栏')
  const resolvedExpandLabel = expandLabel ?? (isStart ? '展开侧栏' : '展开右侧栏')

  const containerRef = useRef<HTMLDivElement>(null)
  const [storedSideWidth, setStoredSideWidthState] = useState(readStoredSideWidth)
  const setStoredSideWidth = useCallback((width: number) => {
    setStoredSideWidthState(width)
    writeStoredSideWidth(width)
  }, [])
  // The live drag width stays local until the pointer is released, so a drag
  // does not write to localStorage on every frame.
  const [draftSideWidth, setDraftSideWidth] = useState<number | null>(null)
  const [resizing, setResizing] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number; width: number } | null>(null)
  const detachDragRef = useRef<(() => void) | null>(null)
  const sideWidth = draftSideWidth ?? storedSideWidth

  const clampSideWidth = useCallback((width: number) => {
    const containerWidth = containerRef.current?.getBoundingClientRect().width ?? 0
    const max = containerWidth > 0
      ? Math.max(MIN_SIDE_WIDTH, Math.min(MAX_SIDE_WIDTH, Math.floor(containerWidth - MIN_MAIN_WIDTH)))
      : MAX_SIDE_WIDTH
    return Math.round(Math.min(max, Math.max(MIN_SIDE_WIDTH, width)))
  }, [])

  const endResize = useCallback((commit: boolean) => {
    const drag = dragRef.current
    detachDragRef.current?.()
    detachDragRef.current = null
    dragRef.current = null
    setResizing(false)
    setDraftSideWidth(null)
    if (commit && drag) setStoredSideWidth(drag.width)
  }, [setStoredSideWidth])

  const startResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    dragRef.current = { startX: event.clientX, startWidth: sideWidth, width: sideWidth }
    setResizing(true)
    // Listen on the window so the drag keeps working when the pointer leaves
    // the thin divider.
    const onMove = (moveEvent: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      // Dragging the divider towards the canvas grows the panel; the direction
      // flips when the panel sits after the canvas.
      const delta = (moveEvent.clientX - drag.startX) * (isStart ? 1 : -1)
      const next = clampSideWidth(drag.startWidth + delta)
      drag.width = next
      setDraftSideWidth(next)
    }
    const onUp = () => endResize(true)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    detachDragRef.current = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [clampSideWidth, endResize, isStart, sideWidth])

  useEffect(() => () => detachDragRef.current?.(), [])

  const resizeFromKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? RESIZE_STEP_LARGE : RESIZE_STEP
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = sideWidth + (isStart ? -step : step)
    else if (event.key === 'ArrowRight') next = sideWidth + (isStart ? step : -step)
    else if (event.key === 'Home') next = DEFAULT_SIDE_WIDTH
    if (next == null) return
    event.preventDefault()
    setStoredSideWidth(clampSideWidth(next))
  }, [clampSideWidth, isStart, setStoredSideWidth, sideWidth])

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
      style={resizable && !collapsed ? { width: `min(${sideWidth}px, 85vw)` } : undefined}
      className={cn(
        'min-h-0 overflow-hidden',
        resizing ? null : 'transition-[width] duration-300',
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
        railMode === 'below-lg' && 'lg:hidden',
        railMode === 'never' && 'hidden',
      )}
    >
      {toggle}
    </div>
  )

  // The hit area straddles the divider with negative margins, so it is easy to
  // grab without reserving any extra layout width.
  const resizeHandle = resizable && !collapsed ? (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧栏宽度"
      aria-valuemin={MIN_SIDE_WIDTH}
      aria-valuemax={MAX_SIDE_WIDTH}
      aria-valuenow={sideWidth}
      tabIndex={0}
      title="拖动调整宽度，双击恢复默认"
      data-testid="mind-map-split-resize-handle"
      onMouseDown={startResize}
      onDoubleClick={() => setStoredSideWidth(DEFAULT_SIDE_WIDTH)}
      onKeyDown={resizeFromKeyboard}
      className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none outline-none max-md:hidden focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/70 transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary/60',
          resizing && 'bg-primary/70',
        )}
      />
    </div>
  ) : null

  const main = (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {children}
    </section>
  )

  return (
    <div ref={containerRef} className={cn('relative flex min-h-0 min-w-0 flex-1', className)}>
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
          {resizeHandle}
          {main}
        </>
      ) : (
        <>
          {main}
          {resizeHandle}
          {rail}
          {aside}
        </>
      )}
    </div>
  )
}
