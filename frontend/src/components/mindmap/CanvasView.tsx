import { useMemo, useCallback } from 'react'
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { nodeTypes } from './NodeCard'
import type { GraphData } from './adapter'

interface CanvasViewProps {
  data: GraphData
  onNodeClick?: (nodeId: string) => void
}

export function CanvasView({ data, onNodeClick }: CanvasViewProps) {
  const initialNodes: Node[] = useMemo(
    () =>
      data.nodes.map((n, i) => ({
        id: n.id,
        type: 'mindmapNode',
        position: n.metadata?.['x'] != null
          ? { x: Number(n.metadata['x']), y: Number(n.metadata['y']) }
          : { x: (i % 3) * 200, y: Math.floor(i / 3) * 140 },
        data: n,
      })),
    [data]
  )

  const initialEdges = useMemo(
    () =>
      data.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: (e.style === 'dashed' ? 'default' : 'smoothstep') as any,
        style: {
          stroke: e.style === 'dashed' ? 'var(--muted-foreground)' : 'var(--primary)',
          strokeDasharray: e.style === 'dashed' ? '5,5' : undefined,
        },
        label: e.label,
        animated: e.type === 'custom',
      })),
    [data]
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes as any)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges as any)

  useMemo(() => {
    setNodes(initialNodes as any)
    setEdges(initialEdges as any)
  }, [data])

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onNodeClick?.(node.id)
    },
    [onNodeClick]
  )

  return (
    <div className="w-full h-[500px] border rounded-lg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        attributionPosition="bottom-left"
      >
        <Controls />
        <MiniMap
          nodeColor={(n) => {
            const d = n.data as any
            return d?.type === 'peg' ? '#10b981' : '#3b82f6'
          }}
        />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      </ReactFlow>
    </div>
  )
}
