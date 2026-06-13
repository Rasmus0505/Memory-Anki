import { Pause, Play, Settings2, SquareCheckBig, TimerReset } from 'lucide-react'
import * as React from 'react'
import { formatDuration } from '@/entities/session/model'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { TimerAutomationDialog } from '@/shared/components/session/TimerAutomationDialog'
import { cn } from '@/shared/lib/utils'
import {
  getTimerAutomationRule,
  readTimerAutomationConfig,
  resetTimerAutomationConfig,
  saveTimerAutomationConfig,
  type TimerAutomationConfig,
  type TimerAutomationScene,
} from '@/shared/components/session/timer-automation-config'

interface SessionTimerBarProps {
  effectiveSeconds: number
  idleSeconds?: number
  automationScene?: TimerAutomationScene
  pauseCount: number
  status: 'idle' | 'running' | 'paused' | 'completed'
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onComplete?: () => void
  onRestart?: () => void
  onAdjustDuration: (seconds: number) => void
  showCompleteAction?: boolean
  showRestartAction?: boolean
  layout?: 'card' | 'compact'
  className?: string
}

function secondsToInputValue(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds))
  const hours = `${Math.floor(safeSeconds / 3600)}`.padStart(2, '0')
  const minutes = `${Math.floor((safeSeconds % 3600) / 60)}`.padStart(2, '0')
  const remainSeconds = `${safeSeconds % 60}`.padStart(2, '0')
  return `${hours}:${minutes}:${remainSeconds}`
}

function inputValueToSeconds(value: string) {
  const parts = value.split(':').map((part) => Number(part))
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part) || part < 0)) {
    return null
  }
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

export function SessionTimerBar({
  effectiveSeconds,
  idleSeconds = 0,
  automationScene = 'practice',
  pauseCount,
  status,
  onStart,
  onPause,
  onResume,
  onComplete,
  onRestart,
  onAdjustDuration,
  showCompleteAction = true,
  showRestartAction = true,
  layout = 'card',
  className,
}: SessionTimerBarProps) {
  const isIdle = status === 'idle'
  const isRunning = status === 'running'
  const isPaused = status === 'paused'
  const safeIdleSeconds = Math.max(0, Math.round(idleSeconds))
  const [inputValue, setInputValue] = React.useState(() => secondsToInputValue(effectiveSeconds))
  const [isEditing, setIsEditing] = React.useState(false)
  const [automationOpen, setAutomationOpen] = React.useState(false)
  const [automationConfig, setAutomationConfig] = React.useState<TimerAutomationConfig>(() =>
    readTimerAutomationConfig(),
  )
  const inactiveAutoPauseSeconds = React.useMemo(
    () => getTimerAutomationRule(automationScene, automationConfig).inactiveAutoPauseSeconds,
    [automationConfig, automationScene],
  )

  React.useEffect(() => {
    if (isEditing) return
    setInputValue(secondsToInputValue(effectiveSeconds))
  }, [effectiveSeconds, isEditing])

  const commitInputValue = React.useCallback(() => {
    const seconds = inputValueToSeconds(inputValue)
    if (seconds != null) {
      onAdjustDuration(seconds)
      setInputValue(secondsToInputValue(seconds))
      return
    }
    setInputValue(secondsToInputValue(effectiveSeconds))
  }, [effectiveSeconds, inputValue, onAdjustDuration])

  React.useEffect(() => {
    const handleAutomationChange = (event: Event) => {
      const nextConfig =
        event instanceof CustomEvent && event.detail
          ? (event.detail as TimerAutomationConfig)
          : readTimerAutomationConfig()
      setAutomationConfig(nextConfig)
    }

    window.addEventListener('memory-anki-timer-automation-change', handleAutomationChange)
    return () => {
      window.removeEventListener('memory-anki-timer-automation-change', handleAutomationChange)
    }
  }, [])

  const primaryAction = isIdle
    ? {
        icon: Play,
        label: '开始',
        onClick: onStart,
        variant: 'default' as const,
      }
    : isRunning
      ? {
          icon: Pause,
          label: '暂停',
          onClick: onPause,
          variant: 'outline' as const,
        }
      : isPaused
        ? {
            icon: Play,
            label: '继续',
            onClick: onResume,
            variant: 'default' as const,
          }
        : null

  const automationDialog = (
    <TimerAutomationDialog
      open={automationOpen}
      config={automationConfig}
      onOpenChange={setAutomationOpen}
      onSave={(nextConfig) => {
        const saved = saveTimerAutomationConfig(nextConfig)
        setAutomationConfig(saved)
      }}
      onReset={() => {
        const reset = resetTimerAutomationConfig()
        setAutomationConfig(reset)
      }}
    />
  )

  const idleStatusClassName = safeIdleSeconds > 0 ? 'text-orange-500' : 'text-foreground'
  const idleStatusText = `闲置${safeIdleSeconds}/${inactiveAutoPauseSeconds}秒`

  if (layout === 'compact') {
    return (
      <>
        <div
          className={cn(
            'rounded-2xl border border-border/70 bg-background/95 px-4 py-3 shadow-[0_14px_40px_rgba(15,23,42,0.12)] backdrop-blur',
            className,
          )}
          data-testid="session-timer-bar"
          data-layout="compact"
        >
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
              <div className="min-w-[120px]">
                <div className="text-xl font-semibold text-foreground">{formatDuration(effectiveSeconds)}</div>
                <div className="mt-1 text-xs text-muted-foreground">已暂停 {pauseCount} 次</div>
                <div className={cn('text-xs transition-colors', idleStatusClassName)}>{idleStatusText}</div>
              </div>

              <label className="w-full lg:max-w-[180px]">
                <Input
                  aria-label="调整总时长"
                  value={inputValue}
                  className="h-8"
                  onFocus={() => setIsEditing(true)}
                  onBlur={() => {
                    setIsEditing(false)
                    commitInputValue()
                  }}
                  onChange={(event) => setInputValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur()
                    }
                  }}
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              {showRestartAction && onRestart ? (
                <Button type="button" variant="ghost" size="sm" onClick={onRestart}>
                  <TimerReset className="h-4 w-4" />
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => setAutomationOpen(true)}>
                <Settings2 className="mr-2 h-4 w-4" />
                自动化配置
              </Button>
              {primaryAction ? (
                <Button type="button" variant={primaryAction.variant} size="sm" onClick={primaryAction.onClick}>
                  <primaryAction.icon className="mr-2 h-4 w-4" />
                  {primaryAction.label}
                </Button>
              ) : null}
              {showCompleteAction && onComplete ? (
                <Button type="button" variant="secondary" size="sm" onClick={onComplete}>
                  <SquareCheckBig className="mr-2 h-4 w-4" />
                  完成
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        {automationDialog}
      </>
    )
  }

  return (
    <div className={className ?? 'fixed right-5 top-5 z-40'} data-testid="session-timer-bar" data-layout="card">
      <div className="w-[320px] rounded-2xl border border-border/70 bg-background/95 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.18)] backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-semibold text-foreground">{formatDuration(effectiveSeconds)}</div>
            <div className="mt-1 text-xs text-muted-foreground">已暂停 {pauseCount} 次</div>
            <div className={cn('text-xs transition-colors', idleStatusClassName)}>{idleStatusText}</div>
          </div>
          {showRestartAction && onRestart ? (
            <Button type="button" variant="ghost" size="sm" onClick={onRestart}>
              <TimerReset className="h-4 w-4" />
            </Button>
          ) : null}
        </div>

        <div className="mt-3 space-y-2">
          <label className="block">
            <Input
              aria-label="调整总时长"
              value={inputValue}
              onFocus={() => setIsEditing(true)}
              onBlur={() => {
                setIsEditing(false)
                commitInputValue()
              }}
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
              }}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setAutomationOpen(true)}>
            <Settings2 className="mr-2 h-4 w-4" />
            自动化配置
          </Button>
          {primaryAction ? (
            <Button type="button" variant={primaryAction.variant} size="sm" onClick={primaryAction.onClick}>
              <primaryAction.icon className="mr-2 h-4 w-4" />
              {primaryAction.label}
            </Button>
          ) : null}
          {showCompleteAction && onComplete ? (
            <Button type="button" variant="secondary" size="sm" onClick={onComplete}>
              <SquareCheckBig className="mr-2 h-4 w-4" />
              完成
            </Button>
          ) : null}
        </div>
      </div>
      {automationDialog}
    </div>
  )
}
