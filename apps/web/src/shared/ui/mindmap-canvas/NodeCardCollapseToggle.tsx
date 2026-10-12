import { useRef } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

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
      className="nodrag nopan absolute -right-2 top-1/2 z-30 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center gap-0.5 mindmap-collapse-toggle rounded-full border border-paper-line-strong bg-paper-card px-1 text-[10px] font-semibold text-paper-muted shadow-sm hover:border-primary hover:text-primary-strong"
      onClick={(event) => {
        event.stopPropagation()
        event.preventDefault()
        // Defer toggle: a double-click fires click+click+dblclick; only the
        // single-click path should flip one level after a short delay.
        if (collapseClickTimerRef.current !== null) {
          window.clearTimeout(collapseClickTimerRef.current)
        }
        collapseClickTimerRef.current = window.setTimeout(() => {
          collapseClickTimerRef.current = null
          onToggleCollapse(nodeId)
        }, 220)
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        // Double-click fold control = expand whole subtree under this node.
        event.stopPropagation()
        event.preventDefault()
        if (collapseClickTimerRef.current !== null) {
          window.clearTimeout(collapseClickTimerRef.current)
          collapseClickTimerRef.current = null
        }
        if (onExpandSubtree) {
          onExpandSubtree(nodeId)
        } else {
          onToggleCollapse(nodeId)
        }
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
