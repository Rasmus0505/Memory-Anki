import { MODE_LABELS } from '@/modules/practice/ui/freestyle/model/freestyle-labels'
import type { FreestyleMode } from '@/modules/practice/ui/freestyle/model/today-training'
import type {
  FreestyleActionCard,
  FreestyleCard,
  FreestyleMindMapBranchCard,
  FreestylePalaceContext,
  FreestyleQuizCard,
  PalaceGroupedItem,
  PalaceGroupedListResponse,
} from '@/shared/api/contracts'

export function isQuizCard(card: FreestyleCard | null | undefined): card is FreestyleQuizCard {
  return card?.type === 'quiz_question'
}

export function isActionCard(card: FreestyleCard | null | undefined): card is FreestyleActionCard {
  return card?.type === 'action'
}

export function isMindMapBranchCard(
  card: FreestyleCard | null | undefined,
): card is FreestyleMindMapBranchCard {
  return card?.type === 'mindmap_branch'
}

/**
 * React key for one feed row. A content edit bumps the card's ``:rN`` revision,
 * and the rebuilt feed then carries the same unit under a new id. Keying the row
 * by the raw id unmounted the card the learner was reading — the map came back
 * folded to its root and the viewport flickered. A retry occurrence and a quiz
 * are distinct work, so those keep their own id.
 */
export function freestyleFeedCardKey(card: FreestyleCard): string {
  if (isQuizCard(card) || isActionCard(card)) return card.id
  if (!isMindMapBranchCard(card) || !card.unit_id) return card.id
  if (card.occurrence_kind === 'retry') return card.id
  return `unit:${card.unit_id}`
}

export function stringListsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false
  return left.every((item, index) => item === right[index])
}

export function flattenPalaceOptions(
  data: PalaceGroupedListResponse | null,
): FreestylePalaceContext[] {
  if (!data) return []
  const items: PalaceGroupedItem[] = []
  for (const subject of data.subjects || []) {
    for (const group of subject.chapter_groups || []) {
      items.push(...(group.palaces || []))
    }
    items.push(...(subject.ungrouped_palaces || []))
  }
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    resolved_title: item.resolved_title || item.title,
    subject: item.resolved_subject
      ? {
          id: item.resolved_subject.id,
          name: item.resolved_subject.name,
          color: item.resolved_subject.color,
        }
      : null,
    primary_chapter: item.primary_chapter
      ? {
          id: item.primary_chapter.id,
          name: item.primary_chapter.name,
          subject_id: item.primary_chapter.subject_id,
          parent_id: item.primary_chapter.parent_id,
        }
      : null,
  }))
}

export function buildFreestyleLoadDiagnosticText({
  error,
  mode,
}: {
  error: string
  mode: FreestyleMode
}) {
  if (typeof window === 'undefined') return error
  return [
    `随心队列加载失败（${MODE_LABELS[mode]}）`,
    error,
    `当前页面：${window.location.href}`,
    `在线状态：${
      typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline'
    }`,
    typeof navigator !== 'undefined' ? `浏览器：${navigator.userAgent}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

export function uniquePalaceContexts(cards: FreestyleCard[]) {
  const map = new Map<number, FreestylePalaceContext>()
  cards.forEach((card) => {
    if (!card.palace_context?.id) return
    map.set(card.palace_context.id, card.palace_context)
  })
  return Array.from(map.values()).sort((a, b) => a.id - b.id)
}
