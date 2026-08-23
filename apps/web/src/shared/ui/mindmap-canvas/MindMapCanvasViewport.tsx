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
import {
  MINDMAP_MANUAL_MAX_ZOOM,
  MINDMAP_MANUAL_MIN_ZOOM,
} from './mindMapViewportConfig'

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
  /** Explicit `guided` policy only: one-finger drag belongs to a parent scroller (freestyle feed). */
  yieldOneFingerPan?: boolean
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
  yieldOneFingerPan = false,
}: MindMapCanvasViewportProps) {
  // Large-graph mode: skip dots earlier once collapse still leaves a wide map.
  const largeGraph = nodes.length >= 120
  const simplifiedDecorations = isDraggingNode || mobileGuided || largeGraph
  // Virtualize node DOM once the visible set is non-trivial.
  const onlyRenderVisible = nodes.length >= 48 || largeGraph

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
        minZoom={MINDMAP_MANUAL_MIN_ZOOM}
        maxZoom={MINDMAP_MANUAL_MAX_ZOOM}
        onlyRenderVisibleElements={onlyRenderVisible}
        proOptions={{ hideAttribution: true }}
        panOnScroll={!yieldOneFingerPan}
        // Only explicit `guided` yields one-finger drag to a parent scroller.
        // `auto` still uses the phone camera, but standalone maps stay pannable.
        // Two-finger pinch still pans/zooms via zoomOnPinch.
        panOnDrag={!yieldOneFingerPan}
        preventScrolling={!yieldOneFingerPan}
        autoPanOnNodeDrag={false}
        autoPanOnConnect={false}
        zoomOnPinch
        zoomOnDoubleClick={readonly && !mobileGuided}
        zoomActivationKeyCode="Control"
      >
        {/* Zoom/interactive are off, so this panel is a single fitView button — the same
            action as 适应整树 in the toolbar. On phone it reads as a stray white square
            floating over the map, so it yields to the toolbar copy. */}
        <Controls
          showZoom={false}
          showInteractive={false}
          className="!left-4 !top-4 !bottom-auto !rounded-lg !border !border-zinc-200 !bg-white/92 !shadow-lg max-sm:!hidden"
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
