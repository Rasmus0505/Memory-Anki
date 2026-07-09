import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type OnEdgesChange,
  type OnNodesChange,
  type Edge,
  type EdgeMouseHandler,
  type Node,
} from '@xyflow/react'
import type { LayoutRole } from './layout'
import { nodeTypes } from './NodeCard'

interface MindMapCanvasViewportProps {
  width: number
  height: number
  nodes: Node[]
  edges: Edge[]
  isDraggingNode: boolean
  onNodesChange: OnNodesChange<Node>
  onEdgesChange: OnEdgesChange<Edge>
  onNodeClick: (event: React.MouseEvent, node: Node) => void
  onNodeContextMenu: (event: React.MouseEvent, node: Node) => void
  onNodeDragStart: (event: unknown, node: Node) => void
  onNodeDrag: (event: unknown, node: Node) => void
  onNodeDragStop: (event: unknown, node: Node) => void
  onNodeMouseEnter: (event: React.MouseEvent, node: Node) => void
  onNodeMouseLeave: (event: React.MouseEvent, node: Node) => void
  onEdgeClick: EdgeMouseHandler
  onEdgeDoubleClick: EdgeMouseHandler
  onPaneClick: () => void
  readonly?: boolean
  mobileGuided?: boolean
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
  onNodeContextMenu,
  onNodeDragStart,
  onNodeDrag,
  onNodeDragStop,
  onNodeMouseEnter,
  onNodeMouseLeave,
  onEdgeClick,
  onEdgeDoubleClick,
  onPaneClick,
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
        onNodeContextMenu={onNodeContextMenu}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onEdgeClick={onEdgeClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onPaneClick={onPaneClick}
        nodesDraggable={!readonly}
        nodesConnectable={false}
        elementsSelectable
        nodeTypes={nodeTypes}
        defaultViewport={{ x: 4, y: 18, zoom: 0.99 }}
        minZoom={0.38}
        maxZoom={1.4}
        proOptions={{ hideAttribution: true }}
        panOnScroll={!mobileGuided}
        panOnDrag
        zoomOnPinch
        zoomOnDoubleClick={!mobileGuided}
        zoomActivationKeyCode="Control"
      >
        <Controls
          showZoom={false}
          showInteractive={false}
          className="!left-4 !top-4 !bottom-auto !rounded-lg !border !border-zinc-200 !bg-white/92 !shadow-lg"
        />
        {!simplifiedDecorations ? (
          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={2.5}
            nodeColor={(node) => {
              const data = node.data as {
                metadata?: { branchColor?: string; layoutRole?: LayoutRole }
              }
              if (data?.metadata?.layoutRole === 'root') return '#18181b'
              return data?.metadata?.branchColor ?? '#2563eb'
            }}
            className="!bottom-4 !right-4 !h-[116px] !w-[190px] !overflow-hidden !rounded-lg !border !border-zinc-200 !bg-white/92 !shadow-lg"
          />
        ) : null}
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
