import { Pause, Play, Settings2, SquareCheckBig, TimerReset } from 'lucide-react'
import * as React from 'react'
import { formatDuration } from '@/modules/session/public'
import { Button } from '@/shared/components/ui/button'
import { TimerAutomationDialog } from '@/shared/components/session/TimerAutomationDialog'
import { cn } from '@/shared/lib/utils'
import {
  readTimerAutomationConfig,
  resetTimerAutomationConfig,
  saveTimerAutomationConfig,
  TIMER_AUTOMATION_UPDATED_EVENT,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import { onAppEvent } from '@/shared/events/appEvents'

interface SessionTimerBarProps {
  effectiveSeconds: number
  pauseCount: number
  status: 'idle' | 'running' | 'paused' | 'completed'
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onComplete?: () => void
  onRestart?: () => void
  showCompleteAction?: boolean
  showRestartAction?: boolean
  layout?: 'card' | 'compact'
  className?: string
}

/** Inline timer controls. Duration is deliberately read-only; history editing owns manual changes. */
export function SessionTimerBar({
  effectiveSeconds,
  pauseCount,
  status,
  onStart,
  onPause,
  onResume,
  onComplete,
  onRestart,
  showCompleteAction = true,
  showRestartAction = true,
  layout = 'card',
  className,
}: SessionTimerBarProps) {
  const [automationOpen, setAutomationOpen] = React.useState(false)
  const [automationConfig, setAutomationConfig] = React.useState<TimerAutomationConfig>(() =>
    readTimerAutomationConfig(),
  )
  const primaryAction =
    status === 'idle'
      ? { icon: Play, label: '开始', onClick: onStart, variant: 'default' as const }
      : status === 'running'
        ? { icon: Pause, label: '暂停', onClick: onPause, variant: 'outline' as const }
        : status === 'paused'
          ? { icon: Play, label: '继续', onClick: onResume, variant: 'default' as const }
          : null

  React.useEffect(() => {
    return onAppEvent(TIMER_AUTOMATION_UPDATED_EVENT, (detail) => {
      setAutomationConfig(detail || readTimerAutomationConfig())
    })
  }, [])

  const automationDialog = (
    <TimerAutomationDialog
      open={automationOpen}
      config={automationConfig}
      onOpenChange={setAutomationOpen}
      onSave={(nextConfig) => setAutomationConfig(saveTimerAutomationConfig(nextConfig))}
      onReset={() => setAutomationConfig(resetTimerAutomationConfig())}
    />
  )

  const actions = (
    <div className="flex flex-wrap gap-2">
      {showRestartAction && onRestart ? (
        <Button type="button" variant="ghost" size="sm" onClick={onRestart} title="重新开始">
          <TimerReset className="size-4" />
        </Button>
      ) : null}
      <Button type="button" variant="outline" size="sm" onClick={() => setAutomationOpen(true)}>
        <Settings2 className="mr-2 size-4" />
        计时设置
      </Button>
      {primaryAction ? (
        <Button type="button" variant={primaryAction.variant} size="sm" onClick={primaryAction.onClick}>
          <primaryAction.icon className="mr-2 size-4" />
          {primaryAction.label}
        </Button>
      ) : null}
      {showCompleteAction && onComplete ? (
        <Button type="button" variant="secondary" size="sm" onClick={onComplete}>
          <SquareCheckBig className="mr-2 size-4" />
          完成
        </Button>
      ) : null}
    </div>
  )

  if (layout === 'compact') {
    return (
      <>
        <div
          className={cn(
            'rounded-lg border border-border/70 bg-background/95 px-4 py-3 shadow-soft backdrop-blur',
            className,
          )}
          data-testid="session-timer-bar"
          data-layout="compact"
        >
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="text-xl font-semibold text-foreground">{formatDuration(effectiveSeconds)}</div>
              <div className="mt-1 text-xs text-muted-foreground">已暂停 {pauseCount} 次</div>
            </div>
            {actions}
          </div>
        </div>
        {automationDialog}
      </>
    )
  }

  return (
    <div className={className ?? 'fixed right-5 top-5 z-40'} data-testid="session-timer-bar" data-layout="card">
      <div className="w-[320px] rounded-lg border border-border/70 bg-background/95 p-4 shadow-popover backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-semibold text-foreground">{formatDuration(effectiveSeconds)}</div>
            <div className="mt-1 text-xs text-muted-foreground">已暂停 {pauseCount} 次</div>
          </div>
          {showRestartAction && onRestart ? (
            <Button type="button" variant="ghost" size="sm" onClick={onRestart} title="重新开始">
              <TimerReset className="size-4" />
            </Button>
          ) : null}
        </div>
        <div className="mt-4">{actions}</div>
      </div>
      {automationDialog}
    </div>
  )
}
