import {
  ReactFlowProvider,
} from '@xyflow/react'
import type { ComponentType } from 'react'
import '@xyflow/react/dist/style.css'
import { NodeContextMenu } from './NodeContextMenu'
import type { ContextMenuAction } from './NodeContextMenu'
import type { GraphData } from './adapter'
import { MindMapCanvasToolbar } from './MindMapCanvasToolbar'
import { MindMapCanvasViewport } from './MindMapCanvasViewport'
import { useMindMapCanvasState } from './useMindMapCanvasState'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'

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
  readonly?: boolean
  showToolbar?: boolean
  onNodeActivate?: (nodeId: string) => void
  onNodeContextAction?: (nodeId: string) => void
  onNodeHover?: (nodeId: string | null) => void
  buildNodeActions?: (nodeId: string) => ContextMenuAction[]
  className?: string
}

function MindMapCanvasInner({
  focusMode = false,
  onToggleFocusMode,
  showToolbar = true,
  className,
  ...props
}: MindMapCanvasProps) {
  const state = useMindMapCanvasState({ ...props, focusMode })
  const handleToggleFocusMode = () => {
    dispatchGlobalFeedback('mode_switch', {
      origin: 'toolbar',
      label: focusMode ? 'EXIT' : 'FOCUS',
    })
    onToggleFocusMode?.()
  }

  return (
    <div
      ref={state.frameRef}
      className={`relative flex h-full min-h-[520px] min-w-0 flex-col overflow-hidden rounded-[14px] border border-zinc-200 bg-zinc-50 shadow-[0_18px_44px_rgba(24,24,27,0.08)] ${className ?? ''}`}
    >
      {showToolbar ? (
        <MindMapCanvasToolbar
          focusMode={focusMode}
          canUndo={state.canUndo}
          canRedo={state.canRedo}
          showHistoryControls={state.canShowHistoryControls}
          onReflow={state.resetLayout}
          onZoomOut={state.zoomOutCanvas}
          onZoomIn={state.zoomInCanvas}
          onToggleFocusMode={handleToggleFocusMode}
          onUndo={props.onUndo}
          onRedo={props.onRedo}
        />
      ) : null}

      <div className="min-h-0 flex-1">
        {state.isCanvasReady ? (
          <MindMapCanvasViewport
            width={state.canvasSize.width}
            height={state.canvasSize.height}
            nodes={state.displayNodes}
            edges={state.displayEdges}
            isDraggingNode={state.isDraggingNode}
            onNodesChange={state.onNodesChange}
            onEdgesChange={state.onEdgesChange}
            onNodeClick={state.handleNodeClick}
            onNodeContextMenu={state.handleNodeContextMenu}
            onNodeDragStart={state.handleNodeDragStart}
            onNodeDrag={state.handleNodeDrag}
            onNodeDragStop={state.handleNodeDragStop}
            onNodeMouseEnter={state.handleNodeMouseEnter}
            onNodeMouseLeave={state.handleNodeMouseLeave}
            onEdgeClick={state.handleEdgeClick}
            onEdgeDoubleClick={state.handleEdgeDoubleClick}
            onPaneClick={state.handlePaneClick}
            readonly={Boolean(props.readonly)}
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
