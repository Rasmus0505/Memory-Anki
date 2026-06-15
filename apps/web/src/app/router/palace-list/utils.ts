import { cn } from '@/shared/lib/utils'
import { parseApiDateTime } from '@/shared/lib/dateTime'
import type {
  MiniReviewMode,
  PalaceSegmentSummary,
  ReviewStageSummary,
} from '@/shared/api/contracts'
import type {
  PalaceListDensityMode,
  PalaceListLayoutMode,
} from '@/app/router/palace-view-settings'

export interface StageEditState {
  palaceId: number
  segment: PalaceSegmentSummary
  stage: ReviewStageSummary
}

export type ReviewButtonState = 'due_now' | 'due_later_today' | 'future' | 'unscheduled'

export function getListSectionWrapperClass(layoutMode: PalaceListLayoutMode) {
  if (layoutMode === 'chapter-card-grid') return 'grid gap-4 xl:grid-cols-2'
  return 'space-y-4'
}

export function getChapterPalaceGridClass(layoutMode: PalaceListLayoutMode) {
  if (layoutMode === 'chapter-double') return 'grid gap-3 xl:grid-cols-2'
  if (layoutMode === 'flow') return 'grid gap-3 md:grid-cols-2 2xl:grid-cols-3'
  return 'space-y-3'
}

export function getUngroupedPalaceGridClass(layoutMode: PalaceListLayoutMode) {
  if (layoutMode === 'chapter-double' || layoutMode === 'chapter-card-grid') return 'grid gap-3 xl:grid-cols-2'
  if (layoutMode === 'flow') return 'grid gap-3 md:grid-cols-2 2xl:grid-cols-3'
  return 'space-y-3'
}

export function getChapterCardClass(
  layoutMode: PalaceListLayoutMode,
  densityMode: PalaceListDensityMode,
) {
  const densityClass =
    densityMode === 'comfortable'
      ? 'rounded-3xl p-5'
      : densityMode === 'compact'
        ? 'rounded-2xl p-3'
        : 'rounded-3xl p-4'

  if (layoutMode === 'chapter-card-grid') {
    return cn('border border-border/70 bg-card/90 shadow-sm', densityClass)
  }
  if (layoutMode === 'flow') {
    return cn('border border-dashed border-border/60 bg-transparent', densityClass)
  }
  return 'mb-3'
}

export function getPalaceCardClass(densityMode: PalaceListDensityMode) {
  if (densityMode === 'comfortable') return 'transition-shadow hover:shadow-md'
  if (densityMode === 'compact') return 'transition-shadow hover:shadow-sm'
  return 'transition-shadow hover:shadow-md'
}

export function getPalaceCardContentClass(densityMode: PalaceListDensityMode) {
  if (densityMode === 'comfortable') return 'gap-4 p-5'
  if (densityMode === 'compact') return 'gap-2 p-3'
  return 'gap-3 p-4'
}

export function getPalaceIconClass(densityMode: PalaceListDensityMode) {
  if (densityMode === 'comfortable') return 'h-11 w-11 rounded-xl'
  if (densityMode === 'compact') return 'h-9 w-9 rounded-lg'
  return 'h-10 w-10 rounded-lg'
}

export function getSegmentListClass(densityMode: PalaceListDensityMode) {
  if (densityMode === 'comfortable') return 'mt-3.5 space-y-3'
  if (densityMode === 'compact') return 'mt-2.5 space-y-2'
  return 'mt-3 space-y-2.5'
}

export function getSegmentCardClass(densityMode: PalaceListDensityMode) {
  if (densityMode === 'comfortable') return 'rounded-2xl px-4 py-3.5'
  if (densityMode === 'compact') return 'rounded-xl px-3 py-2'
  return 'rounded-2xl px-3 py-3'
}

export function getReviewActionButtonClass(options: {
  state: ReviewButtonState
  disabled?: boolean
  isSleepReview?: boolean
  className?: string
}) {
  const { state, disabled = false, isSleepReview = false, className } = options
  return cn(
    'h-8 w-full rounded-md border text-xs font-medium transition-colors',
    state === 'due_now' &&
      'border-success bg-success text-white hover:bg-success/80',
    state === 'due_later_today' &&
      'border-warning/50 bg-warning/20 text-warning hover:bg-warning/30',
    isSleepReview && 'border-info bg-info text-white hover:bg-info/80',
    disabled && 'border-border bg-muted/30 text-muted-foreground',
    className,
  )
}

export function formatRelativeReviewTime(value: string | null): string {
  if (!value) return '未排入正式复习'
  const target = parseApiDateTime(value)
  if (Number.isNaN(target.getTime())) return '未排入正式复习'

  const diffMs = target.getTime() - Date.now()
  if (diffMs <= 0) return '开始复习'

  const totalMinutes = Math.floor(diffMs / (1000 * 60))
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60))
  const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (totalMinutes < 60) {
    return `${Math.max(1, totalMinutes)}分钟`
  }

  if (totalHours < 24) {
    const hours = totalHours
    const minutes = totalMinutes % 60
    return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`
  }

  if (totalDays < 30) {
    const days = totalDays
    const hours = totalHours % 24
    return hours > 0 ? `${days}天${hours}小时` : `${days}天`
  }

  const months = Math.floor(totalDays / 30)
  const days = totalDays % 30
  return days > 0 ? `${months}月${days}天` : `${months}天`
}

export function getReviewButtonState(value: string | null): ReviewButtonState {
  if (!value) return 'unscheduled'
  const target = parseApiDateTime(value)
  if (Number.isNaN(target.getTime())) return 'unscheduled'
  const now = new Date()
  if (target.getTime() <= now.getTime()) return 'due_now'
  const sameDay =
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate()
  return sameDay ? 'due_later_today' : 'future'
}

export function getReviewActionLabel(
  value: string | null,
  options: {
    state?: ReviewButtonState
    loading?: boolean
    isSleepReview?: boolean
    unscheduledLabel?: string
  } = {},
): string {
  const {
    state = getReviewButtonState(value),
    loading = false,
    isSleepReview = false,
    unscheduledLabel = '未排入复习',
  } = options

  if (loading) return '加载中...'
  if (isSleepReview) return '睡前复习'
  if (state === 'due_now') return '开始复习'
  if (state === 'unscheduled') return unscheduledLabel
  return formatRelativeReviewTime(value)
}

export function isSleepReviewSegment(
  segment: Pick<PalaceSegmentSummary, 'current_review_type' | 'review_stage_completed' | 'stage_labels'>,
): boolean {
  if (segment.current_review_type === 'sleep') return true
  return segment.stage_labels?.[segment.review_stage_completed] === '睡前'
}

export function formatCreatedAt(value: string | null): string {
  if (!value) return '未知'
  const date = parseApiDateTime(value)
  if (Number.isNaN(date.getTime())) return '未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replace(/\//g, '-')
}

export function getSegmentDisplayName(segment: PalaceSegmentSummary, index: number): string {
  if (segment.display_name) return segment.display_name
  if (segment.is_virtual_default) return '第 1 部分'
  if (/^第\s*1\s*部分$/.test(segment.name)) {
    return `第 ${index + 1} 部分`
  }
  return segment.name
}

export function palaceUsesMiniOnlyReview(
  palace: {
    mini_review_mode?: MiniReviewMode
    mini_palaces?: Array<unknown>
  },
): boolean {
  return palace.mini_review_mode === 'mini_only' && (palace.mini_palaces?.length ?? 0) > 0
}
