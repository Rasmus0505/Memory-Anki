import { BookOpen, Building2, Pencil, Target, Trash2 } from 'lucide-react'
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
  getReviewButtonState,
  getSegmentCardClass,
  getSegmentDisplayName,
  getSegmentListClass,
  isSleepReviewSegment,
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
  onMiniPalacePractice: (miniPalace: MiniPalaceSummary) => void
  onMiniPalaceReview: (miniPalace: MiniPalaceSummary) => void
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
  onMiniPalacePractice,
  onMiniPalaceReview,
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
  const isSingleSegmentSleepReview = singleSegment ? isSleepReviewSegment(singleSegment) : false

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
              <button
                type="button"
                className={cn(
                  'h-8 shrink-0 w-[140px] rounded-md border text-xs font-medium transition-colors',
                  singleSegmentState === 'due_now' && 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100',
                  singleSegmentState === 'due_later_today' && 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100',
                  isSingleSegmentSleepReview && 'border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100',
                  (!singleSegment.current_review_schedule_id || singleSegmentState === 'future') && 'border-border bg-muted/30 text-muted-foreground',
                )}
                disabled={
                  !singleSegment.current_review_schedule_id ||
                  singleSegmentState === 'future' ||
                  segmentReviewLoadingId === singleSegment.id
                }
                onClick={() => onSegmentReviewAction(singleSegment)}
              >
                {segmentReviewLoadingId === singleSegment.id
                  ? '加载中...'
                  : isSingleSegmentSleepReview
                  ? '睡前复习'
                  : singleSegmentState === 'due_now'
                  ? '开始复习'
                  : singleSegmentState === 'unscheduled'
                  ? '未排入复习'
                  : formatRelativeReviewTime(singleSegment.next_review_at)}
              </button>
            ) : null}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{formatCreatedAt(palace.created_at)}</span>
            {!isMultiSegment && singleSegment ? (
              <span>预计 {formatDuration(singleSegment.estimated_review_seconds || 0)}</span>
            ) : (
              <span>{palace.chapters?.length || 0} 章节</span>
            )}
            {(palace.focus_count ?? 0) > 0 ? (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <Target className="h-3.5 w-3.5" />
                专项 {(palace.focus_count ?? 0)} 张
              </span>
            ) : null}
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
                const isSegmentSleepReview = isSleepReviewSegment(segment)
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
                          <button
                            type="button"
                            className={cn(
                              'h-8 w-full rounded-md border text-xs font-medium transition-colors',
                              segmentReviewState === 'due_now' && 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100',
                              segmentReviewState === 'due_later_today' && 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100',
                              isSegmentSleepReview && 'border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100',
                              segmentReviewDisabled && 'border-border bg-muted/30 text-muted-foreground',
                            )}
                            disabled={segmentReviewDisabled}
                            onClick={() => onSegmentReviewAction(segment)}
                          >
                            {segmentReviewLoadingId === segment.id
                              ? '加载中...'
                              : isSegmentSleepReview
                              ? '睡前复习'
                              : segmentReviewState === 'due_now'
                              ? '开始复习'
                              : segmentReviewState === 'unscheduled'
                              ? '未排入复习'
                              : formatRelativeReviewTime(segment.next_review_at)}
                          </button>
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

          {Array.isArray(palace.mini_palaces) && palace.mini_palaces.length > 0 ? (
            <div className="mt-3 border-t border-border/50 pt-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                小宫殿
              </div>
              <div className="space-y-2">
                {palace.mini_palaces.map((mini) => {
                  const miniState = mini.has_due_review
                    ? 'due_now'
                    : mini.next_review_at
                    ? getReviewButtonState(mini.next_review_at)
                    : 'unscheduled'
                  const isSleepMini = mini.current_review_type === 'sleep'

                  return (
                    <div
                      key={mini.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/60 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm font-medium">
                            {mini.name}
                          </span>
                          {mini.is_empty ? (
                            <Badge variant="destructive" className="text-[10px]">空</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">
                              {mini.node_count} 张
                            </Badge>
                          )}
                          {mini.needs_practice ? (
                            <Badge className="bg-emerald-600 text-white text-[10px] hover:bg-emerald-600">
                              需练习
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span>预计 {formatDuration(mini.estimated_review_seconds || 0)}</span>
                          {mini.next_review_at ? (
                            <span>{formatRelativeReviewTime(mini.next_review_at)}</span>
                          ) : (
                            <span>未排入复习</span>
                          )}
                        </div>
                        {mini.stage_labels?.length > 0 && !mini.is_empty ? (
                          <PalaceStageProgress
                            stageLabels={mini.stage_labels}
                            completed={mini.review_stage_completed}
                            stages={mini.review_stages}
                          />
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px]"
                          onClick={() => onMiniPalacePractice(mini)}
                          disabled={mini.is_empty}
                        >
                          练习
                        </Button>
                        <Button
                          size="sm"
                          variant={miniState === 'due_now' ? 'default' : 'outline'}
                          className={cn(
                            'h-7 text-[11px]',
                            miniState === 'due_now' && 'bg-emerald-600 text-white hover:bg-emerald-700',
                          )}
                          onClick={() => onMiniPalaceReview(mini)}
                          disabled={!mini.current_review_schedule_id || miniState === 'future' || mini.is_empty}
                        >
                          {miniState === 'due_now' ? '复习' : mini.next_review_at ? formatRelativeReviewTime(mini.next_review_at) : '未排'}
                        </Button>
                        <Link to={`/palaces/${mini.palace_id}/edit?miniPalaceId=${mini.id}&miniPalaceMode=edit`}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={`编辑 ${mini.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
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
          <Link to={`/palaces/${palace.id}/practice`}>
            <Button
              variant={palace.needs_practice ? 'default' : 'ghost'}
              size="sm"
              className={cn('h-8', palace.needs_practice && 'bg-emerald-600 text-white hover:bg-emerald-700')}
            >
              练习
            </Button>
          </Link>
          {(palace.focus_count ?? 0) > 0 ? (
            <Link to={`/palaces/${palace.id}/focus-practice`}>
              <Button
                variant="outline"
                size="sm"
                className="h-8 border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
              >
                专项练习
              </Button>
            </Link>
          ) : null}
          <Link to={`/palaces/${palace.id}/edit`}>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`编辑宫殿 ${palace.resolved_title || palace.title}`}>
              <Pencil className="h-4 w-4" />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            aria-label={`删除宫殿 ${palace.resolved_title || palace.title}`}
            onClick={() => onDelete(palace.id, palace.title)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
