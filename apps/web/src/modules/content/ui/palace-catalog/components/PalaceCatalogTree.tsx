import { useMemo, useState, type ReactNode } from 'react'
import { CalendarClock, ListTree, MoreHorizontal, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { ExamStarPicker } from '@/modules/exam/public'
import { PalaceReviewUnitsPanel } from '@/modules/practice/public'
import type { ExamPalaceRow, PalaceGroupedItem, PalaceGroupedListResponse, PalaceSubjectShelfItem } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { Plus } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { menuItem } from '@/shared/ui/row-context-menu/compose'
import { PalaceDirectoryTreeView } from '@/modules/content/ui/palace-edit/components/PalaceDirectoryTree'
import { PalaceFavoriteButton } from '@/modules/content/ui/palace-favorite'
import { usePalaceMenuActions } from '@/modules/content/ui/palace-menu/usePalaceMenuActions'
import { allExpansionKeys, buildPalaceCatalogTree, chapterPalaceIds } from '../model/palaceCatalogTree'

function formatReviewDate(value?: string | null) {
  if (!value) return '日期复习'
  const [, month, day] = value.split('-').map(Number)
  return month && day ? `${month}月${day}日复习` : '日期复习'
}

/** Says why a palace is or is not in today's review; the chip's tooltip. */
function whyNotToday(palace: PalaceGroupedItem): string | null {
  if (palace.review_status === 'marking_required') return '还没标记，不会出现在今天的复习里'
  if (palace.review_status === 'scheduled') {
    const when = formatReviewDate(palace.next_review_date).replace(/复习$/, '')
    return when && when !== '日期' ? `还没到复习日（${when}），今天不会出现` : '还没到复习日，今天不会出现'
  }
  if (palace.review_status === 'due') {
    const count = palace.due_review_unit_count
    return count > 0 ? `今天有 ${count} 个到期，会出现在今天的复习里` : '今天到期，会出现在今天的复习里'
  }
  return null
}

/** Row actions stay quiet until the row is hovered on a mouse; touch screens always see them. */
const HOVER_REVEAL = 'transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100 data-[state=open]:opacity-100'

function DueCount({ count, tone = 'due' }: { count: number; tone?: 'due' | 'later' }) {
  if (count <= 0) return null
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
        tone === 'due' ? 'bg-danger-soft text-danger-strong' : 'bg-warning-soft text-warning-strong',
      )}
      title={tone === 'due' ? `${count} 个现在可以复习` : `${count} 个今天稍后可以复习`}
    >
      {count}
    </span>
  )
}

export interface PalaceCatalogTreeProps {
  grouped: PalaceGroupedListResponse | null | undefined
  /** Subject-level due counts from the shelf endpoint, keyed by subject id. */
  subjectSummaries?: ReadonlyMap<number, PalaceSubjectShelfItem>
  examStarsById?: ReadonlyMap<number, ExamPalaceRow>
  examStarRule?: string
  onExamStarsSaved?: () => void
  onPalaceReview: (palace: PalaceGroupedItem) => void
  onDelete: (id: number, title: string) => void
  /** A search or filter is on: open every fold so the results are visible. */
  expandAll?: boolean
  /** Inside one subject's page the subject row itself is redundant. */
  hideSubjectRows?: boolean
  defaultExpanded?: boolean
  collapseSignal?: number
  viewStateKey: string
  emptyState?: ReactNode
  /** Search term to mark inside chapter and palace names. */
  highlight?: string
}

/**
 * The knowledge shelf as one list: 学科 → 章节 → 宫殿, folding like a file
 * explorer. Each row carries only what you act on — due counts, the review
 * chip, 做题 — with the rest one hover away.
 */
export function PalaceCatalogTree({
  grouped,
  subjectSummaries,
  examStarsById,
  examStarRule,
  onExamStarsSaved,
  onPalaceReview,
  onDelete,
  expandAll = false,
  hideSubjectRows = false,
  defaultExpanded = false,
  collapseSignal,
  viewStateKey,
  emptyState,
  highlight,
}: PalaceCatalogTreeProps) {
  const navigate = useNavigate()
  const rowMenus = usePalaceMenuActions()
  const { tree, palacesById } = useMemo(() => buildPalaceCatalogTree(grouped), [grouped])
  const [progressPalaceId, setProgressPalaceId] = useState<number | null>(null)
  // Only the first tree decides the initial folds.
  const [defaultExpandedKeys] = useState(() => (defaultExpanded ? allExpansionKeys(tree) : undefined))

  const dueOf = (ids: number[]) => ids.reduce((sum, id) => sum + (palacesById.get(id)?.due_review_unit_count ?? 0), 0)

  return (
    <>
      <PalaceDirectoryTreeView
        tree={tree}
        currentPalaceId={null}
        size="page"
        showHeader={false}
        showSearch={false}
        expandAll={expandAll}
        hideSubjectRows={hideSubjectRows}
        defaultExpandedKeys={defaultExpandedKeys}
        collapseSignal={collapseSignal}
        viewStateKey={viewStateKey}
        emptyState={emptyState}
        highlight={highlight}
        onSelectPalace={(palaceId) => navigate(`/palaces/${palaceId}/edit`)}
        palaceMenu={(palace, { beginRename }) => rowMenus.palaceMenu(palace, {
          rename: { onSelect: beginRename },
          isFavorite: palacesById.get(palace.id)?.is_favorite,
          // Same in-place panel as the row's ••• menu; the default verb navigates.
          progress: { onSelect: () => setProgressPalaceId(palace.id) },
        })}
        chapterMenu={(chapter, { beginRename }) => rowMenus.chapterMenu(
          { id: chapter.id, name: chapter.name, subjectId: chapter.subjectId },
          { rename: { onSelect: beginRename } },
        )}
        subjectMenu={(subject, { beginRename }) => rowMenus.subjectMenu(
          { id: subject.id, name: subject.name },
          { rename: { onSelect: beginRename } },
        )}
        bucketMenu={(bucketKey) => {
          const match = /^subject:(\d+):ungrouped$/.exec(bucketKey)
          if (!match) return null
          const subjectId = Number(match[1])
          return [menuItem('在此学科新建宫殿', Plus, () => { void rowMenus.createPalaceIn(subjectId, null) })]
        }}
        onRenamePalace={rowMenus.renamePalaceTo}
        onRenameChapter={rowMenus.renameChapterTo}
        onRenameSubject={rowMenus.renameSubjectTo}
        renderBucketMeta={(bucketKey) => (bucketKey === 'root:ungrouped' && !hideSubjectRows ? (
          <Button asChild size="icon" variant="ghost" className={cn('size-7 text-muted-foreground', HOVER_REVEAL)}>
            <Link to="/palaces/list?uncategorized=true" aria-label="打开 未分类 书架" title="打开未分类的宫殿列表">
              <ListTree />
            </Link>
          </Button>
        ) : null)}
        renderSubjectMeta={(subject) => {
          const summary = subjectSummaries?.get(subject.id)
          return (
            <>
              <span className="ma-figure hidden text-[13px] tabular-nums text-muted-foreground sm:inline">
                {summary ? `${summary.palace_count} 座宫殿` : null}
              </span>
              <DueCount count={summary?.due_now_count ?? 0} />
              <DueCount count={summary?.due_later_today_count ?? 0} tone="later" />
              <Button
                asChild
                size="icon"
                variant="ghost"
                className={cn('size-7 text-muted-foreground', HOVER_REVEAL)}
              >
                <Link to={`/palaces/list?subjectId=${subject.id}`} aria-label={`打开 ${subject.name} 书架`} title="打开这本书：记忆阶梯与按间隔筛选">
                  <ListTree />
                </Link>
              </Button>
            </>
          )
        }}
        renderChapterMeta={(chapter) => {
          const ids = chapterPalaceIds(chapter)
          return (
            <>
              <span className="ma-figure hidden text-[13px] tabular-nums text-ink-faint sm:inline">{ids.length}</span>
              <DueCount count={dueOf(ids)} />
            </>
          )
        }}
        renderPalaceMeta={(node) => {
          const palace = palacesById.get(node.id)
          if (!palace) return null
          const exam = examStarsById?.get(palace.id)
          const status = palace.review_status
          const hasReviewStatus = status === 'marking_required' || status === 'due' || status === 'scheduled'
          const title = palace.resolved_title || palace.title
          const questions = palace.quiz_question_total ?? 0
          const questionHint = (palace.quiz_count_badges ?? []).map((badge) => badge.title).filter(Boolean).join('，')
          return (
            <>
              <PalaceFavoriteButton
                palaceId={palace.id}
                className={cn('size-7', !palace.is_favorite && HOVER_REVEAL)}
                iconClassName="size-3.5"
              />
              {exam ? (
                <div className="hidden sm:block" title={examStarRule}>
                  <ExamStarPicker
                    kind="palace"
                    entityId={palace.id}
                    stars={exam.stars}
                    source={exam.stars_source}
                    ownStars={exam.own_stars}
                    onSaved={() => onExamStarsSaved?.()}
                  />
                </div>
              ) : null}
              {palace.review_unit_count > 0 ? (
                <span className="hidden w-16 text-right text-xs tabular-nums text-ink-faint md:inline">
                  {palace.due_review_unit_count > 0 ? `${palace.due_review_unit_count}/` : ''}{palace.review_unit_count} 单元
                </span>
              ) : null}
              {hasReviewStatus ? <button
                type="button"
                title={whyNotToday(palace) ?? undefined}
                disabled={status === 'scheduled'}
                onClick={() => onPalaceReview(palace)}
                className={cn(
                  'ma-pressable inline-flex h-7 min-w-[4.5rem] shrink-0 items-center justify-center rounded-md border px-2.5 text-xs font-medium tabular-nums',
                  status === 'marking_required'
                    ?  'border-mark/25 bg-mark-soft text-mark hover:bg-mark/10'
                    : status === 'due'
                      ? 'border-transparent bg-primary text-primary-foreground shadow-soft hover:bg-primary/90'
                      : 'border-transparent bg-transparent text-ink-faint',
                )}
              >
                {status === 'marking_required' ? '开始标记' : status === 'due' ? '立即复习' : formatReviewDate(palace.next_review_date)}
              </button> : null}
              <Button
                asChild
                size="sm"
                variant="ghost"
                className={cn('h-7 px-2 text-xs text-muted-foreground', HOVER_REVEAL)}
              >
                <Link to={`/palaces/${palace.id}/quiz`} title={questionHint || undefined}>
                  做题{questions > 0 ? <span className="tabular-nums text-ink-faint">{questions}</span> : null}
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={cn('size-7 text-muted-foreground', HOVER_REVEAL)}
                    aria-label={`更多操作 ${title}`}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem onSelect={() => setProgressPalaceId(palace.id)}>
                    <CalendarClock />
                    复习进度
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => onDelete(palace.id, palace.title)}>
                    <Trash2 />
                    删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )
        }}
      />
      {progressPalaceId != null ? (
        <PalaceReviewUnitsPanel open palaceId={progressPalaceId} onClose={() => setProgressPalaceId(null)} />
      ) : null}
      {rowMenus.moveDialog}
    </>
  )
}
