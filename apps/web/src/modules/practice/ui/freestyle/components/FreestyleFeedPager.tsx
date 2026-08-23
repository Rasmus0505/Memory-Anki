import { ChevronDown, ChevronUp, ChevronsUp, Waypoints } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

const pagerButtonClass =
  'inline-flex size-11 items-center justify-center rounded-xl text-zinc-100 transition-colors hover:bg-white/10 active:bg-white/15 disabled:pointer-events-none disabled:opacity-35 sm:size-10'

const palaceButtonClass =
  'h-11 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-zinc-100 transition-colors hover:bg-white/10 active:bg-white/15 disabled:pointer-events-none disabled:opacity-35 sm:h-10 sm:flex-col sm:gap-0.5 sm:px-2 sm:py-1'

export function FreestyleFeedPager({
  canGoPrevious,
  canGoNext,
  canGoPreviousPalace,
  canGoNextPalace,
  sequentialBlockedHint,
  palaceMode = false,
  onPrevious,
  onNext,
  onPreviousPalace,
  onSkipPalace,
}: {
  canGoPrevious: boolean
  canGoNext: boolean
  canGoPreviousPalace: boolean
  canGoNextPalace: boolean
  sequentialBlockedHint: string | null
  palaceMode?: boolean
  onPrevious: () => void
  onNext: () => void
  onPreviousPalace: () => void
  onSkipPalace: () => void
}) {
  return (
    <div className="pointer-events-none absolute right-3 top-1/2 z-20 -translate-y-1/2">
      <div
        data-testid="freestyle-feed-pager"
        className="pointer-events-auto flex flex-col gap-1 rounded-2xl border border-white/12 bg-zinc-950/90 p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.4)] backdrop-blur-md"
      >
        <button
          type="button"
          className={pagerButtonClass}
          title={palaceMode ? '上一宫殿' : '上一张：返回上一个单元'}
          aria-label={palaceMode ? '上一宫殿' : '上一张'}
          disabled={!canGoPrevious}
          onClick={onPrevious}
        >
          <ChevronUp className="size-5 sm:size-4" />
        </button>
        <button
          type="button"
          className={pagerButtonClass}
          title={palaceMode ? '下一宫殿' : '下一张'}
          aria-label={palaceMode ? '下一宫殿' : '下一张'}
          disabled={!canGoNext}
          onClick={onNext}
        >
          <ChevronDown className="size-5 sm:size-4" />
        </button>
        {/* Palace skip stays desktop-only so the phone dock is two large targets. */}
        <button
          type="button"
          className={cn('hidden lg:inline-flex', palaceButtonClass)}
          title="回到上一组内容"
          aria-label="上一组"
          disabled={!canGoPreviousPalace}
          onClick={onPreviousPalace}
        >
          <ChevronsUp className="size-4 shrink-0" />
          <span className="leading-none">上一组</span>
        </button>
        <button
          type="button"
          className={cn('hidden lg:inline-flex', palaceButtonClass)}
          title={sequentialBlockedHint ?? '跳过本组：剩余内容移到队尾'}
          aria-label="跳过本组"
          disabled={!canGoNextPalace}
          onClick={onSkipPalace}
        >
          <Waypoints className="size-4 shrink-0" />
          <span className="leading-none">跳过</span>
        </button>
      </div>
    </div>
  )
}
