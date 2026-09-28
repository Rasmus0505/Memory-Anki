import type { ExamChapterRow, ExamOverview, ExamPalaceRow, ExamStarSource } from '@/shared/api/contracts'

export function clampStars(value: unknown): 1 | 2 | 3 {
  const stars = Math.round(Number(value) || 1)
  return (stars >= 3 ? 3 : stars <= 1 ? 1 : 2) as 1 | 2 | 3
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—'
  return `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`
}

export function formatDaysLeft(daysLeft: number | null | undefined): string {
  if (daysLeft == null) return '未设置考试'
  if (daysLeft > 0) return `距考试 ${daysLeft} 天`
  if (daysLeft === 0) return '今天考试'
  return `考试已过 ${-daysLeft} 天`
}

const SOURCE_LABELS: Record<ExamStarSource, string> = {
  manual: '手动',
  ai: 'AI 写入',
  chapter: '继承章节',
  derived: '按题目推算',
}

export function starSourceLabel(source: ExamStarSource | null | undefined): string {
  return source ? SOURCE_LABELS[source] ?? source : '未设置'
}

/** Warm mastery ramp: coral (weak) -> amber -> grass green (mastered). */
export function masteryColor(ratio: number, learned: boolean): string {
  if (!learned) return 'var(--color-muted)'
  const clamped = Math.max(0, Math.min(1, ratio))
  if (clamped >= 0.8) return 'color-mix(in oklab, var(--color-success) 78%, var(--color-card))'
  if (clamped >= 0.5) return 'color-mix(in oklab, var(--color-warning) 70%, var(--color-card))'
  if (clamped >= 0.2) return 'color-mix(in oklab, var(--color-primary) 55%, var(--color-card))'
  return 'color-mix(in oklab, var(--color-destructive) 55%, var(--color-card))'
}

export interface ChapterNode {
  chapter: ExamChapterRow
  children: ChapterNode[]
  palaces: ExamPalaceRow[]
  unitCount: number
  learnedCount: number
  masteryWeighted: number
}

/** Subject -> chapter tree with palaces attached to their primary chapter. */
export function buildKnowledgeMap(overview: ExamOverview, subjectId: number) {
  const chapters = overview.chapters.filter((chapter) => chapter.subject_id === subjectId)
  const nodes = new Map<number, ChapterNode>()
  for (const chapter of chapters) {
    nodes.set(chapter.id, { chapter, children: [], palaces: [], unitCount: 0, learnedCount: 0, masteryWeighted: 0 })
  }
  const roots: ChapterNode[] = []
  for (const node of nodes.values()) {
    const parent = node.chapter.parent_id != null ? nodes.get(node.chapter.parent_id) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const loose: ExamPalaceRow[] = []
  for (const palace of overview.palaces) {
    if (palace.subject_id !== subjectId) continue
    const node = palace.chapter_id != null ? nodes.get(palace.chapter_id) : undefined
    if (node) node.palaces.push(palace)
    else loose.push(palace)
  }
  const byOrder = (a: ChapterNode, b: ChapterNode) =>
    a.chapter.sort_order - b.chapter.sort_order || a.chapter.id - b.chapter.id
  const rollUp = (node: ChapterNode, seen: Set<number>) => {
    if (seen.has(node.chapter.id)) return
    seen.add(node.chapter.id)
    node.children.sort(byOrder)
    for (const palace of node.palaces) {
      node.unitCount += palace.unit_count
      node.learnedCount += palace.learned_count
      node.masteryWeighted += palace.mastery_ratio * palace.unit_count
    }
    for (const child of node.children) {
      rollUp(child, seen)
      node.unitCount += child.unitCount
      node.learnedCount += child.learnedCount
      node.masteryWeighted += child.masteryWeighted
    }
  }
  const seen = new Set<number>()
  roots.sort(byOrder)
  for (const root of roots) rollUp(root, seen)
  return { roots, loose }
}

export function nodeMastery(node: ChapterNode): number {
  return node.unitCount ? node.masteryWeighted / node.unitCount : 0
}
