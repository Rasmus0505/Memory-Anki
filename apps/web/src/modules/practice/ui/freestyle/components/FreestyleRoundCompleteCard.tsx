import { Play, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { formatTimer } from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import type { FreestyleRoundCompletion } from '@/modules/practice/ui/freestyle/model/roundCompletion'
import { Button } from '@/shared/components/ui/button'

/**
 * Closing slot of a round. Rating the last card used to leave the feed simply
 * empty; flow needs a visible end before the next start.
 */
export function FreestyleRoundCompleteCard({
  completion,
  durationSeconds,
  onNextRound,
  onOpenConfig,
  onReviewRound,
  loading = false,
}: {
  completion: FreestyleRoundCompletion
  durationSeconds: number
  onNextRound: () => void
  onOpenConfig: () => void
  /** Back to the first card, so a finished round stays reviewable. */
  onReviewRound: () => void
  loading?: boolean
}) {
  return (
    <div
      data-testid="freestyle-round-complete"
      className="mx-auto flex h-full w-full max-w-2xl flex-col justify-center px-1 py-4"
    >
      <div className="rounded-3xl border border-emerald-300/20 bg-zinc-900/90 p-5 text-zinc-50 shadow-[0_16px_56px_rgba(0,0,0,0.5)] backdrop-blur sm:p-7">
        <div className="text-center">
          <div className="text-xs font-semibold tracking-wide text-emerald-300">本轮完成</div>
          <h2 className="mt-1.5 text-2xl font-semibold leading-tight sm:text-3xl">
            {completion.ratedCount} 张已评分
          </h2>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-center">
            <div className="text-2xl font-bold text-emerald-300 sm:text-3xl">
              {completion.passedCount}
            </div>
            <div className="mt-1 text-[11px] text-zinc-400 sm:text-xs">已通过</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-center">
            <div className="text-2xl font-bold text-amber-200 sm:text-3xl">
              {completion.retryCount}
            </div>
            <div className="mt-1 text-[11px] text-zinc-400 sm:text-xs">待重练</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-center">
            <div className="text-2xl font-bold tabular-nums sm:text-3xl">
              {formatTimer(durationSeconds)}
            </div>
            <div className="mt-1 text-[11px] text-zinc-400 sm:text-xs">用时</div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-center text-xs text-zinc-300">
          {completion.remainingCandidates > 0
            ? `还有 ${completion.remainingCandidates} 张候选没安排进本轮`
            : '候选内容已全部安排完'}
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button
            type="button"
            disabled={loading}
            aria-busy={loading}
            className="bg-emerald-300 text-zinc-950 hover:bg-emerald-200"
            onClick={onNextRound}
          >
            <Play className="size-4" />
            {loading ? '正在安排...' : '再来一轮'}
          </Button>
          <Button type="button" variant="outline" onClick={onOpenConfig}>
            <SlidersHorizontal className="size-4" />
            调整配置
          </Button>
          <Button type="button" variant="ghost" onClick={onReviewRound}>
            <RotateCcw className="size-4" />
            回看本轮
          </Button>
        </div>
      </div>
    </div>
  )
}
