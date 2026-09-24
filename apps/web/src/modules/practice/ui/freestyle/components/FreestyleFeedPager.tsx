import { Check, ChevronDown, ChevronUp } from 'lucide-react'

const pagerButtonClass =
  'inline-flex size-11 items-center justify-center rounded-xl text-zinc-100 transition-colors hover:bg-white/10 active:bg-white/15 disabled:pointer-events-none disabled:opacity-35 sm:size-10'

export function FreestyleFeedPager({
  canGoPrevious,
  canGoNext,
  canComplete,
  completeTitle,
  previousTitle = '上一张：返回上一个单元',
  onPrevious,
  onNext,
  onComplete,
}: {
  canGoPrevious: boolean
  canGoNext: boolean
  canComplete: boolean
  completeTitle: string
  previousTitle?: string
  onPrevious: () => void
  onNext: () => void
  onComplete: () => void
}) {
  return (
    <div className="pointer-events-none absolute right-3 top-1/2 z-30 -translate-y-1/2">
      <div
        data-testid="freestyle-feed-pager"
        className="pointer-events-auto flex flex-col gap-1 rounded-2xl border border-white/12 bg-zinc-950/90 p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.4)] backdrop-blur-md"
      >
        <button
          type="button"
          className={pagerButtonClass}
          title={previousTitle}
          aria-label="上一张"
          disabled={!canGoPrevious}
          onClick={onPrevious}
        >
          <ChevronUp className="size-5 sm:size-4" />
        </button>
        <button
          type="button"
          className={pagerButtonClass}
          title="下一张"
          aria-label="下一张"
          disabled={!canGoNext}
          onClick={onNext}
        >
          <ChevronDown className="size-5 sm:size-4" />
        </button>
        <button
          type="button"
          className={pagerButtonClass}
          title={completeTitle}
          aria-label="完成"
          disabled={!canComplete}
          onClick={onComplete}
        >
          <Check className="size-5 sm:size-4" />
        </button>
      </div>
    </div>
  )
}
