import { useEffect, useRef, useState } from 'react'
import { BookOpen, Building2, ChevronDown, ChevronRight, MoreHorizontal, Pencil, Settings2, Target, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PalaceStageProgress } from '@/app/router/palace-list/PalaceStageProgress'
import type { PalaceListViewSettings } from '@/app/router/palace-view-settings'
import { formatDuration } from '@/entities/session/model'
import type {
  MiniPalaceSummary,
  PalaceGroupedItem,
  PalaceSegmentSummary,
  ReviewStageSummary,
} from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'
import {
  formatCreatedAt,
  formatRelativeReviewTime,
  getPalaceCardClass,
  getPalaceCardContentClass,
  getPalaceIconClass,
  getReviewActionButtonClass,
  getReviewActionLabel,
  getSegmentCardClass,
  getSegmentDisplayName,
  getSegmentListClass,
  isSleepReviewSegment,
  palaceUsesMiniOnlyReview,
  resolveReviewButtonState,
} from '@/app/router/palace-list/utils'

interface PalaceListCardProps {
  palace: PalaceGroupedItem
  viewSettings: PalaceListViewSettings
  segmentReviewLoadingId: number | null
  markReviewedKey: string | null
  defaultExpanded?: boolean
  onOpenBatchReview: (palace: PalaceGroupedItem) => void
  onSegmentReviewAction: (segment: PalaceSegmentSummary) => void
  onOpenStageEdit: (
    palace: PalaceGroupedItem,
    segment: PalaceSegmentSummary,
    stage: ReviewStageSummary,
  ) => void
  onMarkSegmentReviewed: (segment: PalaceSegmentSummary) => void
  onMiniPalacePractice: (miniPalace: MiniPalaceSummary) => void
  onMiniPalaceReview: (miniPalace: MiniPalaceSummary) => void
  onOpenConfig: (palace: PalaceGroupedItem) => void
  onDelete: (id: number, title: string) => void
}

function ReviewActionButton({
  label,
  className,
  disabled,
  progress,
  onClick,
}: {
  label: string
  className: string
  disabled: boolean
  progress?: number | null
  onClick: () => void
}) {
  const normalizedProgress =
    typeof progress === 'number' && Number.isFinite(progress)
      ? Math.max(0, Math.min(progress, 1))
      : null
  const showProgressFill =
    !disabled &&
    label === '开始复习' &&
    normalizedProgress !== null &&
    normalizedProgress > 0 &&
    normalizedProgress < 1

  return (
    <button
      type="button"
      className={cn('relative isolate overflow-hidden', className)}
      disabled={disabled}
      onClick={onClick}
    >
      {showProgressFill ? (
        <span
          aria-hidden="true"
          data-testid="review-action-progress-fill"
          className="pointer-events-none absolute inset-y-0 left-0 rounded-[inherit] bg-white/20 transition-[width] duration-300"
          style={{ width: `${normalizedProgress * 100}%` }}
        />
      ) : null}
      <span className="relative z-10">{label}</span>
    </button>
  )
}

export function PalaceListCard({
  palace,
  viewSettings,
  segmentReviewLoadingId,
  markReviewedKey,
  defaultExpanded = false,
  onOpenBatchReview,
  onSegmentReviewAction,
  onOpenStageEdit,
  onMarkSegmentReviewed,
  onMiniPalacePractice,
  onMiniPalaceReview,
  onOpenConfig,
  onDelete,
}: PalaceListCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const segmentCount = Array.isArray(palace.segments) ? palace.segments.length : 0
  const isMultiSegment = segmentCount > 1
  const hasSingleSegment = segmentCount === 1
  const singleSegment = hasSingleSegment ? palace.segments[0] : null
  const mainReviewOwnedByMini = palaceUsesMiniOnlyReview(palace)
  const showSingleSegmentReviewPresentation = !mainReviewOwnedByMini && !isMultiSegment && Boolean(singleSegment)
  const showMainSegmentList =
    !mainReviewOwnedByMini &&
    Array.isArray(palace.segments) &&
    palace.segments.length > 0 &&
    !showSingleSegmentReviewPresentation
  const dueBatchSegments = (palace.segments || []).filter(
    (segment) =>
      !segment.is_virtual_default &&
      segment.has_due_review &&
      Boolean(segment.current_review_schedule_id),
  )
  const canBatchReview = !mainReviewOwnedByMini && dueBatchSegments.length >= 2
  const singleSegmentState = singleSegment
    ? resolveReviewButtonState(singleSegment.has_due_review, singleSegment.next_review_at)
    : 'unscheduled'
  const isSingleSegmentSleepReview = singleSegment ? isSleepReviewSegment(singleSegment) : false

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
          <BookOpen className="h-5 w-5 text-muted-foreground" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex min-w-0 items-center gap-2">
                <Link
                  to={`/palaces/${palace.id}/edit`}
                  className="min-w-0 truncate font-semibold transition-colors hover:text-primary"
                >
                  {palace.resolved_title || palace.title || '未命名宫殿'}
                </Link>
                {showSingleSegmentReviewPresentation && singleSegment ? (
                  <ReviewActionButton
                    label={getReviewActionLabel(singleSegment.next_review_at, {
                      state: singleSegmentState,
                      loading: segmentReviewLoadingId === singleSegment.id,
                      isSleepReview: isSingleSegmentSleepReview,
                    })}
                    className={cn(
                      'h-8 min-w-[104px] max-w-[132px] shrink-0 px-2.5 text-[11px] sm:min-w-[112px] sm:px-3 sm:text-xs',
                      getReviewActionButtonClass({
                        state: singleSegmentState,
                        isSleepReview: isSingleSegmentSleepReview,
                        disabled:
                          !singleSegment.current_review_schedule_id ||
                          singleSegmentState === 'future',
                      }),
                    )}
                    disabled={
                      !singleSegment.current_review_schedule_id ||
                      singleSegmentState === 'future' ||
                      segmentReviewLoadingId === singleSegment.id
                    }
                    progress={singleSegment.active_review_progress}
                    onClick={() => onSegmentReviewAction(singleSegment)}
                  />
                ) : null}
              </div>
              {canBatchReview ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 text-xs"
                  onClick={() => onOpenBatchReview(palace)}
                >
                  开始多块复习
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{formatCreatedAt(palace.created_at)}</span>
            {showSingleSegmentReviewPresentation && singleSegment ? (
              <span>预计 {formatDuration(singleSegment.estimated_review_seconds || 0)}</span>
            ) : (
              <span>{palace.chapters?.length || 0} 章节</span>
            )}
            {(palace.focus_count ?? 0) > 0 ? (
              <span className="inline-flex items-center gap-1 text-warning">
                <Target className="h-3.5 w-3.5" />
                专项 {(palace.focus_count ?? 0)} 张
              </span>
            ) : null}
            {(showMainSegmentList || (Array.isArray(palace.mini_palaces) && palace.mini_palaces.length > 0)) ? (
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

          {showSingleSegmentReviewPresentation && singleSegment ? (
            <div className="mt-2">
              <PalaceStageProgress
                stageLabels={singleSegment.stage_labels}
                completed={singleSegment.review_stage_completed}
                stages={singleSegment.review_stages}
                onStageClick={(stage) => onOpenStageEdit(palace, singleSegment, stage)}
              />
            </div>
          ) : expanded && showMainSegmentList ? (
            <div className={getSegmentListClass(viewSettings.densityMode)}>
              {palace.segments.map((segment, index) => {
                const segmentReviewState = resolveReviewButtonState(
                  segment.has_due_review,
                  segment.next_review_at,
                )
                const isSegmentSleepReview = isSleepReviewSegment(segment)
                const segmentReviewDisabled =
                  !segment.current_review_schedule_id ||
                  segmentReviewState === 'future' ||
                  segmentReviewLoadingId === segment.id

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
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: segment.color }}
                          />
                          <span className="truncate text-sm font-medium">
                            {getSegmentDisplayName(segment, index)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                          <span>{segment.node_count} 节点</span>
                          <span>预计 {formatRelativeReviewTime(segment.next_review_at)}</span>
                        </div>
                        <PalaceStageProgress
                          stageLabels={segment.stage_labels}
                          completed={segment.review_stage_completed}
                          stages={segment.review_stages}
                          onStageClick={(stage) => onOpenStageEdit(palace, segment, stage)}
                        />
                      </div>

                      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:min-w-[132px]">
                        {isMultiSegment ? (
                          <ReviewActionButton
                            label={getReviewActionLabel(segment.next_review_at, {
                              state: segmentReviewState,
                              loading: segmentReviewLoadingId === segment.id,
                              isSleepReview: isSegmentSleepReview,
                            })}
                            className={getReviewActionButtonClass({
                              state: segmentReviewState,
                              isSleepReview: isSegmentSleepReview,
                              disabled: segmentReviewDisabled,
                            })}
                            disabled={segmentReviewDisabled}
                            progress={segment.active_review_progress}
                            onClick={() => onSegmentReviewAction(segment)}
                          />
                        ) : null}

                        {!segment.is_virtual_default ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-full text-xs"
                            disabled={
                              !segment.has_due_review ||
                              !segment.current_review_schedule_id ||
                              markReviewedKey === `segment-${segment.id}`
                            }
                            onClick={() => onMarkSegmentReviewed(segment)}
                          >
                            {markReviewedKey === `segment-${segment.id}` ? '提交中...' : '标记已复习'}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : expanded && !mainReviewOwnedByMini ? (
            <PalaceStageProgress
              stageLabels={palace.stage_labels}
              completed={palace.review_stage_completed}
              stages={palace.review_stages}
            />
          ) : null}

          {expanded && palace.description ? (
            <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">{palace.description.slice(0, 150)}</p>
          ) : null}

          {expanded && Array.isArray(palace.mini_palaces) && palace.mini_palaces.length > 0 ? (
            <div className="mt-3 border-t border-border/50 pt-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                小宫殿
                {mainReviewOwnedByMini ? (
                  <Badge className="bg-info text-[10px] text-white hover:bg-info">
                    接管正式复习
                  </Badge>
                ) : null}
              </div>

              <div className={getSegmentListClass(viewSettings.densityMode)}>
                {palace.mini_palaces.map((mini) => {
                  const miniState = resolveReviewButtonState(
                    mini.has_due_review,
                    mini.next_review_at,
                  )
                  const isSleepMini = mini.current_review_type === 'sleep'
                  const miniReviewDisabled =
                    !mini.current_review_schedule_id ||
                    miniState === 'future' ||
                    mini.is_empty

                  return (
                    <div
                      key={mini.id}
                      className={cn(
                        'border border-border/60 bg-background/70',
                        getSegmentCardClass(viewSettings.densityMode),
                      )}
                    >
                      <div className="flex flex-wrap items-start gap-3">
                        <div
                          className={cn(
                            'flex shrink-0 items-center justify-center bg-secondary',
                            getPalaceIconClass(viewSettings.densityMode),
                          )}
                        >
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{mini.name}</span>
                            {mini.is_empty ? (
                              <Badge variant="destructive" className="text-[10px]">
                                空
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">
                                {mini.node_count} 张
                              </Badge>
                            )}
                            {mini.needs_practice ? (
                              <Badge className="bg-success text-[10px] text-white hover:bg-success">
                                需练习
                              </Badge>
                            ) : null}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                            <span>预计 {formatDuration(mini.estimated_review_seconds || 0)}</span>
                            <span>
                              {mini.next_review_at
                                ? formatRelativeReviewTime(mini.next_review_at)
                                : mini.updated_at
                                ? `更新 ${formatCreatedAt(mini.updated_at)}`
                                : '未排入复习'}
                            </span>
                          </div>
                          {mini.stage_labels?.length > 0 && !mini.is_empty ? (
                            <PalaceStageProgress
                              stageLabels={mini.stage_labels}
                              completed={mini.review_stage_completed}
                              stages={mini.review_stages}
                            />
                          ) : null}
                        </div>

                        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:min-w-[132px]">
                          <Button
                            size="sm"
                            variant={mini.needs_practice ? 'default' : 'ghost'}
                            className={cn(
                              'h-8 w-full text-xs',
                              mini.needs_practice && 'bg-success text-white hover:bg-success/80',
                            )}
                            onClick={() => onMiniPalacePractice(mini)}
                            disabled={mini.is_empty}
                          >
                            做题
                          </Button>

                          <ReviewActionButton
                            label={getReviewActionLabel(mini.next_review_at, {
                              state: miniState,
                              isSleepReview: isSleepMini,
                            })}
                            className={getReviewActionButtonClass({
                              state: miniState,
                              isSleepReview: isSleepMini,
                              disabled: miniReviewDisabled,
                            })}
                            disabled={miniReviewDisabled}
                            progress={mini.active_review_progress}
                            onClick={() => onMiniPalaceReview(mini)}
                          />

                          <Link
                            to={`/palaces/${mini.palace_id}/edit?miniPalaceId=${mini.id}&miniPalaceMode=edit`}
                            className="self-end"
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={`编辑 ${mini.name}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {palace.mastered ? (
            <Badge variant="secondary" className="text-[10px]">
              已掌握
            </Badge>
          ) : null}
          <Link to={`/palaces/${palace.id}/quiz`}>
            <Button
              variant={palace.needs_practice ? 'default' : 'ghost'}
              size="sm"
	              className={cn('h-8', palace.needs_practice && 'bg-success text-white hover:bg-success/80')}
            >
              做题
            </Button>
          </Link>
          {(palace.focus_count ?? 0) > 0 ? (
            <Link to={`/palaces/${palace.id}/focus-practice`}>
              <Button
                variant="outline"
                size="sm"
	              className="h-8 border-warning/30 bg-warning/5 text-warning hover:bg-warning/10"
              >
                专项练习
              </Button>
            </Link>
          ) : null}
          <Link to={`/palaces/${palace.id}/edit`}>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`编辑宫殿 ${palace.resolved_title || palace.title}`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </Link>
          <div className="relative" ref={menuRef}>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`更多操作 ${palace.resolved_title || palace.title}`}
              onClick={() => setMenuOpen((current) => !current)}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
            {menuOpen ? (
              <div className="absolute right-0 top-9 z-20 min-w-[132px] rounded-xl border border-border/70 bg-background p-1 shadow-lg">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                  onClick={() => {
                    setMenuOpen(false)
                    onOpenConfig(palace)
                  }}
                >
                  <Settings2 className="h-4 w-4" />
                  配置
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
                  onClick={() => {
                    setMenuOpen(false)
                    onDelete(palace.id, palace.title)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
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
