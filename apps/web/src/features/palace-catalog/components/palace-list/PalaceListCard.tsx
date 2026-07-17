import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BookOpen, ChevronDown, ChevronRight, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PalaceMemoryProgress } from '@/features/palace-catalog/components/palace-list/PalaceMemoryProgress'
import type { PalaceListViewSettings } from '@/entities/preferences/model/palaceViewSettings'
import { formatDuration } from '@/entities/session/model'
import type { PalaceGroupedItem, PalaceSegmentSummary } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'
import {
  formatCreatedAt,
  getPalaceCardClass,
  getPalaceCardContentClass,
  getPalaceIconClass,
  getReviewActionButtonClass,
  getReviewActionLabel,
  getReviewButtonState,
  getSegmentCardClass,
  getSegmentDisplayName,
  getSegmentListClass,
} from '@/features/palace-catalog/components/palace-list/utils'

interface PalaceListCardProps {
  palace: PalaceGroupedItem
  viewSettings: PalaceListViewSettings
  searchQuery?: string
  defaultExpanded?: boolean
  onPalacePractice: (palace: PalaceGroupedItem) => void
  onWarmPalacePractice?: (palace: PalaceGroupedItem) => void
  onSegmentPractice: (segment: PalaceSegmentSummary) => void
  onWarmSegmentPractice?: (segment: PalaceSegmentSummary) => void
  onDelete: (id: number, title: string) => void
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function renderHighlightedText(text: string, query?: string): ReactNode {
  const trimmedQuery = query?.trim()
  if (!trimmedQuery) return text

  const normalizedQuery = trimmedQuery.toLocaleLowerCase()
  const matcher = new RegExp(`(${escapeRegExp(trimmedQuery)})`, 'gi')
  return text.split(matcher).map((part, index) => {
    if (!part) return null
    if (part.toLocaleLowerCase() !== normalizedQuery) return part

    return (
      <mark
        key={`${part}-${index}`}
        className="rounded-sm bg-warning/20 px-0.5 text-inherit"
      >
        {part}
      </mark>
    )
  })
}

function normalizeReviewProgress(progress?: number | null): number | null {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return null
  return Math.max(0, Math.min(progress, 1))
}

function ReviewProgressPill({ progress }: { progress: number }) {
  const progressPercent = Math.round(progress * 100)

  return (
    <div
      className="inline-flex max-w-full items-center gap-2 rounded-md border border-info/25 bg-info/10 px-2 py-1 text-[11px] font-medium text-info"
      role="progressbar"
      aria-label={`复习进度 ${progressPercent}%`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progressPercent}
    >
      <span className="shrink-0 whitespace-nowrap">复习进度</span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-info/20">
        <span
          className="block h-full rounded-full bg-info transition-[width] duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </span>
      <span className="w-8 shrink-0 text-right tabular-nums">{progressPercent}%</span>
    </div>
  )
}

function ReviewActionButton({
  label,
  className,
  disabled,
  progress,
  onClick,
  onWarm,
}: {
  label: string
  className: string
  disabled: boolean
  progress?: number | null
  onClick: () => void
  onWarm?: () => void
}) {
  const normalizedProgress = normalizeReviewProgress(progress)
  const showProgressFill =
    !disabled &&
    normalizedProgress !== null &&
    normalizedProgress > 0 &&
    normalizedProgress < 1

  return (
    <button
      type="button"
      className={cn('relative isolate min-h-11 overflow-hidden sm:min-h-8', className)}
      disabled={disabled}
      onClick={onClick}
      onFocus={onWarm}
      onMouseEnter={onWarm}
    >
      {showProgressFill ? (
        <span
          aria-hidden="true"
          data-testid="review-action-progress-fill"
          className="pointer-events-none absolute inset-y-0 left-0 rounded-[inherit] bg-white/25 shadow-[inset_-1px_0_0_rgb(255_255_255_/_0.18)] transition-[width] duration-300"
          style={{ width: `${normalizedProgress * 100}%` }}
        />
      ) : null}
      <span className="relative z-10">{label}</span>
      {showProgressFill ? (
        <span className="sr-only">
          ，已完成 {Math.round(normalizedProgress * 100)}%
        </span>
      ) : null}
    </button>
  )
}

export function PalaceListCard({
  palace,
  viewSettings,
  searchQuery,
  defaultExpanded = false,
  onPalacePractice,
  onWarmPalacePractice = () => {},
  onSegmentPractice,
  onWarmSegmentPractice = () => {},
  onDelete,
}: PalaceListCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const segmentCount = Array.isArray(palace.segments) ? palace.segments.length : 0
  const isMultiSegment = segmentCount > 1
  const hasSingleSegment = segmentCount === 1
  const singleSegment = hasSingleSegment ? palace.segments[0] : null
  const hasFsrsProjection = typeof palace.memory_node_count === 'number' || 'memory_next_review_at' in palace
  const memoryNextReviewAt = hasFsrsProjection ? palace.memory_next_review_at ?? null : singleSegment?.next_review_at ?? null
  const singleSegmentReviewState = getReviewButtonState(memoryNextReviewAt)
  const showSingleSegmentReviewButton = Boolean(
    singleSegment &&
      !singleSegment.is_empty &&
      (hasFsrsProjection
        ? (palace.memory_node_count ?? singleSegment.node_count) > 0 && Boolean(memoryNextReviewAt)
        : (singleSegment.has_due_review ||
            (singleSegmentReviewState !== 'due_now' &&
              singleSegment.current_review_schedule_id &&
              singleSegment.next_review_at))),
  )
  const showExpandButton = isMultiSegment
  const shouldShowSegmentListWhenExpanded = isMultiSegment
  const showPalacePracticeButton = !showSingleSegmentReviewButton
  const primaryEstimatedSeconds = singleSegment?.estimated_review_seconds ?? 0
  const palaceTitle = palace.resolved_title || palace.title || '未命名宫殿'
  const singleSegmentActiveProgress = normalizeReviewProgress(singleSegment?.active_review_progress)
  const showSingleSegmentActiveProgress =
    showSingleSegmentReviewButton &&
    singleSegmentActiveProgress !== null &&
    singleSegmentActiveProgress > 0 &&
    singleSegmentActiveProgress < 1

  useEffect(() => {
    if (!menuOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [menuOpen])

  return (
    <Card className={getPalaceCardClass(viewSettings.densityMode)}>
      <CardContent className={cn('flex items-start', getPalaceCardContentClass(viewSettings.densityMode))}>
        <div
          className={cn(
            'flex shrink-0 items-center justify-center bg-secondary',
            getPalaceIconClass(viewSettings.densityMode),
          )}
        >
          <BookOpen className="size-5 text-muted-foreground" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex min-w-0 items-center gap-2">
                <Link
                  to={`/palaces/${palace.id}/edit`}
                  className="min-w-0 truncate font-semibold transition-colors hover:text-primary"
                >
                  {renderHighlightedText(palaceTitle, searchQuery)}
                </Link>
                {showPalacePracticeButton ? (
                  <>
                    <ReviewActionButton
                      label="练习"
                      className={cn(
                        'h-8 min-w-[84px] max-w-[112px] shrink-0 px-2.5 text-[11px] sm:px-3 sm:text-xs',
                        getReviewActionButtonClass({ state: 'practice' }),
                      )}
                      disabled={false}
                      onWarm={() => onWarmPalacePractice(palace)}
                      onClick={() => onPalacePractice(palace)}
                    />
                  </>
                ) : null}
                {singleSegment && showSingleSegmentReviewButton ? (
                  <ReviewActionButton
                    label={getReviewActionLabel(memoryNextReviewAt, {
                      state: singleSegmentReviewState,
                      entryLabel: palace.review_entry_label,
                      entryMode: palace.review_entry_mode,
                    })}
                    className={cn(
                      'h-8 min-w-[84px] max-w-[156px] shrink-0 px-2.5 text-[11px] sm:px-3 sm:text-xs',
                      getReviewActionButtonClass({
                        state: singleSegmentReviewState,
                      }),
                    )}
                    disabled={singleSegmentReviewState === 'unscheduled'}
                    progress={singleSegment.active_review_progress}
                    onWarm={() => onWarmSegmentPractice(singleSegment)}
                    onClick={() => onSegmentPractice(singleSegment)}
                  />
                ) : null}
              </div>
              {showSingleSegmentActiveProgress ? (
                <ReviewProgressPill progress={singleSegmentActiveProgress} />
              ) : null}
            </div>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{formatCreatedAt(palace.created_at)}</span>
            {hasSingleSegment ? (
              <>
                <span>{singleSegment.node_count} 个知识点</span>
                <span>预计 {formatDuration(primaryEstimatedSeconds)}</span>
              </>
            ) : (
              <span>{palace.chapters?.length || 0} 章节</span>
            )}
            {showExpandButton ? (
              <button
                type="button"
                className="inline-flex items-center gap-0.5 transition-colors hover:text-foreground"
                onClick={() => setExpanded((prev) => !prev)}
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                {expanded ? '收起详情' : '展开详情'}
              </button>
            ) : null}
          </div>

          <PalaceMemoryProgress palace={palace} />

          {expanded && shouldShowSegmentListWhenExpanded ? (
            <div className={getSegmentListClass(viewSettings.densityMode)}>
              {palace.segments.map((segment, index) => {
                return (
                  <div
                    key={segment.id}
                    className={cn(
                      'border border-border/60 bg-background/70',
                      getSegmentCardClass(viewSettings.densityMode),
                    )}
                  >
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block size-2.5 rounded-full"
                            style={{ backgroundColor: segment.color }}
                          />
                          <span className="truncate text-sm font-medium">
                            {getSegmentDisplayName(segment, index)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                          <span>{segment.node_count} 个知识点</span>
                          <span>预计 {formatDuration(segment.estimated_review_seconds || 0)}</span>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:min-w-[132px]">
                        {isMultiSegment ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="min-h-11 w-full text-xs sm:h-8 sm:min-h-8"
                            onFocus={() => onWarmSegmentPractice(segment)}
                            onMouseEnter={() => onWarmSegmentPractice(segment)}
                            onClick={() => onSegmentPractice(segment)}
                          >
                            练习
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}

          {expanded && palace.description ? (
            <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">
              {renderHighlightedText(palace.description.slice(0, 150), searchQuery)}
            </p>
          ) : null}

        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Link to={`/palaces/${palace.id}/quiz`}>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 sm:h-8 sm:min-h-8"
            >
              做题
            </Button>
          </Link>
          <Link to={`/palaces/${palace.id}/edit`}>
            <Button
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11 sm:size-8 sm:min-h-8 sm:min-w-8"
              aria-label={`编辑宫殿 ${palace.resolved_title || palace.title}`}
            >
              <Pencil className="size-4" />
            </Button>
          </Link>
          <div className="relative" ref={menuRef}>
            <Button
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11 sm:size-8 sm:min-h-8 sm:min-w-8"
              aria-label={`更多操作 ${palace.resolved_title || palace.title}`}
              onClick={() => setMenuOpen((current) => !current)}
            >
              <MoreHorizontal className="size-4" />
            </Button>
            {menuOpen ? (
              <div className="absolute right-0 top-9 z-20 min-w-[132px] rounded-xl border border-border/70 bg-background p-1 shadow-lg">
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
                  onClick={() => {
                    setMenuOpen(false)
                    onDelete(palace.id, palace.title)
                  }}
                >
                  <Trash2 className="size-4" />
                  删除
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
