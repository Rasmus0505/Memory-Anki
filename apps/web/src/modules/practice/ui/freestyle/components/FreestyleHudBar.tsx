import { Clock3, Sparkles } from 'lucide-react'
import { formatTimer } from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import { MODE_LABELS } from '@/modules/practice/ui/freestyle/model/freestyle-labels'
import type { FreestyleMode } from '@/modules/practice/ui/freestyle/model/today-training'
import type { useTimedSession } from '@/shared/hooks/useTimedSession'
import { cn } from '@/shared/lib/utils'

type TimerStatus = ReturnType<typeof useTimedSession>['status']

export function FreestyleHudBar({
  mode,
  queueLength,
  summaryVisible,
  currentIndex,
  quizTotal,
  freshCount,
  correctStreak,
  timerStatus,
  effectiveSeconds,
  onSwitchMode,
}: {
  mode: FreestyleMode
  queueLength: number
  summaryVisible: boolean
  currentIndex: number
  quizTotal: number
  freshCount: number
  correctStreak: number
  timerStatus: TimerStatus
  effectiveSeconds: number
  onSwitchMode: (mode: FreestyleMode) => void
}) {
  return (
    <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex w-full max-w-[100vw] flex-wrap items-start justify-between gap-2 px-3 py-3 sm:w-auto sm:flex-nowrap sm:px-4 sm:py-4">
      {/* 左侧：模式切换 */}
      <div className="pointer-events-auto flex max-w-full items-center gap-0.5 rounded-full border border-white/10 bg-zinc-950/85 p-0.5 shadow-lg ring-1 ring-white/8 backdrop-blur">
        <Sparkles className="ml-2 hidden size-3.5 shrink-0 text-amber-300 sm:block" />
        {(['today', 'free'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              mode === item
                ? 'bg-emerald-300 text-zinc-950'
                : 'text-zinc-400 hover:text-zinc-100',
            )}
            onClick={() => onSwitchMode(item)}
          >
            {MODE_LABELS[item]}
          </button>
        ))}
      </div>

      {/* 右侧：进度 + 连对 + 计时 */}
      <div className="pointer-events-auto flex max-w-full items-center gap-1.5 overflow-hidden rounded-full border border-white/10 bg-zinc-950/85 px-3 py-2 text-xs shadow-lg ring-1 ring-white/8 backdrop-blur">
        <span className="tabular-nums text-zinc-300">
          {queueLength === 0
            ? '0/0'
            : summaryVisible
              ? `${queueLength}/${queueLength}`
              : `${currentIndex + 1}/${queueLength}`}
        </span>
        {quizTotal > 0 && (
          <>
            <span className="text-zinc-600">·</span>
            <span className="text-[10px] text-zinc-500">{freshCount}未做</span>
          </>
        )}
        {correctStreak > 0 && (
          <>
            <span className="text-zinc-600">·</span>
            <span
              key={correctStreak}
              className="animate-[streak-pop_0.3s_ease-out] text-emerald-300"
            >
              连对{correctStreak}
            </span>
          </>
        )}
        <span className="text-zinc-600">·</span>
        <Clock3 className="size-3.5 shrink-0 text-zinc-400" />
        <span className="tabular-nums text-zinc-300">
          {timerStatus === 'running'
            ? formatTimer(effectiveSeconds)
            : timerStatus === 'paused'
              ? '暂停'
              : '--:--'}
        </span>
      </div>
    </div>
  )
}
