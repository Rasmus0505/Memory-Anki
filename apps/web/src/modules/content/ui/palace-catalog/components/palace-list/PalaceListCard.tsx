import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CalendarClock, ChevronDown, ChevronRight, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { PalaceReviewUnitsPanel } from '@/modules/practice/public'
import type { PalaceListViewSettings } from '@/modules/settings/public'
import type { PalaceGroupedItem } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'
import { NodeCountBadgeCluster, withRatioBadge } from '@/shared/ui/mindmap-canvas/NodeCountBadge'
import { shareRatio } from '@/shared/ui/share-fill/shareFill'
import {
  formatCreatedAt,
  getPalaceCardClass,
  getPalaceCardContentClass,
} from '@/modules/content/ui/palace-catalog/components/palace-list/utils'
import { PalaceFavoriteButton } from '@/modules/content/ui/palace-favorite'

interface PalaceListCardProps {
  palace: PalaceGroupedItem
  /** Distinct questions in the chapter this card is grouped under; the palace bar's denominator. */
  chapterQuestionTotal?: number | null
  viewSettings: PalaceListViewSettings
  searchQuery?: string
  defaultExpanded?: boolean
  onPalaceReview: (palace: PalaceGroupedItem) => void
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

function ReviewActionButton({
  label,
  className,
  disabled,
  onClick,
}: {
  label: string
  className: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={cn('min-h-11 sm:min-h-8', className)}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function formatReviewDate(value?: string | null) {
  if (!value) return '日期复习'
  const [, month, day] = value.split('-').map(Number)
  return month && day ? `${month}月${day}日复习` : '日期复习'
}

function whyNotToday(palace: PalaceGroupedItem): string | null {
  if (palace.review_status === 'marking_required') {
    return '还没标记，不会出现在今天的复习里'
  }
  if (palace.review_status === 'scheduled') {
    const when = formatReviewDate(palace.next_review_date).replace(/复习$/, '')
    return when && when !== '日期'
      ? `还没到复习日（${when}），今天不会出现`
      : '还没到复习日，今天不会出现'
  }
  if (palace.review_status === 'due') {
    const count = palace.due_review_unit_count
    return count > 0
      ? `今天有 ${count} 个到期，会出现在今天的复习里`
      : '今天到期，会出现在今天的复习里'
  }
  return null
}

export function PalaceListCard({
  palace,
  chapterQuestionTotal = null,
  viewSettings,
  searchQuery,
  defaultExpanded = false,
  onPalaceReview,
  onDelete,
}: PalaceListCardProps) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [progressOpen, setProgressOpen] = useState(false)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const unitReviewStatus = palace.review_status
  const hasReviewStatus = (
    unitReviewStatus === 'marking_required'
    || unitReviewStatus === 'due'
    || unitReviewStatus === 'scheduled'
  )
  const showExpandButton = Boolean(palace.description)
  const palaceTitle = palace.resolved_title || palace.title || '未命名宫殿'

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

  const questionCount = palace.quiz_question_total ?? 0
  const chapterTotal = chapterQuestionTotal ?? 0
  const quizCountBadges = withRatioBadge(palace.quiz_count_badges ?? [], questionCount, chapterTotal)
  const share = shareRatio(questionCount, chapterTotal)
  const reason = whyNotToday(palace)

  return (
    <div className="pb-3 pr-3">
      <Card
        className={cn('group/palace relative overflow-visible', getPalaceCardClass(viewSettings.densityMode))}
      >
      {/* One row on desktop: title on the left, the review action and tools on the right.
          Phones wrap the actions under the title so it keeps the full width. */}
      <CardContent
        className={cn(
          'flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4',
          getPalaceCardContentClass(viewSettings.densityMode),
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link
              to={`/palaces/${palace.id}/edit`}
              className="min-w-0 truncate font-medium leading-snug transition-colors hover:text-primary"
              title={`${palaceTitle} · 创建于 ${formatCreatedAt(palace.created_at)}`}
            >
              {renderHighlightedText(palaceTitle, searchQuery)}
            </Link>
            <PalaceFavoriteButton palaceId={palace.id} className="-my-1 size-9 shrink-0 sm:size-7" iconClassName="size-4 sm:size-3.5" />
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {palace.review_unit_count} 个复习单元
              {palace.review_unit_count > 0 ? ` · ${palace.due_review_unit_count} 个到期` : ''}
            </span>
            {reason ? <span className="text-ink-faint">{reason}</span> : null}
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

          {expanded && palace.description ? (
            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
              {renderHighlightedText(palace.description.slice(0, 150), searchQuery)}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1">
          {hasReviewStatus ? <ReviewActionButton
            label={
              unitReviewStatus === 'marking_required'
                ? '开始标记'
                : unitReviewStatus === 'due'
                  ? '立即复习'
                  : formatReviewDate(palace.next_review_date)
            }
            className={cn(
              'mr-1 h-8 shrink-0 rounded-lg border px-3 text-xs font-medium transition-colors',
              unitReviewStatus === 'marking_required'
                ? 'border-violet-500/30 bg-violet-500/10 text-violet-700 hover:bg-violet-500/20 dark:text-violet-300'
                : unitReviewStatus === 'due'
                  ? 'border-transparent bg-primary text-primary-foreground shadow-soft hover:bg-primary/90'
                  : 'border-border bg-muted/60 tabular-nums text-muted-foreground',
            )}
            disabled={unitReviewStatus === 'scheduled'}
            onClick={() => onPalaceReview(palace)}
          /> : null}
          <Link to={`/palaces/${palace.id}/quiz`}>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 text-muted-foreground hover:text-foreground sm:h-8 sm:min-h-8"
            >
              做题
            </Button>
          </Link>
          <Link to={`/palaces/${palace.id}/edit`}>
            <Button
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11 text-muted-foreground hover:text-foreground sm:size-8 sm:min-h-8 sm:min-w-8"
              aria-label={`编辑宫殿 ${palace.resolved_title || palace.title}`}
            >
              <Pencil className="size-4" />
            </Button>
          </Link>
          <div className="relative" ref={menuRef}>
            <Button
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11 text-muted-foreground hover:text-foreground sm:size-8 sm:min-h-8 sm:min-w-8"
              aria-label={`更多操作 ${palace.resolved_title || palace.title}`}
              onClick={() => setMenuOpen((current) => !current)}
            >
              <MoreHorizontal className="size-4" />
            </Button>
            {menuOpen ? (
              <div className="absolute right-0 top-9 z-40 min-w-36 rounded-[10px] border bg-popover p-1 shadow-popover animate-in fade-in-0 zoom-in-95">
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent sm:min-h-8"
                  onClick={() => {
                    setMenuOpen(false)
                    setProgressOpen(true)
                  }}
                >
                  <CalendarClock className="size-4 text-muted-foreground" />
                  复习进度
                </button>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 sm:min-h-8"
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
      {/* Share of the chapter's questions: a hairline along the bottom edge. */}
      {share > 0 ? (
        <div className="pointer-events-none absolute inset-x-4 bottom-0 h-0.5 overflow-hidden rounded-full" aria-hidden>
          <div className="h-full rounded-full bg-muted-foreground/30" style={{ width: `${Math.round(share * 100)}%` }} />
        </div>
      ) : null}
      {progressOpen ? (
        <PalaceReviewUnitsPanel
          open
          palaceId={palace.id}
          onClose={() => setProgressOpen(false)}
        />
      ) : null}
      <NodeCountBadgeCluster
        countBadges={quizCountBadges}
        onBadgeClick={() => navigate(`/palaces/${palace.id}/quiz`)}
      />
      </Card>
    </div>
  )
}
