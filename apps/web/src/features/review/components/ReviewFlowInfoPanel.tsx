import { PenLine } from 'lucide-react'
import { formatDuration } from '@/entities/session/model'
import { SessionTimerBar } from '@/shared/components/session/SessionTimerBar'

interface ReviewFlowInfoPanelProps {
  visibleNonRootCount: number
  revealedNonRootCount: number
  redNodeCount: number
  effectiveSeconds: number
  persistProgress: boolean
  timer: {
    effectiveSeconds: number
    pauseCount: number
    status: 'idle' | 'running' | 'paused' | 'completed'
    start: (meta?: Record<string, boolean | number | string | null>) => void
    pause: (meta?: Record<string, boolean | number | string | null>) => void
    resume: (meta?: Record<string, boolean | number | string | null>) => void
    adjustDuration: (seconds: number) => void
  }
  fullscreen: boolean
}

export function ReviewFlowInfoPanel({
  visibleNonRootCount,
  revealedNonRootCount,
  redNodeCount,
  effectiveSeconds,
  persistProgress,
  timer,
  fullscreen,
}: ReviewFlowInfoPanelProps) {
  return (
    <>
      <SessionTimerBar
        effectiveSeconds={timer.effectiveSeconds}
        idleSeconds={timer.idleSeconds}
        pauseCount={timer.pauseCount}
        status={timer.status}
        onStart={() => timer.start({ source: 'manual' })}
        onPause={() => timer.pause({ source: 'manual' })}
        onResume={() => timer.resume({ source: 'manual' })}
        onAdjustDuration={timer.adjustDuration}
        showCompleteAction={false}
        showRestartAction={false}
        className={fullscreen ? 'fixed right-5 top-5 z-[90]' : 'sticky top-5 z-20'}
      />

      <div className="rounded-2xl border border-border/70 bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <PenLine className="h-4 w-4" />
          当前状态
        </div>
        <div className="mt-3 space-y-3 text-sm text-muted-foreground">
          <div className="rounded-2xl border border-border/70 bg-background/70 px-3 py-3">
            已出现 {visibleNonRootCount} 张，已揭示 {revealedNonRootCount} 张，
            红标 {redNodeCount} 张，当前有效时长 {formatDuration(effectiveSeconds)}。
          </div>
          <div className="rounded-2xl border border-dashed border-border/80 px-3 py-3">
            翻卡模式只接管鼠标揭示与标红，不影响导图正文。
          </div>
          {persistProgress ? (
            <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50 px-3 py-3 text-emerald-700">
              未完成时会自动续练；完成或手动重开后会清空这次练习进度。
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50 px-3 py-3 text-amber-700">
              正式复习不会跨退出保留当前翻卡进度，但会记录本次有效时长。
            </div>
          )}
        </div>
      </div>
    </>
  )
}
