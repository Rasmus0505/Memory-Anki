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
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import { nodeTypes } from './NodeCard'
import type { GraphData } from './adapter'

const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
const NODE_WIDTH = 160
const NODE_HEIGHT = 80

function applyDagreLayout(graphData: GraphData): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 60 })

  for (const node of graphData.nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const edge of graphData.edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  const nodes: Node[] = graphData.nodes.map((n) => {
    const pos = g.node(n.id)
    return {
      id: n.id,
      type: 'mindmapNode',
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: n,
    }
  })

  const edges: Edge[] = graphData.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    style: {
      stroke: e.style === 'dashed' ? 'var(--muted-foreground)' : 'var(--primary)',
      strokeDasharray: e.style === 'dashed' ? '5,5' : undefined,
    },
    label: e.label,
    animated: e.type === 'custom',
  }))

  return { nodes, edges }
}

interface GraphViewProps {
  data: GraphData
  onNodeClick?: (nodeId: string) => void
}

export function GraphView({ data, onNodeClick }: GraphViewProps) {
  const layouted = useMemo(() => applyDagreLayout(data), [data])

  const [nodes, setNodes, onNodesChange] = useNodesState(layouted.nodes as any)
  const [edges, setEdges, onEdgesChange] = useEdgesState(layouted.edges as any)

  // Sync when data changes
  useMemo(() => {
    const { nodes: newNodes, edges: newEdges } = applyDagreLayout(data)
    setNodes(newNodes as any)
    setEdges(newEdges as any)
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
