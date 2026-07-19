import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type OnEdgesChange,
  type OnNodesChange,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type OnMove,
  type Viewport,
} from '@xyflow/react'
import { nodeTypes } from './nodeTypes'

interface MindMapCanvasViewportProps {
  width: number
  height: number
  nodes: Node[]
  edges: Edge[]
  isDraggingNode: boolean
  onNodesChange: OnNodesChange<Node>
  onEdgesChange: OnEdgesChange<Edge>
  onNodeClick: (event: React.MouseEvent, node: Node) => void
  onNodeDoubleClick: (event: React.MouseEvent, node: Node) => void
  onNodeContextMenu: (event: React.MouseEvent, node: Node) => void
  onNodeDragStart: (event: unknown, node: Node) => void
  onNodeDrag: (event: unknown, node: Node) => void
  onNodeDragStop: (event: unknown, node: Node) => void
  onNodeMouseEnter: (event: React.MouseEvent, node: Node) => void
  onNodeMouseLeave: (event: React.MouseEvent, node: Node) => void
  onEdgeClick: EdgeMouseHandler
  onEdgeDoubleClick: EdgeMouseHandler
  onPaneClick: () => void
  onMoveStart?: OnMove
  onMove?: OnMove
  onMoveEnd?: OnMove
  viewport: Viewport
  onViewportChange: (viewport: Viewport) => void
  readonly?: boolean
  mobileGuided?: boolean
  preserveViewport?: boolean
}

export function MindMapCanvasViewport({
  width,
  height,
  nodes,
  edges,
  isDraggingNode,
  onNodesChange,
  onEdgesChange,
  onNodeClick,
  onNodeDoubleClick,
  onNodeContextMenu,
  onNodeDragStart,
  onNodeDrag,
  onNodeDragStop,
  onNodeMouseEnter,
  onNodeMouseLeave,
  onEdgeClick,
  onEdgeDoubleClick,
  onPaneClick,
  onMoveStart,
  onMove,
  onMoveEnd,
  viewport,
  onViewportChange,
  readonly = false,
  mobileGuided = false,
}: MindMapCanvasViewportProps) {
  const largeGraph = nodes.length >= 240
  const simplifiedDecorations = isDraggingNode || mobileGuided || largeGraph

  return (
    <div className="relative" style={{ width, height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onEdgeClick={onEdgeClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onPaneClick={onPaneClick}
        onMoveStart={onMoveStart}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        viewport={viewport}
        onViewportChange={onViewportChange}
        nodesDraggable={!readonly}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        elementsSelectable
        // Default is 1px — micro-movement on double-click (esp. yellow text) starts
        // a structure drag and can swallow enter-edit. Shell padding remains draggable.
        nodeDragThreshold={5}
        nodeTypes={nodeTypes}
        minZoom={0.38}
        maxZoom={1.4}
        proOptions={{ hideAttribution: true }}
        panOnScroll={!mobileGuided}
        panOnDrag
        autoPanOnNodeDrag={false}
        autoPanOnConnect={false}
        zoomOnPinch
        zoomOnDoubleClick={readonly && !mobileGuided}
        zoomActivationKeyCode="Control"
      >
        <Controls
          showZoom={false}
          showInteractive={false}
          className="!left-4 !top-4 !bottom-auto !rounded-lg !border !border-zinc-200 !bg-white/92 !shadow-lg"
        />
        {!simplifiedDecorations ? (
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="#e4e4e7"
          />
        ) : null}
      </ReactFlow>
    </div>
  )
}
