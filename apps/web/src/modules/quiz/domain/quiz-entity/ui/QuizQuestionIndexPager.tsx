import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

export const QUIZ_QUESTION_INDEX_PAGE_SIZE = 20

export function quizIndexPage(index: number, pageSize = QUIZ_QUESTION_INDEX_PAGE_SIZE) {
  if (!Number.isInteger(index) || index < 0) return 0
  return Math.floor(index / pageSize)
}

export function QuizQuestionIndexPager({
  count,
  currentIndex,
  pageSize = QUIZ_QUESTION_INDEX_PAGE_SIZE,
  getItemState,
  onSelect,
}: {
  count: number
  currentIndex: number
  pageSize?: number
  getItemState: (index: number) => { done: boolean; correct?: boolean; marked?: boolean }
  onSelect: (index: number) => void
}) {
  const safeCount = Math.max(0, count)
  const pageCount = Math.max(1, Math.ceil(safeCount / pageSize))
  const derivedPage = Math.min(pageCount - 1, quizIndexPage(currentIndex, pageSize))
  const [page, setPage] = useState(derivedPage)

  useEffect(() => {
    setPage(derivedPage)
  }, [derivedPage])

  const start = page * pageSize
  const end = Math.min(safeCount, start + pageSize)
  const indexes = useMemo(
    () => Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset),
    [end, start],
  )

  if (safeCount <= 1) return null

  return (
    <div className="sticky -top-3 z-10 -mx-4 -mt-3 space-y-2 border-b border-border/60 bg-background/95 px-4 py-2 backdrop-blur">
      {safeCount > pageSize ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="上一页"
            disabled={page <= 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            <ChevronLeft className="size-4" />
            上一页
          </Button>
          <span className="min-w-0 truncate text-xs tabular-nums text-muted-foreground">
            {`第 ${page + 1}/${pageCount} 页（${start + 1}–${end}）`}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="下一页"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
          >
            下一页
            <ChevronRight className="size-4" />
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        {indexes.map((itemIndex) => {
          const itemState = getItemState(itemIndex)
          const done = Boolean(itemState.done)
          const marked = Boolean(itemState.marked)
          const active = itemIndex === currentIndex
          return (
            <button
              key={itemIndex}
              type="button"
              aria-current={active ? 'true' : undefined}
              data-marked={marked ? 'true' : undefined}
              title={`第 ${itemIndex + 1} 题${marked ? '（已标记）' : ''}${done ? (itemState.correct === false ? '（已答·错）' : '（已答）') : ''}`}
              className={cn(
                'flex size-7 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors',
                marked
                  ? active
                    ? 'border-rose-700 bg-rose-600 text-white ring-2 ring-primary ring-offset-1'
                    : 'border-rose-700 bg-rose-600 text-white shadow-sm'
                  : active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : done
                      ? itemState.correct === false
                        ? 'border-destructive/45 bg-destructive/10 text-destructive'
                        : 'border-emerald-500/45 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-border bg-background text-foreground hover:bg-muted',
              )}
              onClick={() => onSelect(itemIndex)}
            >
              {itemIndex + 1}
            </button>
          )
        })}
      </div>
    </div>
  )
}
