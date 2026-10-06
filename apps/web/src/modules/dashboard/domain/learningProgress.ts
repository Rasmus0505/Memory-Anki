import type { LearningProgressNode, LearningProgressMetrics } from '@/shared/api/contracts/learningProgress'

export type ProgressView = 'hierarchy' | 'matrix' | 'questions'
export type ProgressFilter = 'all' | 'due' | 'unreviewed' | 'unanswered'
export type ProgressSort = 'default' | 'coverage' | 'due'
export interface IndexedProgressNode {
  node: LearningProgressNode
  ancestors: LearningProgressNode[]
  depth: number
}

export function percentage(value: number, total: number): number {
  return total > 0 ? Math.min(100, Math.max(0, Math.round(value / total * 100))) : 0
}

export function indexProgress(roots: LearningProgressNode[]): Map<string, IndexedProgressNode> {
  const result = new Map<string, IndexedProgressNode>()
  const visit = (nodes: LearningProgressNode[], ancestors: LearningProgressNode[]) => {
    for (const node of nodes) {
      if (result.has(node.id)) continue
      result.set(node.id, { node, ancestors, depth: ancestors.length })
      visit(node.children, [...ancestors, node])
    }
  }
  visit(roots, [])
  return result
}

export function matchesProgressFilter(metrics: LearningProgressMetrics, filter: ProgressFilter): boolean {
  if (filter === 'due') return metrics.memory_due > 0
  if (filter === 'unreviewed') return metrics.memory_reviewed < metrics.memory_total
  if (filter === 'unanswered') return metrics.quiz_answered < metrics.quiz_total
  return true
}

export function sortProgressNodes(nodes: LearningProgressNode[], sort: ProgressSort): LearningProgressNode[] {
  if (sort === 'default') return nodes
  return [...nodes].sort((a, b) => {
    if (sort === 'due') return b.metrics.memory_due - a.metrics.memory_due
    const aCoverage = a.metrics.memory_total ? a.metrics.memory_reviewed / a.metrics.memory_total : 1
    const bCoverage = b.metrics.memory_total ? b.metrics.memory_reviewed / b.metrics.memory_total : 1
    return aCoverage - bCoverage
  })
}

export function progressRows({ roots, expanded, query, filter, sort, leavesOnly = false }: {
  roots: LearningProgressNode[]
  expanded: Set<string>
  query: string
  filter: ProgressFilter
  sort: ProgressSort
  leavesOnly?: boolean
}): IndexedProgressNode[] {
  const result: IndexedProgressNode[] = []
  const visited = new Set<string>()
  const needle = query.trim().toLocaleLowerCase()
  const visit = (nodes: LearningProgressNode[], ancestors: LearningProgressNode[]) => {
    for (const node of sortProgressNodes(nodes, sort)) {
      if (visited.has(node.id)) continue
      visited.add(node.id)
      const nameMatches = !needle || [...ancestors, node].some((part) => part.name.toLocaleLowerCase().includes(needle))
      const isLeaf = node.kind === 'memory_point'
      if (nameMatches && matchesProgressFilter(node.metrics, filter) && (!leavesOnly || isLeaf)) {
        result.push({ node, ancestors, depth: ancestors.length })
      }
      if (leavesOnly || needle || filter !== 'all' || expanded.has(node.id)) visit(node.children, [...ancestors, node])
    }
  }
  visit(roots, [])
  return result
}

export function memoryState(metrics: LearningProgressMetrics): 'due' | 'reviewed' | 'unreviewed' {
  if (metrics.memory_due > 0) return 'due'
  return metrics.memory_reviewed > 0 ? 'reviewed' : 'unreviewed'
}

export const STATE_LABELS = { due: '待复习', reviewed: '有复习记录', unreviewed: '暂无复习记录' } as const

export const KIND_LABELS: Record<string, string> = {
  subject: '学科', palace: '宫殿', chapter: '章节', unit: '单元', memory_point: '记忆点',
}
