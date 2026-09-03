import { useEffect, useRef, useState, type ReactNode } from 'react'
import { formatTimer } from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import {
  palaceAccentToneClass,
  progressHudText,
  progressRailLabel,
  type FreestyleProgressSummary,
} from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import type { SessionStatus } from '@/shared/hooks/timedSessionModel'
import { cn } from '@/shared/lib/utils'

/** Collapse the expanded clock after a glance so seconds stop pulling focus. */
const TIMER_PEEK_MS = 4_000

const TIMER_DOT_CLASS: Record<'running' | 'paused' | 'idle', string> = {
  running: 'bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.18)]',
  paused: 'bg-amber-300 shadow-[0_0_0_3px_rgba(252,211,77,0.18)]',
  idle: 'bg-zinc-500',
}

function timerTone(status: SessionStatus): 'running' | 'paused' | 'idle' {
  if (status === 'running') return 'running'
  if (status === 'paused') return 'paused'
  return 'idle'
}

export function FreestyleProgressRail({
  summary,
  timerStatus,
  effectiveSeconds,
  onOpenPlan,
  onTimerToggle,
  overflow,
}: {
  summary: FreestyleProgressSummary
  timerStatus: SessionStatus
  effectiveSeconds: number
  onOpenPlan: () => void
  onTimerToggle: () => void
  /** Overflow menu trigger + content, owned by the page. */
  overflow?: ReactNode
}) {
  const [timerExpanded, setTimerExpanded] = useState(false)
  const peekTimerRef = useRef<number | null>(null)
  const tone = timerTone(timerStatus)
  const timerCompleted = timerStatus === 'completed'

  useEffect(() => {
    return () => {
      if (peekTimerRef.current != null) window.clearTimeout(peekTimerRef.current)
    }
  }, [])

  const schedulePeekCollapse = () => {
    if (peekTimerRef.current != null) window.clearTimeout(peekTimerRef.current)
    peekTimerRef.current = window.setTimeout(() => {
      peekTimerRef.current = null
      setTimerExpanded(false)
    }, TIMER_PEEK_MS)
  }

  const handleTimerClick = () => {
    if (!timerCompleted) onTimerToggle()
    setTimerExpanded(true)
    schedulePeekCollapse()
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
      {/* Peripheral progress: one segment per card, so restudy re-insertion is visible. */}
      <button
        type="button"
        data-testid="freestyle-progress-rail"
        aria-label={progressRailLabel(summary)}
        className="pointer-events-auto flex h-4 w-full items-start gap-px px-0 pt-[max(0px,env(safe-area-inset-top,0px))]"
        onClick={onOpenPlan}
      >
        {summary.segments.length === 0 ? (
          <span className="h-0.5 w-full bg-white/10" aria-hidden />
        ) : (
          summary.segments.map((segment, index) => (
            <span
              key={segment.cardId}
              data-testid="freestyle-progress-segment"
              data-tone={segment.tone}
              data-palace-id={segment.palaceId == null ? '' : String(segment.palaceId)}
              data-palace-done={segment.palaceDone ? 'true' : 'false'}
              aria-hidden
              className={cn(
                'h-0.5 min-w-px flex-1 transition-colors',
                index > 0 && summary.segments[index - 1]?.palaceId !== segment.palaceId
                  ? 'ml-0.5'
                  : null,
                palaceAccentToneClass(segment.palaceId, segment.tone),
              )}
            />
          ))
        )}
      </button>

      <div className="flex items-start justify-between gap-1 px-2 pt-1 sm:px-3">
        {progressHudText(summary) ? (
          <button
            type="button"
            data-testid="freestyle-progress-hud"
            className="pointer-events-auto mt-0.5 max-w-[60%] truncate rounded-full px-2 py-1 text-left text-[11px] font-medium tabular-nums text-zinc-200/88 hover:text-white"
            aria-hidden
            onClick={onOpenPlan}
          >
            {progressHudText(summary)}
          </button>
        ) : (
          <span />
        )}
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-white/10 bg-zinc-950/82 px-1 py-0.5 shadow-[0_8px_28px_rgba(0,0,0,0.35)] backdrop-blur-md">
          <button
            type="button"
            data-testid="freestyle-timer-dot"
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 tabular-nums text-xs transition-colors hover:bg-white/10 active:bg-white/15',
              tone === 'running'
                ? 'text-emerald-300'
                : tone === 'paused'
                  ? 'text-amber-200'
                  : 'text-zinc-400',
            )}
            title={
              timerExpanded
                ? timerStatus === 'running'
                  ? '暂停计时'
                  : timerStatus === 'paused'
                    ? '继续计时'
                    : timerCompleted
                      ? '本次计时已完成'
                      : '开始计时'
                : '查看计时'
            }
            aria-label={
              timerExpanded
                ? timerStatus === 'running'
                  ? '暂停计时'
                  : timerStatus === 'paused'
                    ? '继续计时'
                    : timerCompleted
                      ? '本次计时已完成'
                      : '开始计时'
                : '查看计时'
            }
            onClick={handleTimerClick}
          >
            <span className={cn('size-2 shrink-0 rounded-full', TIMER_DOT_CLASS[tone])} aria-hidden />
            {timerExpanded ? (
              <span data-testid="freestyle-timer-readout">
                {timerStatus === 'idle'
                  ? '开始'
                  : formatTimer(effectiveSeconds)}
              </span>
            ) : null}
          </button>
          {overflow}
        </div>
      </div>
    </div>
  )
}
