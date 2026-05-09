import { type ReactNode } from 'react'
import { ListTree, GitBranch } from 'lucide-react'
import { TreeRenderer } from './TreeRenderer'
import type { TreeRenderMeta } from './TreeRenderer'
import { MindMapCanvas } from './MindMapCanvas'
import type { MindMapCanvasProps } from './MindMapCanvas'
import type { GraphData } from './adapter'

export type ViewMode = 'outline' | 'canvas'

export interface MindMapContainerProps {
  title?: string
  graphData: GraphData
  view: ViewMode
  onViewChange: (v: ViewMode) => void
  treeProps: {
    nodes: any[]
    getKey: (node: any, index: number) => string | number
    getChildren: (node: any) => any[]
    renderNode: (node: any, meta: TreeRenderMeta) => ReactNode
    expanded?: Set<string | number>
    onExpandedChange?: (s: Set<string | number>) => void
    indentPerLevel?: number
    baseIndent?: number
    showConnector?: boolean
    alwaysExpanded?: boolean
  }
  canvasProps: Omit<MindMapCanvasProps, 'graphData' | 'className'>
  canvasClassName?: string
}

const views: { key: ViewMode; label: string; icon: typeof ListTree }[] = [
  { key: 'outline', label: '大纲', icon: ListTree },
  { key: 'canvas', label: '画布', icon: GitBranch },
]

export function MindMapContainer({
  title,
  graphData,
  view,
  onViewChange,
  treeProps,
  canvasProps,
  canvasClassName,
}: MindMapContainerProps) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-3">
        {title ? <h3 className="text-sm font-semibold text-foreground">{title}</h3> : null}
        <div className="inline-flex items-center rounded-2xl border border-border/70 bg-muted/30 p-1">
          {views.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => onViewChange(key)}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                view === key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {view === 'outline' ? (
          <div className="flex h-full min-h-[520px] flex-col overflow-hidden rounded-[24px] border border-border/70 bg-background/80">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {graphData.nodes.length > 0 ? (
                <TreeRenderer {...treeProps as any} />
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">还没有节点</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-[520px] min-w-0 flex-1">
            <MindMapCanvas
              graphData={graphData}
              className={canvasClassName ?? 'h-full min-h-[520px] w-full flex-1'}
              {...canvasProps}
            />
          </div>
        )}
      </div>
    </div>
  )
}
