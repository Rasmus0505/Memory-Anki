import { useCallback, useRef } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

/** Two taps closer than this are one gesture, not two separate folds. */
export const COLLAPSE_DOUBLE_TAP_MS = 320

/** Clicks this soon after a pointer-level double tap belong to that gesture. */
const GESTURE_CLICK_GRACE_MS = 400

export function NodeCardCollapseToggle({
  nodeId,
  collapsed,
  descendantCount,
  onToggleCollapse,
  onExpandSubtree,
}: {
  nodeId: string
  collapsed: boolean
  descendantCount: number
  onToggleCollapse: (nodeId: string) => void
  onExpandSubtree?: (nodeId: string) => void
}) {
  /** Delay single-click fold so double-click can expand subtree without a toggle race. */
  const collapseClickTimerRef = useRef<number | null>(null)
  /** Last touch/pen tap, for a pointer-level double tap. */
  const lastTapRef = useRef<{ nodeId: string; at: number } | null>(null)
  /** Clicks before this timestamp were already handled as part of a double tap. */
  const suppressClicksUntilRef = useRef(0)
  const lastPointerTypeRef = useRef('mouse')

  const expandWholeSubtree = useCallback(() => {
    if (collapseClickTimerRef.current !== null) {
      window.clearTimeout(collapseClickTimerRef.current)
      collapseClickTimerRef.current = null
    }
    if (onExpandSubtree) {
      onExpandSubtree(nodeId)
    } else {
      onToggleCollapse(nodeId)
    }
  }, [nodeId, onExpandSubtree, onToggleCollapse])

  const handleSingleToggle = useCallback(() => {
    if (collapseClickTimerRef.current !== null) {
      window.clearTimeout(collapseClickTimerRef.current)
    }
    collapseClickTimerRef.current = window.setTimeout(() => {
      collapseClickTimerRef.current = null
      onToggleCollapse(nodeId)
    }, 220)
  }, [nodeId, onToggleCollapse])

  return (
    <button
      type="button"
      data-mindmap-collapse-toggle="true"
      aria-label={collapsed ? '展开分支' : '折叠分支'}
      title={
        collapsed
          ? `展开分支（${descendantCount} 个节点）；双击展开整棵子树`
          : '折叠分支；双击展开整棵子树'
      }
      // `touch-manipulation` stops the browser holding a phone tap for double-tap
      // zoom, which is what used to swallow the second tap of a double tap.
      className="nodrag nopan touch-manipulation absolute -right-2 top-1/2 z-30 flex h-6 min-w-6 -translate-y-1/2 items-center justify-center gap-0.5 mindmap-collapse-toggle rounded-full border border-paper-line-strong bg-paper-card px-1 text-[10px] font-semibold text-paper-muted shadow-sm hover:border-primary hover:text-primary-strong sm:h-5 sm:min-w-5"
      onPointerDown={(event) => {
        event.stopPropagation()
        lastPointerTypeRef.current = event.pointerType || 'mouse'
        // A finger often gets no `dblclick`, and the deferred single click below
        // can fire before a relaxed double tap finishes. Detect the second tap
        // here so one gesture still opens the whole branch.
        if (event.pointerType === 'mouse') return
        const now = Date.now()
        const last = lastTapRef.current
        lastTapRef.current = { nodeId, at: now }
        if (last && last.nodeId === nodeId && now - last.at <= COLLAPSE_DOUBLE_TAP_MS) {
          lastTapRef.current = null
          // The click pair for this gesture is still on its way (mobile browsers
          // may hold it ~300ms). Ignore those clicks; the branch is already open.
          suppressClicksUntilRef.current = now + GESTURE_CLICK_GRACE_MS
          expandWholeSubtree()
        }
      }}
      onClick={(event) => {
        event.stopPropagation()
        event.preventDefault()
        if (Date.now() < suppressClicksUntilRef.current) return
        // `detail >= 2` is the second click of a double-click. It covers browsers
        // that deliver the click sequence but no `dblclick` (common on touch).
        if (event.detail >= 2) {
          lastTapRef.current = null
          expandWholeSubtree()
          return
        }
        // A finger tap is already unambiguous (doubles are caught above), so it
        // folds right away instead of waiting out the mouse double-click window.
        if (lastPointerTypeRef.current !== 'mouse') {
          onToggleCollapse(nodeId)
          return
        }
        handleSingleToggle()
      }}
      onDoubleClick={(event) => {
        // Double-click fold control = expand whole subtree under this node.
        event.stopPropagation()
        event.preventDefault()
        lastTapRef.current = null
        expandWholeSubtree()
      }}
    >
      {collapsed ? (
        <>
          <ChevronRight className="size-3" />
          {descendantCount > 0 ? <span>{descendantCount}</span> : null}
        </>
      ) : (
        <ChevronDown className="size-3" />
      )}
    </button>
  )
}
