import { useEffect, type ReactNode } from 'react'
import { List, GitBranch, Move } from 'lucide-react'
import { TreeRenderer } from './TreeRenderer'
import type { TreeRenderMeta } from './TreeRenderer'
import { GraphView } from './GraphView'
import { CanvasView } from './CanvasView'
import type { GraphData, MindMapNode } from './adapter'

export type ViewMode = 'outline' | 'graph' | 'canvas'

export interface MindMapContainerProps {
  title?: string
  graphData: GraphData
  view: ViewMode
  onViewChange: (v: ViewMode) => void
  onNodeClick?: (node: MindMapNode) => void
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
  }
}

const views: { key: ViewMode; label: string; icon: typeof List }[] = [
  { key: 'outline', label: '大纲', icon: List },
  { key: 'graph', label: '图谱', icon: GitBranch },
  { key: 'canvas', label: '画布', icon: Move },
]

export function MindMapContainer({
  title,
  graphData,
  view,
  onViewChange,
  onNodeClick,
  treeProps,
}: MindMapContainerProps) {
  const handleGraphNodeClick = (nodeId: string) => {
    const found = graphData.nodes.find((n) => n.id === nodeId)
    if (found) onNodeClick?.(found)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2 shrink-0">
        {title && <h3 className="text-sm font-semibold">{title}</h3>}
        <div className="flex items-center rounded-lg border bg-muted/30 p-0.5">
          {views.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => onViewChange(key)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors
                ${view === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* View content */}
      {view === 'outline' && (
        <div className="border rounded-lg p-3 flex-1 min-h-0 overflow-y-auto">
          {graphData.nodes.length > 0 ? (
            <TreeRenderer {...treeProps} />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">还没有节点</p>
          )}
        </div>
      )}
      {view === 'graph' && (
        <GraphView data={graphData} onNodeClick={handleGraphNodeClick} />
      )}
      {view === 'canvas' && (
        <CanvasView data={graphData} onNodeClick={handleGraphNodeClick} />
      )}
    </div>
  )
}
