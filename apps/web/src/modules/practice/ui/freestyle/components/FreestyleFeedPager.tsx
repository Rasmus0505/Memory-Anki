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
    // Right edge on PWA and desktop alike: one vertical column, centred on the
    // card area (the stage header sits above it, so plain 50% would ride high).
    // Phones keep the same column so the controls sit where the learner's thumb
    // already is instead of adding a second strip over the dock.
    <div className="pointer-events-none absolute right-1 top-[calc(50%+var(--fs-hud-half,2.25rem))] z-30 -translate-y-1/2 sm:right-3">
      <div
        data-testid="freestyle-feed-pager"
        data-fx-anchor={FX_ANCHORS.feedPager}
        className="freestyle-stage-glass pointer-events-auto flex flex-col gap-1 rounded-2xl border border-stage-line-strong p-1 sm:p-1.5"
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
