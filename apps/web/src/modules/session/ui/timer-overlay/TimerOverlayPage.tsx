import * as React from 'react'
import { ChevronsDown, ChevronsUp, Pause, Play, Settings2, X } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import {
  getDesktopTimerBridge,
  type UnifiedTimerCommand,
  type UnifiedTimerSnapshot,
} from '@/shared/components/session/desktopTimerBridge'
import { cn } from '@/shared/lib/utils'

function formatClock(seconds: number | null) {
  if (seconds == null) return '--:--'
  const safe = Math.max(0, Math.round(seconds))
  return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${(safe % 60)
    .toString()
    .padStart(2, '0')}`
}

function idleSnapshot(): UnifiedTimerSnapshot {
  return {
    mode: 'study',
    status: 'idle',
    title: '待开始',
    scene: '学习计时',
    displaySeconds: null,
    primaryText: '当前无学习会话',
    secondaryText: '进入学习页面后手动开始',
    availableActions: [],
    targetPath: '/freestyle',
    updatedAt: Date.now(),
    effectiveSeconds: 0,
    studyPhase: 'idle',
    semanticState: 'idle',
    progressMode: 'empty',
    progressValue: 0,
  }
}

export default function TimerOverlayPage() {
  const bridge = React.useMemo(() => getDesktopTimerBridge(), [])
  const [snapshot, setSnapshot] = React.useState<UnifiedTimerSnapshot>(idleSnapshot)
  const [collapsed, setCollapsed] = React.useState(false)

  React.useEffect(() => {
    if (!bridge?.onTimerSnapshot) return
    return bridge.onTimerSnapshot(setSnapshot)
  }, [bridge])

  const send = React.useCallback(
    (command: UnifiedTimerCommand) => bridge?.sendTimerCommand?.(command),
    [bridge],
  )

  const setCollapsedAndNotify = React.useCallback(
    (next: boolean) => {
      setCollapsed(next)
      send({ type: 'collapse', collapsed: next })
      bridge?.setOverlayCollapsed?.(next)
    },
    [bridge, send],
  )

  const seconds = Math.max(0, snapshot.effectiveSeconds ?? snapshot.displaySeconds ?? 0)
  const status = snapshot.status
  const action = status === 'running' ? 'pause' : status === 'idle' ? 'start' : status === 'paused' ? 'resume' : null
  const actionLabel = status === 'running' ? '暂停' : status === 'idle' ? '开始' : status === 'paused' ? '继续' : '已完成'

  if (collapsed) {
    return (
      <div className="memory-anki-timer-overlay-capsule" data-timer-overlay-root="true">
        <span className={cn('memory-anki-timer-overlay-dot', `memory-anki-timer-overlay-dot-${status}`)} />
        <span className="memory-anki-timer-overlay-capsule-label">{snapshot.title} {formatClock(seconds)}</span>
        <button type="button" aria-label="展开计时器" onClick={() => setCollapsedAndNotify(false)}>
          <ChevronsUp className="size-4" />
        </button>
        <button type="button" aria-label="隐藏计时器" onClick={() => send({ type: 'closeOverlay' })}>
          <X className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <main className="memory-anki-timer-overlay-shell" data-timer-overlay-root="true">
      <header className="memory-anki-timer-overlay-header">
        <div className="min-w-0">
          <div className="memory-anki-timer-overlay-kicker">{snapshot.scene}</div>
          <div className="memory-anki-timer-overlay-title" title={snapshot.title}>{snapshot.title}</div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="打开计时器设置" onClick={() => send({ type: 'openTimerSettings' })}><Settings2 className="size-4" /></button>
          <button type="button" aria-label="收起计时器" onClick={() => setCollapsedAndNotify(true)}><ChevronsDown className="size-4" /></button>
          <button type="button" aria-label="隐藏计时器" onClick={() => send({ type: 'closeOverlay' })}><X className="size-4" /></button>
        </div>
      </header>
      <div className="memory-anki-timer-overlay-digits">{formatClock(seconds)}</div>
      <div className="memory-anki-timer-overlay-copy">{snapshot.primaryText}<span>{snapshot.secondaryText}</span></div>
      <div className="memory-anki-timer-overlay-actions">
        {action ? <Button type="button" size="sm" onClick={() => send({ type: action })}>
          {status === 'running' ? <Pause className="size-4" /> : <Play className="size-4" />}
          {actionLabel}
        </Button> : null}
      </div>
    </main>
  )
}
