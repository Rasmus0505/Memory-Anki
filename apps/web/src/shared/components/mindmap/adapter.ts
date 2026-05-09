export type MindMapNodeType = 'chapter' | 'peg'

export interface MindMapNode {
  id: string
  type: MindMapNodeType
  label: string
  originalId: number
  parentId: string | null
  metadata: Record<string, unknown>
}

export interface MindMapEdge {
  id: string
  source: string
  target: string
  type: 'parent-child' | 'custom'
  label?: string
  style?: 'solid' | 'dashed' | 'dotted'
}

export interface GraphData {
  nodes: MindMapNode[]
  edges: MindMapEdge[]
}

export interface TreeNodeLike {
  id: number
  name: string
  parent_id?: number | null
  children?: TreeNodeLike[]
  [key: string]: unknown
}

function makeId(type: MindMapNodeType, id: number): string {
  return `${type}-${id}`
}

function flattenTree(
  nodes: TreeNodeLike[],
  type: MindMapNodeType,
  parentId: string | null,
  depth: number
): { nodes: MindMapNode[]; edges: MindMapEdge[] } {
  const result: { nodes: MindMapNode[]; edges: MindMapEdge[] } = { nodes: [], edges: [] }

  for (const node of nodes) {
    const nodeId = makeId(type, node.id)

    const { ...rest } = node
    result.nodes.push({
      id: nodeId,
      type,
      label: node.name,
      originalId: node.id,
      parentId,
      metadata: { ...rest, depth },
    })

    if (parentId) {
      result.edges.push({
        id: `${parentId}->${nodeId}`,
        source: parentId,
        target: nodeId,
        type: 'parent-child',
      })
    }

    if (node.children?.length) {
      const childResult = flattenTree(
        node.children,
        type,
        nodeId,
        depth + 1
      )
      result.nodes.push(...childResult.nodes)
      result.edges.push(...childResult.edges)
    }
  }

  return result
}

export function chapterTreeToGraph(chapters: TreeNodeLike[]): GraphData {
  return flattenTree(chapters, 'chapter', null, 0)
}

export function pegTreeToGraph(pegs: TreeNodeLike[]): GraphData {
  return flattenTree(pegs, 'peg', null, 0)
}

export function mergeCustomConnections(graph: GraphData, connections: MindMapEdge[]): GraphData {
  return {
    nodes: graph.nodes,
    edges: [...graph.edges, ...connections],
  }
}
