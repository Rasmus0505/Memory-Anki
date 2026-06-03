import { BookOpen, Pencil, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PalaceStageProgress } from '@/app/router/palace-list/PalaceStageProgress'
import type { PalaceListViewSettings } from '@/app/router/palace-view-settings'
import { formatDuration } from '@/entities/session/model'
import type {
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
  getReviewButtonState,
  getSegmentCardClass,
  getSegmentDisplayName,
  getSegmentListClass,
} from '@/app/router/palace-list/utils'

interface PalaceListCardProps {
  palace: PalaceGroupedItem
  viewSettings: PalaceListViewSettings
  segmentReviewLoadingId: number | null
  markReviewedKey: string | null
  onOpenBatchReview: (palace: PalaceGroupedItem) => void
  onSegmentReviewAction: (segment: PalaceSegmentSummary) => void
  onOpenStageEdit: (
    palace: PalaceGroupedItem,
    segment: PalaceSegmentSummary,
    stage: ReviewStageSummary,
  ) => void
  onMarkSegmentReviewed: (segment: PalaceSegmentSummary) => void
  onDelete: (id: number, title: string) => void
}

export function PalaceListCard({
  palace,
  viewSettings,
  segmentReviewLoadingId,
  markReviewedKey,
  onOpenBatchReview,
  onSegmentReviewAction,
  onOpenStageEdit,
  onMarkSegmentReviewed,
  onDelete,
}: PalaceListCardProps) {
  const segmentCount = Array.isArray(palace.segments) ? palace.segments.length : 0
  const isMultiSegment = segmentCount > 1
  const hasSingleSegment = segmentCount === 1
  const singleSegment = hasSingleSegment ? palace.segments[0] : null
  const dueBatchSegments = (palace.segments || []).filter(
    (segment) =>
      !segment.is_virtual_default &&
      segment.has_due_review &&
      Boolean(segment.current_review_schedule_id),
  )
  const canBatchReview = dueBatchSegments.length >= 2
  const singleSegmentState = singleSegment ? getReviewButtonState(singleSegment.next_review_at) : 'unscheduled'

  return (
    <Card key={palace.id} className={getPalaceCardClass(viewSettings.densityMode)}>
      <CardContent className={cn('flex items-start', getPalaceCardContentClass(viewSettings.densityMode))}>
        <div className={cn('flex shrink-0 items-center justify-center bg-secondary', getPalaceIconClass(viewSettings.densityMode))}>
          <BookOpen className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
              <Link to={`/palaces/${palace.id}/edit`} className="font-semibold transition-colors hover:text-primary">
                {palace.resolved_title || palace.title || '未命名宫殿'}
              </Link>
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
            {!isMultiSegment && singleSegment ? (
              <Button
                variant={singleSegmentState === 'due_now' ? 'default' : 'outline'}
                size="sm"
                className={cn(
                  'h-8 shrink-0 text-xs',
                  singleSegmentState === 'due_now' && 'bg-emerald-600 text-white hover:bg-emerald-700',
                  singleSegmentState === 'due_later_today' &&
                    'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200',
                )}
                onClick={() => onSegmentReviewAction(singleSegment)}
                disabled={
                  !singleSegment.current_review_schedule_id ||
                  singleSegmentState === 'future' ||
                  segmentReviewLoadingId === singleSegment.id
                }
              >
                {segmentReviewLoadingId === singleSegment.id
                  ? '加载中...'
                  : singleSegmentState === 'due_now'
                    ? '开始复习'
                    : formatRelativeReviewTime(singleSegment.next_review_at)}
              </Button>
            ) : null}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{formatCreatedAt(palace.created_at)}</span>
            {!isMultiSegment && singleSegment ? (
              <span>预计 {formatDuration(singleSegment.estimated_review_seconds || 0)}</span>
            ) : (
              <span>{palace.chapters?.length || 0} 章节</span>
            )}
          </div>
          {!isMultiSegment && singleSegment ? (
            <div className="mt-2">
              <PalaceStageProgress
                stageLabels={singleSegment.stage_labels}
                completed={singleSegment.review_stage_completed}
                stages={singleSegment.review_stages}
                onStageClick={(stage) => onOpenStageEdit(palace, singleSegment, stage)}
              />
            </div>
          ) : Array.isArray(palace.segments) && palace.segments.length > 0 ? (
            <div className={getSegmentListClass(viewSettings.densityMode)}>
              {palace.segments.map((segment, index) => {
                const segmentReviewState = getReviewButtonState(segment.next_review_at)
                const segmentReviewDisabled =
                  !segment.current_review_schedule_id ||
                  segmentReviewState === 'future' ||
                  segmentReviewLoadingId === segment.id

                return (
                  <div
                    key={segment.id}
                    className={cn('border border-border/60 bg-background/70', getSegmentCardClass(viewSettings.densityMode))}
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
                          <Button
                            variant={segmentReviewState === 'due_now' ? 'default' : 'outline'}
                            size="sm"
                            className={cn(
                              'h-8 text-xs',
                              segmentReviewState === 'due_now' && 'bg-emerald-600 text-white hover:bg-emerald-700',
                              segmentReviewState === 'due_later_today' &&
                                'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200',
                            )}
                            onClick={() => onSegmentReviewAction(segment)}
                            disabled={segmentReviewDisabled}
                          >
                            {segmentReviewLoadingId === segment.id
                              ? '加载中...'
                              : segmentReviewState === 'due_now'
                                ? '开始复习'
                                : formatRelativeReviewTime(segment.next_review_at)}
                          </Button>
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
          ) : (
            <PalaceStageProgress
              stageLabels={palace.stage_labels}
              completed={palace.review_stage_completed}
              stages={palace.review_stages}
            />
          )}
          {palace.description ? (
            <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">{palace.description.slice(0, 150)}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {palace.mastered ? (
            <Badge variant="secondary" className="text-[10px]">
              已掌握
            </Badge>
          ) : null}
          <Link to={`/palaces/${palace.id}/practice`}>
            <Button
              variant={palace.needs_practice ? 'default' : 'ghost'}
              size="sm"
              className={cn('h-8', palace.needs_practice && 'bg-emerald-600 text-white hover:bg-emerald-700')}
            >
              练习
            </Button>
          </Link>
          <Link to={`/palaces/${palace.id}/edit`}>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Pencil className="h-4 w-4" />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => onDelete(palace.id, palace.title)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
