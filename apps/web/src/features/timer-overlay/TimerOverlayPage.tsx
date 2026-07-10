import * as React from 'react'
import { ChevronsDown, ChevronsUp, Pause, Play } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import {
  getDesktopTimerBridge,
  type UnifiedTimerCommand,
  type UnifiedTimerSnapshot,
} from '@/shared/components/session/desktopTimerBridge'
import { cn } from '@/shared/lib/utils'
import { readReviewFeedbackSettings } from '@/shared/feedback/reviewFeedbackSettings'

function formatOverlayClock(seconds: number | null) {
  if (seconds == null) return '--:--'
  const safeSeconds = Math.max(0, Math.round(seconds))
  const minutes = `${Math.floor(safeSeconds / 60)}`.padStart(2, '0')
  const remainder = `${safeSeconds % 60}`.padStart(2, '0')
  return `${minutes}:${remainder}`
}

function createIdleSnapshot(): UnifiedTimerSnapshot {
  return {
    mode: 'study',
    status: 'idle',
    title: '待开始',
    scene: '学习计时',
    displaySeconds: null,
    studyPhase: 'idle',
    effectiveSeconds: 0,
    roundElapsedSeconds: 0,
    roundTargetSeconds: 25 * 60,
    roundIndex: 1,
    idleWarningRemainingSeconds: null,
    suggestedBreakMinutes: 5,
    feedbackSignal: null,
    primaryText: '当前无学习会话',
    secondaryText: '打开主窗口开始学习后会同步显示',
    snoozeCount: 0,
    availableActions: [],
    presetMinutes: [5, 10, 20],
    allowCustomMinutes: true,
    snoozeMinutes: [1, 3, 5],
    targetPath: '/freestyle',
    updatedAt: Date.now(),
  }
}

function playTimerBeep(kind: 'interval' | 'goal' | 'break' = 'break') {
  try {
    const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextConstructor) return
    const context = new AudioContextConstructor()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(
      kind === 'goal' ? 1046 : kind === 'interval' ? 784 : 880,
      context.currentTime,
    )
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.13, context.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (kind === 'goal' ? 0.58 : 0.42))
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + (kind === 'goal' ? 0.6 : 0.44))
    window.setTimeout(() => void context.close(), 700)
  } catch {
    // Browsers may block audio before user interaction.
  }
}

function notifyBreakExpired() {
  if (!readReviewFeedbackSettings().desktopNotificationsEnabled) return
  if (!('Notification' in window)) return
  if (Notification.permission === 'granted') {
    new Notification('休息时间到了', { body: '回到随心模式继续一点点就好。' })
  }
}

export default function TimerOverlayPage() {
  const bridge = React.useMemo(() => getDesktopTimerBridge(), [])
  const [snapshot, setSnapshot] = React.useState<UnifiedTimerSnapshot>(() => createIdleSnapshot())
  const [collapsed, setCollapsed] = React.useState(false)
  const [customBreakMinutes, setCustomBreakMinutes] = React.useState('')
  const expiredNotifiedRef = React.useRef(false)
  const feedbackEventIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!bridge?.onTimerSnapshot) return
    return bridge.onTimerSnapshot((nextSnapshot) => {
      setSnapshot(nextSnapshot)
    })
  }, [bridge])

  React.useEffect(() => {
    const breakExpired = snapshot.mode === 'break' && snapshot.status === 'expired'
    if (!breakExpired) {
      expiredNotifiedRef.current = false
      return
    }

    if (expiredNotifiedRef.current) return
    expiredNotifiedRef.current = true
    notifyBreakExpired()
    const settings = readReviewFeedbackSettings()
    if (settings.soundEnabled && settings.mode === 'immersive') playTimerBeep('break')
  }, [snapshot.mode, snapshot.status])

  React.useEffect(() => {
    const signal = snapshot.feedbackSignal
    if (!signal || feedbackEventIdRef.current === signal.eventId) return
    feedbackEventIdRef.current = signal.eventId
    const settings = readReviewFeedbackSettings()
    if (settings.soundEnabled && settings.mode === 'immersive') playTimerBeep(signal.kind)
  }, [snapshot.feedbackSignal])

  const sendCommand = React.useCallback((command: UnifiedTimerCommand) => {
    bridge?.sendTimerCommand?.(command)
  }, [bridge])

  const submitCustomBreakMinutes = React.useCallback(() => {
    const minutes = Math.round(Number(customBreakMinutes))
    if (!Number.isFinite(minutes) || minutes < 1) return
    sendCommand({ type: 'startBreak', minutes })
    setCustomBreakMinutes('')
  }, [customBreakMinutes, sendCommand])

  const setOverlayCollapsed = React.useCallback((nextCollapsed: boolean) => {
    setCollapsed(nextCollapsed)
    bridge?.sendTimerCommand?.({ type: 'collapse', collapsed: nextCollapsed })
    bridge?.setOverlayCollapsed?.(nextCollapsed)
  }, [bridge])

  const studyPhase = snapshot.studyPhase ?? (
    snapshot.status === 'running'
      ? 'focusing'
      : snapshot.status === 'paused'
        ? 'paused'
        : snapshot.status === 'completed'
          ? 'completed'
          : 'idle'
  )
  const effectiveSeconds = Math.max(0, snapshot.effectiveSeconds ?? snapshot.displaySeconds ?? 0)
  const roundElapsedSeconds = Math.max(0, snapshot.roundElapsedSeconds ?? 0)
  const roundTargetSeconds = Math.max(0, snapshot.roundTargetSeconds ?? 0)
  const roundProgress = roundTargetSeconds > 0
    ? Math.min(1, roundElapsedSeconds / roundTargetSeconds)
    : 0
  const studyStatusText =
    studyPhase === 'idle_warning'
      ? `仍在学习吗？${snapshot.idleWarningRemainingSeconds != null ? ` ${Math.max(0, snapshot.idleWarningRemainingSeconds)} 秒后暂停` : ''}`
      : studyPhase === 'goal_reached'
        ? `第 ${Math.max(1, snapshot.roundIndex ?? 1)} 轮目标完成`
        : studyPhase === 'paused'
          ? '已暂停'
          : studyPhase === 'completed'
            ? '已完成'
            : studyPhase === 'focusing'
              ? '正在计时'
              : snapshot.primaryText
  const roundSummaryText = roundTargetSeconds > 0
    ? `本轮 ${formatOverlayClock(roundElapsedSeconds)}/${formatOverlayClock(roundTargetSeconds)}`
    : snapshot.secondaryText
  const modeLabel =
    snapshot.mode === 'break'
      ? snapshot.status === 'expired'
        ? '休息到点'
        : snapshot.status === 'prompting'
          ? '休息询问'
          : '休息中'
      : studyPhase === 'idle_warning'
        ? '专注提醒'
        : studyPhase === 'goal_reached'
          ? '目标达成'
          : studyPhase === 'paused'
            ? '学习已暂停'
            : '学习计时'
  const clock = snapshot.mode === 'break'
    ? formatOverlayClock(snapshot.displaySeconds)
    : formatOverlayClock(effectiveSeconds)
  const capsuleText =
    snapshot.mode === 'break'
      ? snapshot.status === 'expired'
        ? '休息到点'
        : `休息 ${clock}`
      : studyPhase === 'idle'
        ? '学习 待开始'
        : `学习${studyPhase === 'idle_warning' ? ' · 提醒' : studyPhase === 'goal_reached' ? ' · 达标' : studyPhase === 'paused' ? ' · 已暂停' : ''} ${clock}`

  const renderActions = () => {
    if (snapshot.mode === 'break' && snapshot.status === 'prompting') {
      return (
        <>
          {snapshot.presetMinutes.slice(0, 2).map((minutes, i) => (
            <Button
              key={minutes}
              type="button"
              variant={i === 0 ? 'default' : 'outline'}
              size="sm"
              onClick={() => sendCommand({ type: 'startBreak', minutes })}
            >
              {minutes} 分钟
            </Button>
          ))}
          {snapshot.allowCustomMinutes !== false ? (
            <div className="memory-anki-timer-overlay-custom-break">
              <Input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                className="memory-anki-timer-overlay-minutes-input"
                value={customBreakMinutes}
                onChange={(event) => setCustomBreakMinutes(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  submitCustomBreakMinutes()
                }}
                placeholder="分钟"
                aria-label="自定义休息分钟"
              />
              <Button type="button" variant="outline" size="sm" onClick={submitCustomBreakMinutes}>
                自定
              </Button>
            </div>
          ) : null}
        </>
      )
    }

    if (snapshot.mode === 'break' && snapshot.status === 'expired') {
      const firstSnooze = snapshot.snoozeMinutes[0] ?? 1
      return (
        <>
          <Button type="button" variant="outline" size="sm" onClick={() => sendCommand({ type: 'snooze', minutes: firstSnooze })}>
            延后 {firstSnooze} 分钟
          </Button>
          <Button type="button" size="sm" onClick={() => sendCommand({ type: 'startStudy' })}>
            <Play className="size-4" />
            开始学习
          </Button>
        </>
      )
    }

    if (snapshot.mode === 'break') {
      return (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => sendCommand({ type: snapshot.status === 'paused' ? 'resume' : 'pause' })}
          >
            {snapshot.status === 'paused' ? <Play className="size-4" /> : <Pause className="size-4" />}
            {snapshot.status === 'paused' ? '继续' : '暂停'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => sendCommand({ type: 'finishBreak' })}>
            结束
          </Button>
          <Button type="button" size="sm" onClick={() => sendCommand({ type: 'finishBreak', openTarget: true })}>
            回学习
          </Button>
        </>
      )
    }

    if (studyPhase === 'goal_reached') {
      const suggestedBreakMinutes = Math.max(1, snapshot.suggestedBreakMinutes ?? 5)
      return (
        <>
          <Button type="button" variant="outline" size="sm" onClick={() => sendCommand({ type: 'continueRound' })}>
            继续学习
          </Button>
          <Button type="button" size="sm" onClick={() => sendCommand({ type: 'startGoalBreak', minutes: suggestedBreakMinutes })}>
            休息 {suggestedBreakMinutes} 分钟
          </Button>
        </>
      )
    }

    if (snapshot.availableActions.includes('pause')) {
      return (
        <Button type="button" size="sm" className="memory-anki-timer-overlay-action-single" onClick={() => sendCommand({ type: 'pause' })}>
          <Pause className="size-4" />
          暂停
        </Button>
      )
    }

    if (snapshot.availableActions.includes('resume') || studyPhase === 'paused' || studyPhase === 'idle') {
      return (
        <Button
          type="button"
          size="sm"
          className="memory-anki-timer-overlay-action-single"
          disabled={!snapshot.availableActions.includes('resume')}
          onClick={() => sendCommand({ type: 'resume' })}
        >
          <Play className="size-4" />
          {studyPhase === 'paused' ? '继续' : '等待学习页'}
        </Button>
      )
    }

    return null
  }

  const dotClass = cn(
    'memory-anki-timer-overlay-dot',
    snapshot.mode === 'break' && snapshot.status === 'expired'
      ? 'memory-anki-timer-overlay-dot-expired'
      : snapshot.mode === 'break'
        ? 'memory-anki-timer-overlay-dot-break'
        : studyPhase === 'idle_warning'
          ? 'memory-anki-timer-overlay-dot-warning'
          : studyPhase === 'goal_reached'
            ? 'memory-anki-timer-overlay-dot-goal'
            : studyPhase === 'focusing'
              ? 'memory-anki-timer-overlay-dot-running'
              : undefined,
  )

  if (collapsed) {
    return (
      <div
        className={cn(
          'memory-anki-timer-overlay-capsule',
          snapshot.mode === 'break' && snapshot.status === 'expired' && 'memory-anki-timer-overlay-capsule-expired',
          snapshot.mode === 'study' && studyPhase === 'idle_warning' && 'memory-anki-timer-overlay-capsule-warning',
          snapshot.mode === 'study' && studyPhase === 'goal_reached' && 'memory-anki-timer-overlay-capsule-goal',
        )}
        title="拖动计时器"
      >
        <span className={dotClass} />
        <span className="memory-anki-timer-overlay-capsule-label">{capsuleText}</span>
        <button
          type="button"
          className="memory-anki-timer-overlay-capsule-expand"
          onClick={() => setOverlayCollapsed(false)}
          title="展开计时器"
          aria-label="展开计时器"
        >
          <ChevronsUp className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <main
      className={cn(
        'memory-anki-timer-overlay-shell',
        snapshot.mode === 'break' && 'memory-anki-timer-overlay-shell-break',
        snapshot.mode === 'break' && snapshot.status === 'expired' && 'memory-anki-timer-overlay-shell-expired',
        snapshot.mode === 'study' && studyPhase === 'idle_warning' && 'memory-anki-timer-overlay-shell-warning',
        snapshot.mode === 'study' && studyPhase === 'goal_reached' && 'memory-anki-timer-overlay-shell-goal',
      )}
    >
      <div className="memory-anki-timer-overlay-header">
        <div className="min-w-0">
          <div className="memory-anki-timer-overlay-kicker">{modeLabel}</div>
          <div className="memory-anki-timer-overlay-title" title={snapshot.title}>
            {snapshot.title}
          </div>
        </div>
        <button
          type="button"
          className="memory-anki-timer-overlay-icon-button"
          onClick={() => setOverlayCollapsed(true)}
          title="折叠为胶囊"
        >
          <ChevronsDown className="size-4" />
        </button>
      </div>

      <div className="memory-anki-timer-overlay-digits">{clock}</div>

      <div className="memory-anki-timer-overlay-copy">
        {snapshot.mode === 'break' ? snapshot.primaryText : studyStatusText}
        <span>{snapshot.mode === 'break' ? snapshot.secondaryText : roundSummaryText}</span>
      </div>

      {snapshot.mode === 'study' && roundTargetSeconds > 0 ? (
        <div
          className="memory-anki-timer-round-progress memory-anki-timer-overlay-round-progress"
          role="progressbar"
          aria-label="本轮专注进度"
          aria-valuemin={0}
          aria-valuemax={roundTargetSeconds}
          aria-valuenow={Math.min(roundElapsedSeconds, roundTargetSeconds)}
        >
          <span style={{ width: `${roundProgress * 100}%` }} />
        </div>
      ) : null}

      <div className="memory-anki-timer-overlay-actions">{renderActions()}</div>
    </main>
  )
}
