import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BookOpen, ChevronDown, ChevronRight, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { PalaceListViewSettings } from '@/modules/settings/public'
import type { PalaceGroupedItem } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'
import {
  formatCreatedAt,
  getPalaceCardClass,
  getPalaceCardContentClass,
  getPalaceIconClass,
} from '@/modules/content/ui/palace-catalog/components/palace-list/utils'

interface PalaceListCardProps {
  palace: PalaceGroupedItem
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

export function PalaceListCard({
  palace,
  viewSettings,
  searchQuery,
  defaultExpanded = false,
  onPalaceReview,
  onDelete,
}: PalaceListCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
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
                {hasReviewStatus ? <ReviewActionButton
                  label={
                    unitReviewStatus === 'marking_required'
                      ? '开始标记'
                      : unitReviewStatus === 'due'
                        ? '立即复习'
                        : formatReviewDate(palace.next_review_date)
                  }
                  className={cn(
                    'h-8 min-w-[84px] max-w-[156px] shrink-0 px-2.5 text-[11px] sm:px-3 sm:text-xs',
                    unitReviewStatus === 'marking_required'
                      ? 'border-violet-500/60 bg-violet-500/15 text-violet-700 hover:bg-violet-500/25 dark:text-violet-300'
                      : unitReviewStatus === 'due'
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'border border-border bg-muted text-muted-foreground',
                  )}
                  disabled={unitReviewStatus === 'scheduled'}
                  onClick={() => onPalaceReview(palace)}
                /> : null}
              </div>
            </div>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{formatCreatedAt(palace.created_at)}</span>
            <span>{palace.review_unit_count} 个复习单元</span>
            {palace.review_unit_count > 0 ? (
              <span>{palace.due_review_unit_count} 个到期</span>
            ) : null}
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
