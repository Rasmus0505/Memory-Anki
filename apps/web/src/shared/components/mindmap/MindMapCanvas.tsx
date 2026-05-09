import {
  ReactFlowProvider,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { NodeContextMenu } from './NodeContextMenu'
import type { GraphData } from './adapter'
import { MindMapCanvasToolbar } from './MindMapCanvasToolbar'
import { MindMapCanvasViewport } from './MindMapCanvasViewport'
import { useMindMapCanvasState } from './useMindMapCanvasState'

export interface MindMapCanvasProps {
  graphData: GraphData
  selectedNodeId: string | null
  onNodeSelect: (nodeId: string | null) => void
  onAddChild: (parentId: string) => void
  onAddSibling: (nodeId: string) => void
  onDelete: (nodeId: string) => void
  onReparent?: (sourceId: string, targetId: string) => void
  onEdit?: (nodeId: string, text: string) => void
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
  focusMode?: boolean
  onToggleFocusMode?: () => void
  onEdgeDelete?: (edgeId: string, sourceId: string, targetId: string) => void
  onEdgeInsert?: (edgeId: string, sourceId: string, targetId: string) => void
  onReorderSibling?: (sourceId: string, targetId: string, position: 'before' | 'after') => void
  onMoveUp?: (nodeId: string) => void
  onMoveDown?: (nodeId: string) => void
  canMoveUp?: (nodeId: string) => boolean
  canMoveDown?: (nodeId: string) => boolean
  className?: string
}

function MindMapCanvasInner({
  focusMode = false,
  onToggleFocusMode,
  className,
  ...props
}: MindMapCanvasProps) {
  const state = useMindMapCanvasState({ ...props, focusMode })
  return (
    <div
      ref={state.frameRef}
      className={`relative flex h-full min-h-[520px] min-w-0 flex-col overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-[0_16px_48px_rgba(15,23,42,0.06)] ${className ?? ''}`}
    >
      <MindMapCanvasToolbar
        focusMode={focusMode}
        canUndo={state.canUndo}
        canRedo={state.canRedo}
        showHistoryControls={state.canShowHistoryControls}
        onReflow={state.resetLayout}
        onZoomOut={state.zoomOutCanvas}
        onZoomIn={state.zoomInCanvas}
        onToggleFocusMode={onToggleFocusMode}
        onUndo={props.onUndo}
        onRedo={props.onRedo}
      />

      <div className="min-h-0 flex-1">
        {state.isCanvasReady ? (
          <MindMapCanvasViewport
            width={state.canvasSize.width}
            height={state.canvasSize.height}
            nodes={state.displayNodes}
            edges={state.displayEdges}
            onNodesChange={state.onNodesChange}
            onEdgesChange={state.onEdgesChange}
            onNodeClick={state.handleNodeClick}
            onNodeContextMenu={state.handleNodeContextMenu}
            onNodeDragStart={state.handleNodeDragStart}
            onNodeDrag={state.handleNodeDrag}
            onNodeDragStop={state.handleNodeDragStop}
            onEdgeClick={state.handleEdgeClick}
            onEdgeDoubleClick={state.handleEdgeDoubleClick}
            onPaneClick={state.handlePaneClick}
          />
        ) : (
          <div className="flex h-full min-h-[360px] items-center justify-center text-sm text-muted-foreground">
            正在准备画布...
          </div>
        )}
      </div>

      {state.ctxMenu ? (
        <NodeContextMenu
          x={state.ctxMenu.x}
          y={state.ctxMenu.y}
          onClose={state.closeNodeMenu}
          actions={state.nodeActions}
        />
      ) : null}
      {state.edgeMenu ? (
        <NodeContextMenu
          x={state.edgeMenu.x}
          y={state.edgeMenu.y}
          onClose={state.closeEdgeMenu}
          actions={state.edgeActions}
        />
      ) : null}
    </div>
  )
}

export function MindMapCanvas(props: MindMapCanvasProps) {
  return (
    <ReactFlowProvider>
      <MindMapCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
