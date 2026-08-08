import { useEffect, useRef, useState, type ReactNode } from 'react'
import { formatTimer } from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import {
  progressRailLabel,
  type FreestyleProgressSummary,
  type FreestyleSegmentTone,
} from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import { cn } from '@/shared/lib/utils'

type TimerStatus = 'idle' | 'running' | 'paused' | 'stopped'

/** Collapse the expanded clock after a glance so seconds stop pulling focus. */
const TIMER_PEEK_MS = 4_000

const SEGMENT_TONE_CLASS: Record<FreestyleSegmentTone, string> = {
  done: 'bg-emerald-400/85',
  retry: 'bg-amber-300/85',
  current: 'bg-zinc-100',
  pending: 'bg-white/14',
}

const TIMER_DOT_CLASS: Record<'running' | 'paused' | 'idle', string> = {
  running: 'bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.18)]',
  paused: 'bg-amber-300 shadow-[0_0_0_3px_rgba(252,211,77,0.18)]',
  idle: 'bg-zinc-500',
}

function timerTone(status: TimerStatus): 'running' | 'paused' | 'idle' {
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
  timerStatus: TimerStatus
  effectiveSeconds: number
  onOpenPlan: () => void
  onTimerToggle: () => void
  /** Overflow menu trigger + content, owned by the page. */
  overflow?: ReactNode
}) {
  const [timerExpanded, setTimerExpanded] = useState(false)
  const peekTimerRef = useRef<number | null>(null)
  const tone = timerTone(timerStatus)

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
    // First tap reveals the clock; a tap while expanded starts/pauses it.
    if (!timerExpanded) {
      setTimerExpanded(true)
      schedulePeekCollapse()
      return
    }
    onTimerToggle()
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
          summary.segments.map((segment) => (
            <span
              key={segment.cardId}
              data-testid="freestyle-progress-segment"
              data-tone={segment.tone}
              aria-hidden
              className={cn(
                'h-0.5 min-w-px flex-1 transition-colors',
                SEGMENT_TONE_CLASS[segment.tone],
              )}
            />
          ))
        )}
      </button>

      <div className="flex items-start justify-end gap-1 px-2 pt-1 sm:px-3">
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
                    : '开始计时'
                : '查看计时'
            }
            aria-label={
              timerExpanded
                ? timerStatus === 'running'
                  ? '暂停计时'
                  : timerStatus === 'paused'
                    ? '继续计时'
                    : '开始计时'
                : '查看计时'
            }
            onClick={handleTimerClick}
          >
            <span className={cn('size-2 shrink-0 rounded-full', TIMER_DOT_CLASS[tone])} aria-hidden />
            {timerExpanded ? (
              <span data-testid="freestyle-timer-readout">
                {timerStatus === 'idle' || timerStatus === 'stopped'
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
