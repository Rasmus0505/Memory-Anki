import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

/** Unmeasured fallback. A real row replaces this with however many pills fit. */
export const QUIZ_QUESTION_INDEX_PAGE_SIZE = 20

/** `size-7` pill. Used when the row has not painted a pill yet. */
export const QUIZ_INDEX_BUTTON_PX = 28

/** `gap-1` between pills. */
export const QUIZ_INDEX_GAP_PX = 4

export function quizIndexPage(index: number, pageSize = QUIZ_QUESTION_INDEX_PAGE_SIZE) {
  if (!Number.isInteger(index) || index < 0) return 0
  const size = pageSize > 0 ? pageSize : QUIZ_QUESTION_INDEX_PAGE_SIZE
  return Math.floor(index / size)
}

/** How many fixed-size pills fit on one row. `0` means the row width is not known yet. */
export function quizIndexPageCapacity(
  width: number,
  buttonPx = QUIZ_INDEX_BUTTON_PX,
  gapPx = QUIZ_INDEX_GAP_PX,
) {
  if (!Number.isFinite(width) || width <= 0) return 0
  if (!Number.isFinite(buttonPx) || buttonPx <= 0) return 0
  const gap = Number.isFinite(gapPx) && gapPx > 0 ? gapPx : 0
  return Math.max(1, Math.floor((width + gap) / (buttonPx + gap)))
}

export function quizIndexPagerLabel(
  pageIndex: number,
  pageCount: number,
  currentIndex: number,
  count: number,
) {
  const progress = `第 ${currentIndex + 1} / ${count} 题`
  if (pageCount <= 1) return progress
  return `第 ${pageIndex + 1}/${pageCount} 页 · ${progress}`
}

function readIndexRowCapacity(row: HTMLElement) {
  const button = row.querySelector<HTMLElement>('[data-quiz-index-item]')
  const measuredButton = button?.getBoundingClientRect().width ?? 0
  const buttonPx = measuredButton > 0 ? measuredButton : QUIZ_INDEX_BUTTON_PX
  const parsedGap = Number.parseFloat(getComputedStyle(row).columnGap)
  const gapPx = Number.isFinite(parsedGap) && parsedGap >= 0 ? parsedGap : QUIZ_INDEX_GAP_PX
  return quizIndexPageCapacity(row.clientWidth, buttonPx, gapPx)
}

export function QuizQuestionIndexPager({
  count,
  currentIndex,
  pageSize: explicitPageSize,
  getItemState,
  onSelect,
}: {
  count: number
  currentIndex: number
  /** Lock the page length. Omit it and the row width decides. */
  pageSize?: number
  getItemState: (index: number) => { done: boolean; correct?: boolean; marked?: boolean }
  onSelect: (index: number) => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [measuredPageSize, setMeasuredPageSize] = useState<number | null>(null)
  const pageSize =
    explicitPageSize != null && explicitPageSize > 0
      ? explicitPageSize
      : measuredPageSize ?? QUIZ_QUESTION_INDEX_PAGE_SIZE
  const safeCount = Math.max(0, count)
  const pageCount = Math.max(1, Math.ceil(safeCount / pageSize))
  const derivedPage = Math.min(pageCount - 1, quizIndexPage(currentIndex, pageSize))
  const [page, setPage] = useState(derivedPage)

  useLayoutEffect(() => {
    if (explicitPageSize != null && explicitPageSize > 0) return
    const node = rowRef.current
    if (!node) return
    const measure = () => {
      const capacity = readIndexRowCapacity(node)
      if (capacity > 0) {
        setMeasuredPageSize((current) => (current === capacity ? current : capacity))
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [explicitPageSize, safeCount])

  // A wider or narrower window changes the page length. Jump back so the
  // current question stays on the only visible row.
  useLayoutEffect(() => {
    setPage(derivedPage)
  }, [derivedPage, pageSize])

  const start = page * pageSize
  const end = Math.min(safeCount, start + pageSize)
  const indexes = useMemo(
    () => Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset),
    [end, start],
  )

  if (safeCount <= 1) return null

  const showPagerControls = safeCount > pageSize
  const label = quizIndexPagerLabel(page, pageCount, currentIndex, safeCount)

  return (
    <div className="sticky -top-3 z-10 -mx-4 -mt-3 space-y-2 border-b border-border/60 bg-background/95 px-4 py-2 backdrop-blur">
      <div
        className={cn(
          'flex items-center gap-2',
          showPagerControls ? 'justify-between' : 'justify-center',
        )}
      >
        {showPagerControls ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            aria-label="上一页"
            disabled={page <= 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            <ChevronLeft className="size-4" />
            上一页
          </Button>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-center text-xs tabular-nums text-muted-foreground">
          {label}
        </span>
        {showPagerControls ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            aria-label="下一页"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
          >
            下一页
            <ChevronRight className="size-4" />
          </Button>
        ) : null}
      </div>
      <div ref={rowRef} className="flex flex-nowrap items-center gap-1">
        {indexes.map((itemIndex) => {
          const itemState = getItemState(itemIndex)
          const done = Boolean(itemState.done)
          const marked = Boolean(itemState.marked)
          const active = itemIndex === currentIndex
          return (
            <button
              key={itemIndex}
              type="button"
              data-quiz-index-item=""
              aria-current={active ? 'true' : undefined}
              data-marked={marked ? 'true' : undefined}
              title={`第 ${itemIndex + 1} 题${marked ? '（已标记）' : ''}${done ? (itemState.correct === false ? '（已答·错）' : '（已答）') : ''}`}
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors',
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
