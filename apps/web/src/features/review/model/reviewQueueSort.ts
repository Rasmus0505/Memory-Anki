import type { ReviewScheduleSummary } from '@/shared/api/contracts'

/** User-selectable review queue order. Default: earliest due first. */
export type ReviewQueueSortMode =
  | 'due_asc'
  | 'due_desc'
  | 'due_nodes_desc'
  | 'overdue_desc'
  | 'title_asc'

export interface ReviewQueueViewSettings {
  sortMode: ReviewQueueSortMode
}

export const REVIEW_QUEUE_VIEW_SETTINGS_KEY = 'review_queue_view_settings'

export const DEFAULT_REVIEW_QUEUE_VIEW_SETTINGS: ReviewQueueViewSettings = {
  sortMode: 'due_asc',
}

export const REVIEW_QUEUE_SORT_OPTIONS: ReadonlyArray<{
  value: ReviewQueueSortMode
  label: string
  description: string
}> = [
  { value: 'due_asc', label: '最早到期优先', description: '拖最久 / 逾期最久的排前面' },
  { value: 'due_desc', label: '最晚到期优先', description: '最近才到期的排前面' },
  { value: 'due_nodes_desc', label: '到期节点多优先', description: '本轮到期节点数从多到少' },
  { value: 'overdue_desc', label: '逾期节点多优先', description: '逾期节点数从多到少' },
  { value: 'title_asc', label: '宫殿名称', description: '按标题字母 / 拼音顺序' },
]

const SORT_MODES = new Set<ReviewQueueSortMode>(
  REVIEW_QUEUE_SORT_OPTIONS.map((item) => item.value),
)

export function isReviewQueueSortMode(value: unknown): value is ReviewQueueSortMode {
  return typeof value === 'string' && SORT_MODES.has(value as ReviewQueueSortMode)
}

export function isReviewQueueViewSettings(value: unknown): value is ReviewQueueViewSettings {
  if (!value || typeof value !== 'object') return false
  return isReviewQueueSortMode((value as ReviewQueueViewSettings).sortMode)
}

export function sanitizeReviewQueueViewSettings(value: unknown): ReviewQueueViewSettings {
  if (isReviewQueueViewSettings(value)) return { sortMode: value.sortMode }
  if (value && typeof value === 'object' && isReviewQueueSortMode((value as { sortMode?: unknown }).sortMode)) {
    return { sortMode: (value as ReviewQueueViewSettings).sortMode }
  }
  return { ...DEFAULT_REVIEW_QUEUE_VIEW_SETTINGS }
}

function dueStamp(item: ReviewScheduleSummary): number {
  const raw = item.next_due_at ?? item.due_at
  if (!raw) return Number.POSITIVE_INFINITY
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY
}

function titleKey(item: ReviewScheduleSummary): string {
  return (item.palace?.title || '').toLocaleLowerCase('zh-CN')
}

/**
 * Sort queue rows for display. Default due_asc puts the longest-overdue palace first.
 * Secondary keys keep order stable across equal primary values.
 */
export function sortReviewQueueItems<T extends ReviewScheduleSummary>(
  items: readonly T[],
  sortMode: ReviewQueueSortMode = 'due_asc',
): T[] {
  const mode = isReviewQueueSortMode(sortMode) ? sortMode : 'due_asc'
  const ordered = [...items]
  ordered.sort((left, right) => {
    if (mode === 'due_asc') {
      return dueStamp(left) - dueStamp(right) || left.palace_id - right.palace_id
    }
    if (mode === 'due_desc') {
      const leftDue = Number.isFinite(dueStamp(left)) ? dueStamp(left) : Number.NEGATIVE_INFINITY
      const rightDue = Number.isFinite(dueStamp(right)) ? dueStamp(right) : Number.NEGATIVE_INFINITY
      return rightDue - leftDue || left.palace_id - right.palace_id
    }
    if (mode === 'due_nodes_desc') {
      return (
        (right.due_node_count ?? 0) - (left.due_node_count ?? 0) ||
        dueStamp(left) - dueStamp(right) ||
        left.palace_id - right.palace_id
      )
    }
    if (mode === 'overdue_desc') {
      return (
        (right.overdue_node_count ?? 0) - (left.overdue_node_count ?? 0) ||
        dueStamp(left) - dueStamp(right) ||
        left.palace_id - right.palace_id
      )
    }
    // title_asc
    return (
      titleKey(left).localeCompare(titleKey(right), 'zh-CN') ||
      dueStamp(left) - dueStamp(right) ||
      left.palace_id - right.palace_id
    )
  })
  return ordered
}
