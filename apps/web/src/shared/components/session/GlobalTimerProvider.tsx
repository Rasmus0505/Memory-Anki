import * as React from 'react'
import { createPortal } from 'react-dom'
import { AlarmClock, Pause, Play, Settings2, Shrink, Expand } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'
import { TimerAutomationDialog } from '@/shared/components/session/TimerAutomationDialog'
import {
  appendBreakGuardLog,
  BREAK_GUARD_UPDATED_EVENT,
  readBreakGuardConfig,
  updateBreakGuardLog,
  type BreakGuardConfig,
} from '@/shared/components/session/break-guard-config'
import {
  createBreakGuardCountdown,
  expireBreakGuardIfDue,
  formatBreakGuardClock,
  IDLE_BREAK_GUARD_STATE,
  shouldPromptForBreakGuard,
  snoozeBreakGuard,
  type BreakGuardState,
} from '@/shared/components/session/breakGuardModel'
import {
  getTimerAutomationRule,
  readTimerAutomationConfig,
  resetTimerAutomationConfig,
  saveTimerAutomationConfig,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import {
  getTimerCelebrationConfig,
  getTimerFocusRule,
  readTimerFocusConfig,
  resetTimerFocusConfig,
  saveTimerFocusConfig,
  TIMER_FOCUS_SCENE_LABELS,
  TIMER_FOCUS_UPDATED_EVENT,
  type TimerFocusConfig,
  type TimerFocusScene,
} from '@/shared/components/session/timer-focus-config'
import {
  readTimerOverlayLayout,
  saveTimerOverlayLayout,
  type TimerOverlayLayout,
} from '@/shared/components/session/timer-overlay-layout'
import { emitTimerCelebration } from '@/shared/components/session/timer-celebration'
import type { TimedSessionController } from '@/shared/hooks/useTimedSession'
import { useMindMapFeedbackSettings } from '@/shared/components/mindmap-host/useMindMapFeedback'
import { getReviewFeedbackEffectiveVolume } from '@/shared/feedback/reviewFeedbackSettings'
import {
  calculateResizedTimerOverlayLayout,
  createTimerOverlaySizeTokens,
  formatClock,
  formatIdlePrimaryProgress,
  formatPrimaryProgress,
  resolveFloatingTimerLayout,
  selectActiveTimerEntry,
  TIMER_DRAG_CLICK_THRESHOLD_PX,
  TIMER_RESIZE_HANDLE_STYLES,
  type GlobalTimerRegistration,
  type ResizeHandleDirection,
  type TimerResizeState,
} from '@/shared/components/session/globalTimerModel'

interface GlobalTimerContextValue {
  upsertTimer: (entry: GlobalTimerRegistration) => void
  removeTimer: (sessionId: string) => void
}

const GlobalTimerContext = React.createContext<GlobalTimerContextValue | null>(null)

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(mediaQuery.matches)
    sync()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', sync)
      return () => mediaQuery.removeEventListener('change', sync)
    }
    mediaQuery.addListener(sync)
    return () => mediaQuery.removeListener(sync)
  }, [])

  return reducedMotion
}

function createBreakLogId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `break-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function openBreakGuardTarget(path: string) {
  const targetPath = path.startsWith('/') ? path : '/freestyle'
  if (typeof window === 'undefined') return
  if (window.location.pathname !== targetPath) {
    window.location.assign(targetPath)
    return
  }
  window.focus()
}

function playBreakGuardBeep() {
  try {
    const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextConstructor) return
    const context = new AudioContextConstructor()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, context.currentTime)
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.45)
    window.setTimeout(() => void context.close(), 650)
  } catch {
    // Browser audio may be blocked until a user gesture.
  }
}

function GlobalBreakGuardOverlay({
  activeEntry,
}: {
  activeEntry: GlobalTimerRegistration | null
}) {
  const [config, setConfig] = React.useState<BreakGuardConfig>(() => readBreakGuardConfig())
  const [state, setState] = React.useState<BreakGuardState>(IDLE_BREAK_GUARD_STATE)
  const [remainingMs, setRemainingMs] = React.useState(0)
  const [customMinutes, setCustomMinutes] = React.useState('15')
  const promptTimerRef = React.useRef<number | null>(null)
  const alertTimerRef = React.useRef<number | null>(null)
  const notificationShownRef = React.useRef(false)

  React.useEffect(() => {
    const handleConfigChange = (event: Event) => {
      const nextConfig =
        event instanceof CustomEvent && event.detail
          ? (event.detail as BreakGuardConfig)
          : readBreakGuardConfig()
      setConfig(nextConfig)
    }
    window.addEventListener(BREAK_GUARD_UPDATED_EVENT, handleConfigChange)
    return () => window.removeEventListener(BREAK_GUARD_UPDATED_EVENT, handleConfigChange)
  }, [])

  React.useEffect(() => {
    const clearPromptTimer = () => {
      if (promptTimerRef.current != null) {
        window.clearTimeout(promptTimerRef.current)
        promptTimerRef.current = null
      }
    }

    const handleLeave = () => {
      clearPromptTimer()
      if (!shouldPromptForBreakGuard(config, state)) return
      promptTimerRef.current = window.setTimeout(() => {
        setState((current) => (shouldPromptForBreakGuard(config, current) ? { ...current, status: 'prompting' } : current))
      }, config.promptDelaySeconds * 1000)
    }

    const handleReturn = () => {
      clearPromptTimer()
      setState((current) => (current.status === 'prompting' || current.status === 'dismissed' ? IDLE_BREAK_GUARD_STATE : current))
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        handleLeave()
        return
      }
      handleReturn()
    }

    window.addEventListener('blur', handleLeave)
    window.addEventListener('focus', handleReturn)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      clearPromptTimer()
      window.removeEventListener('blur', handleLeave)
      window.removeEventListener('focus', handleReturn)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [config, state])

  React.useEffect(() => {
    if (state.status !== 'counting_down' || state.expiresAt == null) return
    const tick = () => {
      const now = Date.now()
      setRemainingMs(Math.max(0, state.expiresAt == null ? 0 : state.expiresAt - now))
      setState((current) => expireBreakGuardIfDue(current, now))
    }
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [state.expiresAt, state.status])

  React.useEffect(() => {
    if (state.status !== 'expired') {
      notificationShownRef.current = false
      if (alertTimerRef.current != null) {
        window.clearInterval(alertTimerRef.current)
        alertTimerRef.current = null
      }
      return
    }

    if (!notificationShownRef.current) {
      notificationShownRef.current = true
      playBreakGuardBeep()
      if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification('休息时间到了', { body: '回到随心模式继续一点点就好。' })
        } else if (Notification.permission === 'default') {
          void Notification.requestPermission()
        }
      }
      if (config.alertStrength === 'strong') {
        openBreakGuardTarget(config.targetPath)
      }
    }

    if (config.alertStrength === 'strong' && alertTimerRef.current == null) {
      alertTimerRef.current = window.setInterval(playBreakGuardBeep, 2500)
    }

    return () => {
      if (alertTimerRef.current != null) {
        window.clearInterval(alertTimerRef.current)
        alertTimerRef.current = null
      }
    }
  }, [config.alertStrength, config.targetPath, state.status])

  const startBreak = React.useCallback((minutes: number) => {
    const safeMinutes = Math.max(1, Math.round(minutes))
    activeEntry?.timer.pause({ source: 'break_guard' })
    const logId = config.recordBreakLogs ? createBreakLogId() : null
    if (logId) {
      appendBreakGuardLog({
        id: logId,
        startedAt: new Date().toISOString(),
        plannedMinutes: safeMinutes,
        endedAt: null,
        overtime: false,
        snoozeCount: 0,
      })
    }
    setState(createBreakGuardCountdown(safeMinutes, Date.now(), logId))
  }, [activeEntry, config.recordBreakLogs])

  const finishBreak = React.useCallback((options?: { openTarget?: boolean }) => {
    if (state.logId) {
      updateBreakGuardLog(state.logId, {
        endedAt: new Date().toISOString(),
        overtime: state.status === 'expired',
        snoozeCount: state.snoozeCount,
      })
    }
    setState(IDLE_BREAK_GUARD_STATE)
    if (options?.openTarget) {
      openBreakGuardTarget(config.targetPath)
    }
  }, [config.targetPath, state.logId, state.snoozeCount, state.status])

  const snooze = React.useCallback((minutes: number) => {
    const nextState = snoozeBreakGuard(state, minutes)
    if (nextState.logId) {
      updateBreakGuardLog(nextState.logId, { snoozeCount: nextState.snoozeCount })
    }
    setState(nextState)
  }, [state])

  if (!config.enabled || state.status === 'idle' || state.status === 'dismissed') {
    return null
  }

  const customMinutesNumber = Math.max(1, Math.round(Number(customMinutes) || 0))

  return (
    <div className={cn('memory-anki-break-guard-layer', state.status === 'expired' && 'memory-anki-break-guard-layer-expired')}>
      <div className={cn('memory-anki-break-guard-card', state.status === 'expired' && 'memory-anki-break-guard-card-expired')}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="memory-anki-break-guard-kicker">
              {state.status === 'prompting' ? '离开了一会儿' : state.status === 'counting_down' ? '休息倒计时' : '休息时间到了'}
            </div>
            <div className="memory-anki-break-guard-title">
              {state.status === 'prompting'
                ? '要给这次休息定个边界吗？'
                : state.status === 'counting_down'
                  ? formatBreakGuardClock(remainingMs)
                  : '回到随心模式'}
            </div>
          </div>
          <AlarmClock className="h-5 w-5 shrink-0 text-primary" />
        </div>

        {state.status === 'prompting' ? (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {config.presetMinutes.map((minutes) => (
                <Button key={minutes} type="button" size="sm" onClick={() => startBreak(minutes)}>
                  {minutes} 分钟
                </Button>
              ))}
            </div>
            {config.allowCustomMinutes ? (
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  max="240"
                  value={customMinutes}
                  onChange={(event) => setCustomMinutes(event.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                  aria-label="自定义休息分钟数"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => startBreak(customMinutesNumber)}>
                  自定义
                </Button>
              </div>
            ) : null}
            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setState({ ...IDLE_BREAK_GUARD_STATE, status: 'dismissed' })}>
              这次不提醒
            </Button>
          </div>
        ) : state.status === 'counting_down' ? (
          <div className="mt-4 space-y-3">
            <div className="memory-anki-break-guard-copy">
              已暂停学习计时。到点后会提醒你回到随心模式。
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => finishBreak()}>
                结束休息
              </Button>
              <Button type="button" size="sm" className="flex-1" onClick={() => finishBreak({ openTarget: true })}>
                回去学习
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="memory-anki-break-guard-copy">
              延后 {state.snoozeCount} 次。现在回去，只要做一道也算赢。
            </div>
            <div className="grid grid-cols-3 gap-2">
              {config.snoozeMinutes.map((minutes) => (
                <Button key={minutes} type="button" variant="outline" size="sm" onClick={() => snooze(minutes)}>
                  +{minutes} 分钟
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => finishBreak()}>
                结束
              </Button>
              <Button type="button" size="sm" className="flex-1" onClick={() => finishBreak({ openTarget: true })}>
                回到随心模式
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function GlobalTimerFloatingOverlay({
  entries,
}: {
  entries: GlobalTimerRegistration[]
}) {
  const [layout, setLayout] = React.useState<TimerOverlayLayout>(() =>
    resolveFloatingTimerLayout(readTimerOverlayLayout()),
  )
  const [automationOpen, setAutomationOpen] = React.useState(false)
  const [automationConfig, setAutomationConfig] = React.useState<TimerAutomationConfig>(() =>
    readTimerAutomationConfig(),
  )
  const [focusConfig, setFocusConfig] = React.useState<TimerFocusConfig>(() =>
    readTimerFocusConfig(),
  )
  const [pulseKind, setPulseKind] = React.useState<'secondary' | 'primary' | null>(null)
  const [pulseNonce, setPulseNonce] = React.useState(0)
  const reducedMotion = usePrefersReducedMotion()
  const feedbackSettings = useMindMapFeedbackSettings()
  const effectiveFeedbackVolume = getReviewFeedbackEffectiveVolume(feedbackSettings)
  const activeEntry = React.useMemo(() => selectActiveTimerEntry(entries), [entries])
  const scene = activeEntry?.scene ?? null
  const [isNarrowViewport, setIsNarrowViewport] = React.useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false,
  )
  const [freestyleMobileTimerExpanded, setFreestyleMobileTimerExpanded] = React.useState(false)
  const dragStateRef = React.useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const resizeStateRef = React.useRef<TimerResizeState | null>(null)
  const suppressCapsuleClickRef = React.useRef(false)
  const completionStateRef = React.useRef<Record<string, { secondaryCount: number; primaryDone: boolean }>>({})

  const persistLayout = React.useCallback((nextLayout: TimerOverlayLayout | ((current: TimerOverlayLayout) => TimerOverlayLayout)) => {
    setLayout((current) => {
      const resolved = typeof nextLayout === 'function' ? nextLayout(current) : nextLayout
      const normalized = resolveFloatingTimerLayout(resolved)
      saveTimerOverlayLayout(normalized)
      return normalized
    })
  }, [])

  React.useEffect(() => {
    const handleResize = () => {
      setIsNarrowViewport(window.innerWidth < 640)
      persistLayout((current) => current)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [persistLayout])

  const useFreestyleMobileCompactTimer = scene === 'freestyle' && isNarrowViewport

  React.useEffect(() => {
    if (!useFreestyleMobileCompactTimer) {
      setFreestyleMobileTimerExpanded(false)
    }
  }, [useFreestyleMobileCompactTimer])

  React.useEffect(() => {
    setFreestyleMobileTimerExpanded(false)
  }, [activeEntry?.sessionId])

  React.useEffect(() => {
    const handleAutomationChange = (event: Event) => {
      const nextConfig =
        event instanceof CustomEvent && event.detail
          ? (event.detail as TimerAutomationConfig)
          : readTimerAutomationConfig()
      setAutomationConfig(nextConfig)
    }
    const handleFocusChange = (event: Event) => {
      const nextConfig =
        event instanceof CustomEvent && event.detail
          ? (event.detail as TimerFocusConfig)
          : readTimerFocusConfig()
      setFocusConfig(nextConfig)
    }

    window.addEventListener('memory-anki-timer-automation-change', handleAutomationChange)
    window.addEventListener(TIMER_FOCUS_UPDATED_EVENT, handleFocusChange)
    return () => {
      window.removeEventListener('memory-anki-timer-automation-change', handleAutomationChange)
      window.removeEventListener(TIMER_FOCUS_UPDATED_EVENT, handleFocusChange)
    }
  }, [])

  React.useEffect(() => {
    if (pulseKind == null) return
    const timer = window.setTimeout(() => setPulseKind(null), pulseKind === 'primary' ? 540 : 360)
    return () => window.clearTimeout(timer)
  }, [pulseKind, pulseNonce])

  React.useEffect(() => {
    if (!activeEntry) return
    const previous = completionStateRef.current[activeEntry.sessionId]
    const focusRule = getTimerFocusRule(activeEntry.scene, focusConfig)
    const primarySeconds = Math.max(60, focusRule.primaryMinutes * 60)
    const secondarySeconds = Math.max(60, Math.min(primarySeconds, focusRule.secondaryMinutes * 60))
    const secondaryCount = Math.floor(activeEntry.timer.effectiveSeconds / secondarySeconds)
    const primaryDone = activeEntry.timer.effectiveSeconds >= primarySeconds

    if (!previous || secondaryCount < previous.secondaryCount || activeEntry.timer.effectiveSeconds === 0) {
      completionStateRef.current[activeEntry.sessionId] = {
        secondaryCount,
        primaryDone,
      }
      return
    }

    if (secondaryCount > previous.secondaryCount) {
      const eventConfig = getTimerCelebrationConfig('secondary', focusConfig)
      emitTimerCelebration({
        completionCount: secondaryCount,
        kind: 'secondary',
        reducedMotion,
        soundEnabled: feedbackSettings.soundEnabled && feedbackSettings.mode === 'immersive',
        volume: effectiveFeedbackVolume,
        feedbackIntensity: focusConfig.feedbackIntensity,
        eventConfig,
      })
      setPulseKind('secondary')
      setPulseNonce((current) => current + 1)
    }

    if (primaryDone && !previous.primaryDone) {
      const eventConfig = getTimerCelebrationConfig('primary', focusConfig)
      emitTimerCelebration({
        completionCount: secondaryCount,
        kind: 'primary',
        reducedMotion,
        soundEnabled: feedbackSettings.soundEnabled && feedbackSettings.mode === 'immersive',
        volume: effectiveFeedbackVolume,
        feedbackIntensity: focusConfig.feedbackIntensity,
        eventConfig,
      })
      setPulseKind('primary')
      setPulseNonce((current) => current + 1)
    }

    completionStateRef.current[activeEntry.sessionId] = {
      secondaryCount,
      primaryDone,
    }
  }, [activeEntry, effectiveFeedbackVolume, feedbackSettings.mode, feedbackSettings.soundEnabled, focusConfig, reducedMotion])

  const beginDrag = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    const target = event.target
    if (
      target instanceof Element &&
      target.closest('[data-timer-overlay-control="true"]')
    ) {
      return
    }
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: layout.x,
      originY: layout.y,
    }
    suppressCapsuleClickRef.current = false
    if ('setPointerCapture' in event.currentTarget) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }, [layout.x, layout.y])

  const beginResize = React.useCallback((direction: ResizeHandleDirection, event: React.PointerEvent<HTMLButtonElement>) => {
    resizeStateRef.current = {
      direction,
      startX: event.clientX,
      startY: event.clientY,
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
    }
    if ('setPointerCapture' in event.currentTarget) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    event.stopPropagation()
  }, [layout.height, layout.width, layout.x, layout.y])

  const handlePointerMove = React.useCallback((clientX: number, clientY: number) => {
    if (dragStateRef.current) {
      const deltaX = clientX - dragStateRef.current.startX
      const deltaY = clientY - dragStateRef.current.startY
      const dragState = dragStateRef.current
      if (Math.abs(deltaX) > TIMER_DRAG_CLICK_THRESHOLD_PX || Math.abs(deltaY) > TIMER_DRAG_CLICK_THRESHOLD_PX) {
        suppressCapsuleClickRef.current = true
      }
      persistLayout((current) => ({
        ...current,
        x: (dragState?.originX ?? current.x) + deltaX,
        y: (dragState?.originY ?? current.y) + deltaY,
      }))
    }

    if (resizeStateRef.current) {
      const nextLayout = calculateResizedTimerOverlayLayout(
        resizeStateRef.current,
        clientX,
        clientY,
        window.innerWidth,
        window.innerHeight,
      )

      persistLayout((current) => ({
        ...current,
        ...nextLayout,
      }))
    }
  }, [persistLayout])

  const handlePointerMoveEvent = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    handlePointerMove(event.clientX, event.clientY)
  }, [handlePointerMove])

  const stopPointerInteraction = React.useCallback(() => {
    dragStateRef.current = null
    resizeStateRef.current = null
  }, [])

  React.useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent) => {
      handlePointerMove(event.clientX, event.clientY)
    }
    const handleWindowPointerUp = () => {
      stopPointerInteraction()
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
    window.addEventListener('pointercancel', handleWindowPointerUp)
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handleWindowPointerUp)
      window.removeEventListener('pointercancel', handleWindowPointerUp)
    }
  }, [handlePointerMove, stopPointerInteraction])

  const toggleCollapsed = React.useCallback(() => {
    persistLayout((current) => ({
      ...current,
      collapsed: !current.collapsed,
    }))
  }, [persistLayout])

  const sceneLabel = scene ? TIMER_FOCUS_SCENE_LABELS[scene] : '计时器'
  const title = activeEntry?.title ?? '待开始'
  const focusRule = scene ? getTimerFocusRule(scene, focusConfig) : focusConfig.global
  const automationRule = scene ? getTimerAutomationRule(scene, automationConfig) : null
  const primarySeconds = Math.max(60, focusRule.primaryMinutes * 60)
  const secondarySeconds = Math.max(60, Math.min(primarySeconds, focusRule.secondaryMinutes * 60))
  const effectiveSeconds = activeEntry?.timer.effectiveSeconds ?? 0
  const secondaryCount = secondarySeconds > 0 ? Math.floor(effectiveSeconds / secondarySeconds) : 0
  const secondaryRemainder = secondarySeconds > 0 ? effectiveSeconds % secondarySeconds : 0
  const secondaryRemaining =
    secondarySeconds > 0
      ? secondaryRemainder === 0
        ? secondarySeconds
        : secondarySeconds - secondaryRemainder
      : 0
  const idleSecondarySeconds = secondarySeconds
  const idleText = automationRule
    ? `闲置 ${activeEntry?.timer.idleSeconds ?? 0}/${automationRule.inactiveAutoPauseSeconds} 秒`
    : '当前无学习会话'
  const primarySummaryText = activeEntry
    ? formatPrimaryProgress(effectiveSeconds, primarySeconds)
    : formatIdlePrimaryProgress(primarySeconds)
  const showFullPanel =
    !layout.collapsed && !(useFreestyleMobileCompactTimer && !freestyleMobileTimerExpanded)
  const primaryAction =
    activeEntry == null
      ? null
      : activeEntry.timer.status === 'running'
      ? {
          label: '暂停',
          icon: Pause,
          onClick: () => activeEntry.timer.pause({ source: 'global_floating_timer' }),
        }
      : {
          label: activeEntry?.timer.status === 'paused' ? '继续' : '开始',
          icon: Play,
          onClick: () =>
            (activeEntry?.timer.status === 'paused'
              ? activeEntry.timer.resume({ source: 'global_floating_timer' })
              : activeEntry?.timer.start({ source: 'global_floating_timer' })),
        }
  const PrimaryActionIcon = primaryAction?.icon ?? Play
  const sizeTokens = React.useMemo(
    () => createTimerOverlaySizeTokens(layout),
    [layout.height, layout.width],
  )

  const overlay = (
    <>
      {pulseKind ? (
        <div
          key={`${pulseKind}-${pulseNonce}`}
          className={cn(
            'memory-anki-timer-screen-pulse',
            pulseKind === 'primary'
              ? 'memory-anki-timer-screen-pulse-primary'
              : 'memory-anki-timer-screen-pulse-secondary',
          )}
          aria-hidden="true"
        />
      ) : null}
      <div
        className="memory-anki-global-timer-layer"
        style={{ left: layout.x, top: layout.y }}
        onPointerMove={handlePointerMoveEvent}
        onPointerUp={stopPointerInteraction}
        onPointerCancel={stopPointerInteraction}
      >
        {showFullPanel ? (
          <div
            className={cn(
              'memory-anki-global-timer-panel',
              pulseKind === 'primary' && 'memory-anki-global-timer-panel-primary',
              pulseKind === 'secondary' && 'memory-anki-global-timer-panel-secondary',
            )}
            style={{ width: layout.width, height: layout.height, ...sizeTokens.panelStyle }}
          >
            <div className="memory-anki-global-timer-dragbar" onPointerDown={beginDrag}>
              <div className="min-w-0">
                <div className="memory-anki-global-timer-scene">{sceneLabel}</div>
                <div className="memory-anki-global-timer-title" title={title}>
                  {title}
                </div>
              </div>
              <div className="flex items-center gap-1.5" data-timer-overlay-control="true">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="memory-anki-global-timer-icon-button"
                  style={sizeTokens.iconButtonStyle}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setAutomationOpen(true)}
                  title="打开计时器设置"
                >
                  <Settings2 className="memory-anki-global-timer-icon" style={sizeTokens.iconStyle} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="memory-anki-global-timer-icon-button"
                  style={sizeTokens.iconButtonStyle}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={toggleCollapsed}
                  title="折叠为胶囊"
                >
                  <Shrink className="memory-anki-global-timer-icon" style={sizeTokens.iconStyle} />
                </Button>
              </div>
            </div>

            <div className="memory-anki-global-timer-body">
              <div className="memory-anki-global-timer-digits">
                {formatClock(activeEntry ? secondaryRemaining : idleSecondarySeconds)}
              </div>
              <div className="memory-anki-global-timer-row">{idleText}</div>
              <div className="memory-anki-global-timer-row memory-anki-global-timer-row-primary">
                {primarySummaryText}
              </div>
              <div className="memory-anki-global-timer-body-spacer" aria-hidden="true" />
              <div className="memory-anki-global-timer-actions">
                {activeEntry && primaryAction ? (
                  <Button
                    type="button"
                    size="sm"
                    className="memory-anki-global-timer-action-button flex-1"
                    style={sizeTokens.actionButtonStyle}
                    onClick={primaryAction.onClick}
                  >
                    <PrimaryActionIcon className="memory-anki-global-timer-icon mr-2" style={sizeTokens.iconStyle} />
                    {primaryAction.label}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    className="memory-anki-global-timer-action-button flex-1"
                    style={sizeTokens.actionButtonStyle}
                    disabled
                  >
                    <Play className="memory-anki-global-timer-icon mr-2" style={sizeTokens.iconStyle} />
                    进入学习页后开始
                  </Button>
                )}
              </div>
            </div>

            <button type="button" aria-label="从上边调整计时器大小" className="memory-anki-global-timer-resize memory-anki-global-timer-resize-n" style={TIMER_RESIZE_HANDLE_STYLES.n} onPointerDown={(event) => beginResize('n', event)} />
            <button type="button" aria-label="从右边调整计时器大小" className="memory-anki-global-timer-resize memory-anki-global-timer-resize-e" style={TIMER_RESIZE_HANDLE_STYLES.e} onPointerDown={(event) => beginResize('e', event)} />
            <button type="button" aria-label="从下边调整计时器大小" className="memory-anki-global-timer-resize memory-anki-global-timer-resize-s" style={TIMER_RESIZE_HANDLE_STYLES.s} onPointerDown={(event) => beginResize('s', event)} />
            <button type="button" aria-label="从左边调整计时器大小" className="memory-anki-global-timer-resize memory-anki-global-timer-resize-w" style={TIMER_RESIZE_HANDLE_STYLES.w} onPointerDown={(event) => beginResize('w', event)} />
            <button type="button" aria-label="从左上角调整计时器大小" className="memory-anki-global-timer-resize memory-anki-global-timer-resize-nw" style={TIMER_RESIZE_HANDLE_STYLES.nw} onPointerDown={(event) => beginResize('nw', event)} />
            <button type="button" aria-label="从右上角调整计时器大小" className="memory-anki-global-timer-resize memory-anki-global-timer-resize-ne" style={TIMER_RESIZE_HANDLE_STYLES.ne} onPointerDown={(event) => beginResize('ne', event)} />
            <button type="button" aria-label="从右下角调整计时器大小" className="memory-anki-global-timer-resize memory-anki-global-timer-resize-se" style={TIMER_RESIZE_HANDLE_STYLES.se} onPointerDown={(event) => beginResize('se', event)} />
            <button type="button" aria-label="从左下角调整计时器大小" className="memory-anki-global-timer-resize memory-anki-global-timer-resize-sw" style={TIMER_RESIZE_HANDLE_STYLES.sw} onPointerDown={(event) => beginResize('sw', event)} />
          </div>
        ) : (
          <button
            type="button"
            className="memory-anki-global-timer-capsule"
            onPointerDown={beginDrag}
            onClick={() => {
              if (suppressCapsuleClickRef.current) {
                suppressCapsuleClickRef.current = false
                return
              }
              if (useFreestyleMobileCompactTimer) {
                if (layout.collapsed) {
                  persistLayout((current) => ({ ...current, collapsed: false }))
                }
                setFreestyleMobileTimerExpanded(true)
                return
              }
              persistLayout((current) => ({ ...current, collapsed: false }))
            }}
            title={activeEntry ? `${sceneLabel} 计时器` : '展开计时器'}
          >
            <span className="memory-anki-global-timer-capsule-dot" />
            <span className="memory-anki-global-timer-capsule-label">
              {activeEntry ? `${sceneLabel} ${formatClock(secondaryRemaining)}` : '计时器 待开始'}
            </span>
            <Expand className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <TimerAutomationDialog
        open={automationOpen}
        config={automationConfig}
        onOpenChange={setAutomationOpen}
        onSave={(nextConfig) => {
          const saved = saveTimerAutomationConfig(nextConfig)
          setAutomationConfig(saved)
        }}
        onReset={() => {
          setAutomationConfig(resetTimerAutomationConfig())
          setFocusConfig(resetTimerFocusConfig())
        }}
        focusConfig={focusConfig}
        onFocusConfigSave={(nextConfig) => {
          const saved = saveTimerFocusConfig(nextConfig)
          setFocusConfig(saved)
        }}
      />
    </>
  )

  if (typeof document === 'undefined') {
    return overlay
  }

  return createPortal(overlay, document.body)
}

export function GlobalTimerProvider({
  children,
}: React.PropsWithChildren) {
  const [entries, setEntries] = React.useState<Record<string, GlobalTimerRegistration>>({})
  const activeEntry = React.useMemo(() => selectActiveTimerEntry(Object.values(entries)), [entries])

  const upsertTimer = React.useCallback((entry: GlobalTimerRegistration) => {
    setEntries((current) => {
      const previous = current[entry.sessionId]
      if (
        previous &&
        previous.scene === entry.scene &&
        previous.title === entry.title &&
        previous.isRouteActive === entry.isRouteActive &&
        previous.becameActiveAt === entry.becameActiveAt &&
        previous.timer === entry.timer
      ) {
        return current
      }
      return {
        ...current,
        [entry.sessionId]: entry,
      }
    })
  }, [])

  const removeTimer = React.useCallback((sessionId: string) => {
    setEntries((current) => {
      if (!current[sessionId]) return current
      const next = { ...current }
      delete next[sessionId]
      return next
    })
  }, [])

  const contextValue = React.useMemo(
    () => ({
      upsertTimer,
      removeTimer,
    }),
    [removeTimer, upsertTimer],
  )

  return (
    <GlobalTimerContext.Provider value={contextValue}>
      {children}
      <GlobalTimerFloatingOverlay entries={Object.values(entries)} />
      <GlobalBreakGuardOverlay activeEntry={activeEntry} />
    </GlobalTimerContext.Provider>
  )
}

export function useGlobalTimerRegistration(entry: {
  scene: TimerFocusScene
  title: string
  timer: TimedSessionController
  isRouteActive: boolean
  becameActiveAt: number
}) {
  const context = React.useContext(GlobalTimerContext)
  const {
    scene,
    title,
    timer,
    isRouteActive,
    becameActiveAt,
  } = entry

  React.useEffect(() => {
    if (!context) return
    context.upsertTimer({
      sessionId: timer.sessionId,
      scene,
      title,
      timer,
      isRouteActive,
      becameActiveAt,
    })
    return () => {
      context.removeTimer(timer.sessionId)
    }
  }, [becameActiveAt, context, isRouteActive, scene, timer, title])
}
