import type { MouseEvent } from 'react'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { FX_ANCHORS } from '@/shared/fx'

const pagerButtonClass =
  'ma-pressable inline-flex size-11 items-center justify-center rounded-xl text-stage-ink hover:bg-stage-line hover:text-stage-glow active:bg-stage-line-strong disabled:pointer-events-none disabled:opacity-35 sm:size-10'

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
  // Paging is a one-shot: release focus so the next Enter flips the card that
  // owns the screen instead of paging again (the next unit may still be loading).
  const activateAndRelease = (action: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.blur()
    action()
  }

  return (
    // Phones: a short horizontal strip above the rating dock. The old mid-right
    // vertical column sat on top of the mind map (and its nodes) all session.
    <div className="pointer-events-none absolute bottom-[calc(env(safe-area-inset-bottom,0px)+5.15rem)] right-2 z-30 sm:bottom-auto sm:right-3 sm:top-1/2 sm:-translate-y-1/2">
      <div
        data-testid="freestyle-feed-pager"
        data-fx-anchor={FX_ANCHORS.feedPager}
        className="freestyle-stage-glass pointer-events-auto flex flex-row gap-1 rounded-2xl border border-stage-line-strong p-1 sm:flex-col sm:p-1.5"
      >
        <button
          type="button"
          className={pagerButtonClass}
          title={previousTitle}
          aria-label="上一张"
          disabled={!canGoPrevious}
          onClick={activateAndRelease(onPrevious)}
        >
          <ChevronUp className="size-5 sm:size-4" />
        </button>
        <button
          type="button"
          className={pagerButtonClass}
          title="下一张"
          aria-label="下一张"
          disabled={!canGoNext}
          onClick={activateAndRelease(onNext)}
        >
          <ChevronDown className="size-5 sm:size-4" />
        </button>
        <button
          type="button"
          className={pagerButtonClass}
          title={completeTitle}
          aria-label="完成"
          disabled={!canComplete}
          onClick={activateAndRelease(onComplete)}
        >
          <Check className="size-5 sm:size-4" />
        </button>
      </div>
    </div>
  )
}
