import { Play } from 'lucide-react'
import { formatTimer } from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import type { TodayTrainingSummary } from '@/modules/practice/ui/freestyle/model/today-training'
import { Button } from '@/shared/components/ui/button'

export function FreestyleRoundSummaryCard({
  summary,
  onNextRound,
  onSwitchToFree,
}: {
  summary: TodayTrainingSummary
  onNextRound: () => void
  onSwitchToFree: () => void
}) {
  const accuracy = summary.answeredCount > 0
    ? Math.round((summary.correctCount / summary.answeredCount) * 100)
    : 0

  return (
    <div className="mx-auto flex min-h-[min(720px,calc(100vh-150px))] w-full max-w-[calc(100vw-3rem)] flex-col justify-center px-0 py-16 sm:max-w-3xl sm:px-4">
      <div className="rounded-2xl border border-emerald-300/20 bg-zinc-900/90 p-5 text-zinc-50 shadow-[0_16px_56px_rgba(0,0,0,0.58)] backdrop-blur sm:p-7">
        <div className="text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-emerald-300/25 bg-emerald-300/10 text-3xl">
            OK
          </div>
          <div className="mt-4 text-xs font-semibold uppercase text-emerald-300">
            今日训练
          </div>
          <h2 className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl">本轮完成</h2>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
            <div className="text-4xl font-bold">{summary.totalCount}</div>
            <div className="mt-1 text-xs text-zinc-400">本轮项目</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
            <div className="text-4xl font-bold">{summary.answeredCount}</div>
            <div className="mt-1 text-xs text-zinc-400">已答题</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
            <div className="text-4xl font-bold text-emerald-300">{accuracy}%</div>
            <div className="mt-1 text-xs text-zinc-400">正确率</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
            <div className="text-4xl font-bold text-amber-200">{formatTimer(summary.durationSeconds)}</div>
            <div className="mt-1 text-xs text-zinc-400">用时</div>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-zinc-300">
          <div>到期继续卡 {summary.dueActionCount} 个</div>
          <div className="mt-1 text-zinc-400">{summary.suggestion}</div>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button type="button" className="bg-emerald-300 text-zinc-950 hover:bg-emerald-200" onClick={onNextRound}>
            <Play className="size-4" />
            再来一轮
          </Button>
          <Button type="button" variant="outline" onClick={onSwitchToFree}>
            切到自由随心
          </Button>
        </div>
      </div>
    </div>
  )
}
