import { describe, expect, it } from 'vitest'
import type { LearningProgressNode, LearningProgressMetrics } from '@/shared/api/contracts/learningProgress'
import { indexProgress, matchesProgressFilter, memoryState, percentage, progressRows, sortProgressNodes } from './learningProgress'

const metrics: LearningProgressMetrics = { memory_total: 1, memory_reviewed: 0, memory_due: 0, quiz_total: 2, quiz_answered: 0 }
function node(id: string, children: LearningProgressNode[] = [], overrides: Partial<LearningProgressMetrics> = {}): LearningProgressNode {
  return { id, name: id, kind: children.length ? 'chapter' : 'memory_point', palace_id: 1, children, metrics: { ...metrics, ...overrides } }
}
const reviewed = node('已复习', [], { memory_reviewed: 1 })
const due = node('待复习', [], { memory_reviewed: 1, memory_due: 1 })
const unreviewed = node('未复习')
const chapter = node('细胞', [reviewed, due, unreviewed], { memory_total: 3, memory_reviewed: 2, memory_due: 1 })
const roots = [node('生物', [chapter]), { ...node('空宫殿'), kind: 'palace' as const, metrics: { ...metrics, memory_total: 0 } }]
const options = { roots, expanded: new Set<string>(), query: '', filter: 'all' as const, sort: 'default' as const }

describe('learning progress projection', () => {
  it('indexes stable identities and complete ancestors', () => {
    const entry = indexProgress(roots).get('待复习')
    expect(entry?.ancestors.map((item) => item.id)).toEqual(['生物', '细胞'])
    expect(entry?.depth).toBe(2)
  })
  it('collapses initially and expands only requested paths', () => {
    expect(progressRows(options).map((entry) => entry.node.id)).toEqual(['生物', '空宫殿'])
    expect(progressRows({ ...options, expanded: new Set(['生物']) }).map((entry) => entry.node.id)).toEqual(['生物', '细胞', '空宫殿'])
  })
  it('matrix includes only actual memory points, not empty groups', () => {
    expect(progressRows({ ...options, leavesOnly: true }).map((entry) => entry.node.id)).toEqual(['已复习', '待复习', '未复习'])
  })
  it('search finds deeply collapsed descendants and preserves path context', () => {
    const rows = progressRows({ ...options, query: '待复习' })
    expect(rows.map((entry) => entry.node.id)).toEqual(['待复习'])
    expect(rows[0].ancestors.map((item) => item.name)).toEqual(['生物', '细胞'])
  })
  it('ancestor search retains its contained memory points in the matrix', () => {
    expect(progressRows({ ...options, query: '细胞', leavesOnly: true })).toHaveLength(3)
  })
  it('filters hidden descendants without requiring expansion', () => {
    expect(progressRows({ ...options, filter: 'due', leavesOnly: true }).map((entry) => entry.node.id)).toEqual(['待复习'])
    expect(progressRows({ ...options, filter: 'unreviewed', leavesOnly: true }).map((entry) => entry.node.id)).toEqual(['未复习'])
  })
  it('sorts copies without mutating document order or averaging rounded percentages', () => {
    const nodes = [reviewed, unreviewed, due]
    expect(sortProgressNodes(nodes, 'coverage')[0]).toBe(unreviewed)
    expect(sortProgressNodes(nodes, 'due')[0]).toBe(due)
    expect(nodes[0]).toBe(reviewed)
  })
  it('handles zero totals, unanswered filters and independent due state', () => {
    expect(percentage(0, 0)).toBe(0)
    expect(percentage(1, 3)).toBe(33)
    expect(percentage(3, 2)).toBe(100)
    expect(matchesProgressFilter({ ...metrics, quiz_answered: 2 }, 'unanswered')).toBe(false)
    expect(matchesProgressFilter({ ...metrics, memory_total: 0 }, 'unreviewed')).toBe(false)
    expect(memoryState(due.metrics)).toBe('due')
    expect(memoryState(reviewed.metrics)).toBe('reviewed')
  })
  it('guards duplicate IDs and accidental cycles when indexing', () => {
    const cyclic = node('cycle')
    cyclic.children = [cyclic]
    expect(indexProgress([cyclic]).size).toBe(1)
  })
})
