import { Clock3 } from 'lucide-react'
import { readyLabel, useWaitingDue } from './FreestyleWaitingState'

/**
 * Closing page while 重练 is still booked for later.
 *
 * Every presented card is scored, but the server has not released the weak
 * units' re-checks yet (`waiting`). Calling that 本轮完成 was a lie the learner
 * could see: the trophy page asked 结算 while two cards were still owed, and
 * 结算 drops them for the rest of today. So this page states the wait, offers
 * going back to the feed to wait it out, and keeps ending-the-day as an
 * explicit trade-off rather than the default.
 */
export function FreestyleRoundWaiting({
  count,
  readyAt,
  ratedCount,
  onBack,
  onStop,
}: {
  count: number
  readyAt: string | null
  /** Units already scored this round — the achievement is not lost while waiting. */
  ratedCount: number
  onBack: () => void
  /** End the round anyway; the owed re-checks are not scheduled again today. */
  onStop: () => void
}) {
  const time = readyAt ? readyLabel(readyAt) : ''
  const { due, remaining } = useWaitingDue(readyAt)
  const when = !time
    ? '稍后自动回到队列'
    : due
      ? `${time} 已到点，正在取回`
      : `${time} 到点 · ${remaining}，到点自动回到队列`

  return (
    <div
      data-testid="freestyle-round-waiting"
      className="fs-complete-panel relative mx-auto w-full max-w-md overflow-hidden rounded-[1.75rem] border border-stage-line-strong bg-stage-raised/95 p-5 text-stage-ink shadow-[0_24px_80px_-16px_rgb(0_0_0/0.7)] sm:p-7"
    >
      <div className="flex flex-col items-center text-center">
        <div className="flex size-16 items-center justify-center rounded-full border border-stage-line-strong bg-stage/60 text-stage-muted">
          <Clock3 className="size-7" strokeWidth={2} aria-hidden />
        </div>
        <h2 className="mt-4 text-2xl font-semibold leading-tight">
          还有 <span className="tabular-nums">{count}</span> 张重练
        </h2>
        <p data-testid="freestyle-round-waiting-when" className="mt-1.5 text-sm text-stage-muted">
          {when}
        </p>
        <p className="mt-3 text-xs text-stage-muted">本轮已评分 {ratedCount} 个单元</p>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <button
          type="button"
          data-testid="freestyle-round-waiting-back"
          className="ma-pressable fs-cta-shine relative flex min-h-12 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-r from-primary to-primary-strong px-4 py-3 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110"
          onClick={onBack}
        >
          回去等它们
        </button>
        <button
          type="button"
          data-testid="freestyle-round-waiting-stop"
          className="ma-pressable flex min-h-12 items-center justify-center rounded-2xl border border-stage-line-strong px-4 py-3 text-sm font-medium text-stage-ink hover:bg-stage-ink/8"
          onClick={onStop}
        >
          今天到此为止
        </button>
      </div>

      <p className="mt-3 text-center text-[11px] leading-5 text-stage-muted">
        今天到此为止会结束本轮，这些重练今天不再安排。
      </p>
    </div>
  )
}
