import * as React from 'react'
import { ChevronsDown, ChevronsUp, Pause, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import {
  getDesktopTimerBridge,
  type UnifiedTimerCommand,
  type UnifiedTimerSnapshot,
} from '@/shared/components/session/desktopTimerBridge'
import { cn } from '@/shared/lib/utils'

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

function playTimerBeep() {
  try {
    const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextConstructor) return
    const context = new AudioContextConstructor()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, context.currentTime)
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.13, context.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.48)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.5)
    window.setTimeout(() => void context.close(), 700)
  } catch {
    // Browsers may block audio before user interaction.
  }
}

function notifyBreakExpired() {
  if (!('Notification' in window)) return
  if (Notification.permission === 'granted') {
    new Notification('休息时间到了', { body: '回到随心模式继续一点点就好。' })
    return
  }
  if (Notification.permission === 'default') {
    void Notification.requestPermission()
  }
}

export default function TimerOverlayPage() {
  const bridge = React.useMemo(() => getDesktopTimerBridge(), [])
  const [snapshot, setSnapshot] = React.useState<UnifiedTimerSnapshot>(() => createIdleSnapshot())
  const [collapsed, setCollapsed] = React.useState(false)
  const [customBreakMinutes, setCustomBreakMinutes] = React.useState('')
  const expiredAlertRef = React.useRef<number | null>(null)
  const expiredNotifiedAtRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (!bridge?.onTimerSnapshot) return
    return bridge.onTimerSnapshot((nextSnapshot) => {
      setSnapshot(nextSnapshot)
    })
  }, [bridge])

  React.useEffect(() => {
    if (snapshot.status !== 'expired') {
      expiredNotifiedAtRef.current = null
      if (expiredAlertRef.current != null) {
        window.clearInterval(expiredAlertRef.current)
        expiredAlertRef.current = null
      }
      return
    }

    if (expiredNotifiedAtRef.current !== snapshot.updatedAt) {
      expiredNotifiedAtRef.current = snapshot.updatedAt
      notifyBreakExpired()
      playTimerBeep()
    }

    if (expiredAlertRef.current == null) {
      expiredAlertRef.current = window.setInterval(playTimerBeep, 2500)
    }

    return () => {
      if (expiredAlertRef.current != null) {
        window.clearInterval(expiredAlertRef.current)
        expiredAlertRef.current = null
      }
    }
  }, [snapshot.status, snapshot.updatedAt])

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

  const modeLabel =
    snapshot.mode === 'break'
      ? snapshot.status === 'expired'
        ? '休息到点'
        : snapshot.status === 'prompting'
          ? '休息询问'
          : '休息中'
      : '学习计时'
  const clock = formatOverlayClock(snapshot.displaySeconds)
  const capsuleText =
    snapshot.mode === 'break'
      ? snapshot.status === 'expired'
        ? '休息到点'
        : `休息 ${clock}`
      : snapshot.displaySeconds == null
        ? '学习 待开始'
        : `学习 ${clock}`

  const renderActions = () => {
    if (snapshot.mode === 'break' && snapshot.status === 'prompting') {
      return (
        <>
          {snapshot.presetMinutes.slice(0, 2).map((minutes) => (
            <Button key={minutes} type="button" size="sm" onClick={() => sendCommand({ type: 'startBreak', minutes })}>
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
            +{firstSnooze}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => sendCommand({ type: 'finishBreak' })}>
            <RotateCcw className="size-4" />
            结束
          </Button>
          <Button type="button" size="sm" onClick={() => sendCommand({ type: 'finishBreak', openTarget: true })}>
            回随心
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

    if (snapshot.status === 'running') {
      return (
        <Button type="button" size="sm" onClick={() => sendCommand({ type: 'pause' })}>
          <Pause className="size-4" />
          暂停
        </Button>
      )
    }

    if (snapshot.status === 'paused' || snapshot.status === 'idle') {
      return (
        <Button type="button" size="sm" disabled={!snapshot.availableActions.includes('resume')} onClick={() => sendCommand({ type: 'resume' })}>
          <Play className="size-4" />
          {snapshot.status === 'paused' ? '继续' : '等待学习页'}
        </Button>
      )
    }

    return null
  }

  if (collapsed) {
    return (
      <div
        className={cn('memory-anki-timer-overlay-capsule', snapshot.status === 'expired' && 'memory-anki-timer-overlay-capsule-expired')}
        title="拖动计时器"
      >
        <span className="memory-anki-timer-overlay-dot" />
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
        snapshot.status === 'expired' && 'memory-anki-timer-overlay-shell-expired',
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
        {snapshot.primaryText}
        <span>{snapshot.secondaryText}</span>
      </div>

      <div className="memory-anki-timer-overlay-actions">{renderActions()}</div>
    </main>
  )
}
