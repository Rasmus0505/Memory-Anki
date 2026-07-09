import * as React from 'react'
import { createPortal } from 'react-dom'
import { Pause, Play, Settings2, Shrink, Expand } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import { TimerAutomationDialog } from '@/shared/components/session/TimerAutomationDialog'
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
import {
  getDesktopTimerBridge,
  hasDesktopTimerBridge,
  type UnifiedTimerCommand,
  type UnifiedTimerSnapshot,
} from '@/shared/components/session/desktopTimerBridge'
import type { TimedSessionController } from '@/shared/hooks/useTimedSession'
import { useMindMapFeedbackSettings } from '@/shared/components/mindmap-host/useMindMapFeedback'
import { getReviewFeedbackEffectiveVolume } from '@/shared/feedback/reviewFeedbackSettings'
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
  notifyStudyActivity: (sessionId: string) => void
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

function isSafeAppPath(path: string | null | undefined) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')
}

function resolveBreakTargetPath(returnPath: string | null, fallbackPath: string) {
  if (isSafeAppPath(returnPath)) return returnPath
  if (isSafeAppPath(fallbackPath)) return fallbackPath
  return '/freestyle'
}

function formatTimerSnapshotClock(seconds: number | null) {
  if (seconds == null) return '--:--'
  return formatClock(seconds)
}

function buildStudyTimerSnapshot({
  activeEntry,
  focusConfig,
  automationConfig,
}: {
  activeEntry: GlobalTimerRegistration | null
  focusConfig: TimerFocusConfig
  automationConfig: TimerAutomationConfig
}): UnifiedTimerSnapshot {
  const scene = activeEntry?.scene ?? null
  const sceneLabel = scene ? TIMER_FOCUS_SCENE_LABELS[scene] : '计时器'
  const focusRule = scene ? getTimerFocusRule(scene, focusConfig) : focusConfig.global
  const automationRule = scene ? getTimerAutomationRule(scene, automationConfig) : null
  const primarySeconds = Math.max(60, focusRule.primaryMinutes * 60)
  const secondarySeconds = Math.max(60, Math.min(primarySeconds, focusRule.secondaryMinutes * 60))
  const effectiveSeconds = activeEntry?.timer.effectiveSeconds ?? 0
  const secondaryRemainder = secondarySeconds > 0 ? effectiveSeconds % secondarySeconds : 0
  const secondaryRemaining =
    secondarySeconds > 0
      ? secondaryRemainder === 0
        ? secondarySeconds
        : secondarySeconds - secondaryRemainder
      : 0
  const idleText = automationRule
    ? `闲置 ${activeEntry?.timer.idleSeconds ?? 0}/${automationRule.inactiveAutoPauseSeconds} 秒`
    : '当前无学习会话'
  const status = activeEntry?.timer.status ?? 'idle'

  return {
    mode: 'study',
    status,
    title: activeEntry?.title ?? '待开始',
    scene: sceneLabel,
    displaySeconds: activeEntry ? secondaryRemaining : secondarySeconds,
    primaryText: activeEntry ? idleText : '当前无学习会话',
    secondaryText: activeEntry
      ? formatPrimaryProgress(effectiveSeconds, primarySeconds)
      : formatIdlePrimaryProgress(primarySeconds),
    snoozeCount: 0,
    availableActions: activeEntry
      ? status === 'running'
        ? ['pause']
        : ['resume']
      : [],
    presetMinutes: [],
    snoozeMinutes: [],
    targetPath: '/freestyle',
    updatedAt: Date.now(),
  }
}

function buildBreakTimerSnapshot({
  breakState,
  config,
  targetPath,
  paused,
  pausedRemainingMs,
  now = Date.now(),
}: {
  breakState: BreakGuardState
  config: BreakGuardConfig
  targetPath: string
  paused: boolean
  pausedRemainingMs?: number | null
  now?: number
}): UnifiedTimerSnapshot {
  const remainingMs =
    paused && pausedRemainingMs != null
      ? pausedRemainingMs
      : breakState.status === 'counting_down' && breakState.expiresAt != null
      ? Math.max(0, breakState.expiresAt - now)
      : breakState.status === 'expired'
        ? 0
        : null
  const displaySeconds = remainingMs == null ? null : Math.ceil(remainingMs / 1000)
  const plannedText = breakState.plannedMinutes ? `计划 ${breakState.plannedMinutes} 分钟` : '选择这次休息多久'
  const snoozeText = `延后 ${breakState.snoozeCount} 次`

  if (breakState.status === 'prompting') {
    return {
      mode: 'break',
      status: 'prompting',
      title: '要开始休息吗？',
      scene: '休息询问',
      displaySeconds: null,
      primaryText: '离开学习页一会儿了',
      secondaryText: '开始休息会暂停当前学习计时',
    snoozeCount: breakState.snoozeCount,
    availableActions: ['startBreak'],
    presetMinutes: config.presetMinutes,
    allowCustomMinutes: config.allowCustomMinutes,
    snoozeMinutes: config.snoozeMinutes,
    targetPath,
    updatedAt: now,
    }
  }

  if (breakState.status === 'expired') {
    return {
      mode: 'break',
      status: 'expired',
      title: '该回来了',
      scene: '休息到点',
      displaySeconds: 0,
      primaryText: '休息已经结束',
      secondaryText: `${plannedText} · ${snoozeText}`,
    snoozeCount: breakState.snoozeCount,
    availableActions: ['snooze', 'finishBreak', 'openTarget'],
    presetMinutes: config.presetMinutes,
    allowCustomMinutes: config.allowCustomMinutes,
    snoozeMinutes: config.snoozeMinutes,
    targetPath,
    updatedAt: now,
    }
  }

  return {
    mode: 'break',
    status: paused ? 'paused' : 'running',
    title: paused ? '休息已暂停' : '休息倒计时',
    scene: '休息中',
    displaySeconds,
    primaryText: plannedText,
    secondaryText: snoozeText,
    snoozeCount: breakState.snoozeCount,
    availableActions: [paused ? 'resume' : 'pause', 'finishBreak', 'openTarget'],
    presetMinutes: config.presetMinutes,
    allowCustomMinutes: config.allowCustomMinutes,
    snoozeMinutes: config.snoozeMinutes,
    targetPath,
    updatedAt: now,
  }
}

function GlobalTimerFloatingOverlay({
  entries,
  snapshot,
  onCommand,
}: {
  entries: GlobalTimerRegistration[]
  snapshot: UnifiedTimerSnapshot
  onCommand: (command: UnifiedTimerCommand) => void
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
  const [customBreakMinutes, setCustomBreakMinutes] = React.useState('')
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
  const isBreakMode = snapshot.mode === 'break'
  const isBreakExpired = isBreakMode && snapshot.status === 'expired'
  const panelSceneLabel = isBreakMode ? snapshot.scene : sceneLabel
  const panelTitle = isBreakMode ? snapshot.title : title
  const panelDigits = isBreakMode
    ? formatTimerSnapshotClock(snapshot.displaySeconds)
    : formatClock(activeEntry ? secondaryRemaining : idleSecondarySeconds)
  const panelPrimaryText = isBreakMode ? snapshot.primaryText : idleText
  const panelSecondaryText = isBreakMode ? snapshot.secondaryText : primarySummaryText
  const capsuleLabel = isBreakMode
    ? `${snapshot.scene.replace('中', '')} ${snapshot.status === 'expired' ? '到点' : formatTimerSnapshotClock(snapshot.displaySeconds)}`
    : activeEntry
      ? `${sceneLabel} ${formatClock(secondaryRemaining)}`
      : '计时器 待开始'

  const renderBreakActions = () => {
    if (snapshot.status === 'prompting') {
      return (
        <>
          {snapshot.presetMinutes.slice(0, 2).map((minutes) => (
            <Button
              key={minutes}
              type="button"
              size="sm"
              className="memory-anki-global-timer-action-button flex-1"
              style={sizeTokens.actionButtonStyle}
              onClick={() => onCommand({ type: 'startBreak', minutes })}
            >
              {minutes} 分钟
            </Button>
          ))}
          {snapshot.allowCustomMinutes !== false ? (
            <div className="memory-anki-global-timer-custom-break">
              <Input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                className="memory-anki-global-timer-custom-input"
                value={customBreakMinutes}
                onChange={(event) => setCustomBreakMinutes(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  const minutes = Math.round(Number(customBreakMinutes))
                  if (!Number.isFinite(minutes) || minutes < 1) return
                  onCommand({ type: 'startBreak', minutes })
                  setCustomBreakMinutes('')
                }}
                placeholder="分钟"
                aria-label="自定义休息分钟"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="memory-anki-global-timer-action-button memory-anki-global-timer-custom-submit"
                style={sizeTokens.actionButtonStyle}
                onClick={() => {
                  const minutes = Math.round(Number(customBreakMinutes))
                  if (!Number.isFinite(minutes) || minutes < 1) return
                  onCommand({ type: 'startBreak', minutes })
                  setCustomBreakMinutes('')
                }}
              >
                自定
              </Button>
            </div>
          ) : null}
        </>
      )
    }

    if (snapshot.status === 'expired') {
      const firstSnooze = snapshot.snoozeMinutes[0] ?? 1
      return (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="memory-anki-global-timer-action-button flex-1"
            style={sizeTokens.actionButtonStyle}
            onClick={() => onCommand({ type: 'snooze', minutes: firstSnooze })}
          >
            +{firstSnooze}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="memory-anki-global-timer-action-button flex-1"
            style={sizeTokens.actionButtonStyle}
            onClick={() => onCommand({ type: 'finishBreak' })}
          >
            结束
          </Button>
          <Button
            type="button"
            size="sm"
            className="memory-anki-global-timer-action-button flex-1"
            style={sizeTokens.actionButtonStyle}
            onClick={() => onCommand({ type: 'finishBreak', openTarget: true })}
          >
            回随心
          </Button>
        </>
      )
    }

    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="memory-anki-global-timer-action-button flex-1"
          style={sizeTokens.actionButtonStyle}
          onClick={() => onCommand({ type: snapshot.status === 'paused' ? 'resume' : 'pause' })}
        >
          {snapshot.status === 'paused' ? '继续' : '暂停'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="memory-anki-global-timer-action-button flex-1"
          style={sizeTokens.actionButtonStyle}
          onClick={() => onCommand({ type: 'finishBreak' })}
        >
          结束
        </Button>
        <Button
          type="button"
          size="sm"
          className="memory-anki-global-timer-action-button flex-1"
          style={sizeTokens.actionButtonStyle}
          onClick={() => onCommand({ type: 'finishBreak', openTarget: true })}
        >
          回学习
        </Button>
      </>
    )
  }

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
              isBreakMode && 'memory-anki-global-timer-panel-break',
              isBreakExpired && 'memory-anki-global-timer-panel-expired',
              pulseKind === 'primary' && 'memory-anki-global-timer-panel-primary',
              pulseKind === 'secondary' && 'memory-anki-global-timer-panel-secondary',
            )}
            style={{ width: layout.width, height: layout.height, ...sizeTokens.panelStyle }}
          >
            <div className="memory-anki-global-timer-dragbar" onPointerDown={beginDrag}>
              <div className="min-w-0">
                <div className="memory-anki-global-timer-scene">{panelSceneLabel}</div>
                <div className="memory-anki-global-timer-title" title={panelTitle}>
                  {panelTitle}
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
                {panelDigits}
              </div>
              <div className="memory-anki-global-timer-row">{panelPrimaryText}</div>
              <div className="memory-anki-global-timer-row memory-anki-global-timer-row-primary">
                {panelSecondaryText}
              </div>
              <div className="memory-anki-global-timer-body-spacer" aria-hidden="true" />
              <div className="memory-anki-global-timer-actions">
                {isBreakMode ? (
                  renderBreakActions()
                ) : activeEntry && primaryAction ? (
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
              {capsuleLabel}
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
  const [showInPageTimerOverlay] = React.useState(() => !hasDesktopTimerBridge())
  const activeEntry = React.useMemo(() => selectActiveTimerEntry(Object.values(entries)), [entries])
  const [automationConfig, setAutomationConfig] = React.useState<TimerAutomationConfig>(() =>
    readTimerAutomationConfig(),
  )
  const [focusConfig, setFocusConfig] = React.useState<TimerFocusConfig>(() =>
    readTimerFocusConfig(),
  )
  const [breakConfig, setBreakConfig] = React.useState<BreakGuardConfig>(() => readBreakGuardConfig())
  const [breakState, setBreakState] = React.useState<BreakGuardState>(IDLE_BREAK_GUARD_STATE)
  const [breakPaused, setBreakPaused] = React.useState(false)
  const [breakPausedRemainingMs, setBreakPausedRemainingMs] = React.useState<number | null>(null)
  const [breakInterruptedSessionId, setBreakInterruptedSessionId] = React.useState<string | null>(null)
  const [breakReturnPath, setBreakReturnPath] = React.useState<string | null>(null)
  const [breakTick, setBreakTick] = React.useState(0)
  const promptTimerRef = React.useRef<number | null>(null)
  const promptAutoStartTimerRef = React.useRef<number | null>(null)
  const breakAutoOpenedKeyRef = React.useRef<string | null>(null)
  const breakStateRef = React.useRef(breakState)
  const breakConfigRef = React.useRef(breakConfig)
  const breakPausedRef = React.useRef(breakPaused)
  const breakPausedRemainingRef = React.useRef(breakPausedRemainingMs)
  const breakInterruptedSessionIdRef = React.useRef(breakInterruptedSessionId)
  const breakReturnPathRef = React.useRef(breakReturnPath)
  const entriesRef = React.useRef(entries)
  const activeEntryRef = React.useRef(activeEntry)

  React.useEffect(() => {
    breakStateRef.current = breakState
  }, [breakState])

  React.useEffect(() => {
    if (breakState.status !== 'expired') {
      breakAutoOpenedKeyRef.current = null
      return
    }
    const autoOpenKey = `${breakState.startedAt ?? 'idle'}:${breakState.snoozeCount}`
    if (breakAutoOpenedKeyRef.current === autoOpenKey) return
    const bridge = getDesktopTimerBridge()
    if (!bridge?.openMainTarget) return
    breakAutoOpenedKeyRef.current = autoOpenKey
    bridge.openMainTarget(resolveBreakTargetPath(breakReturnPathRef.current, breakConfigRef.current.targetPath))
  }, [breakState])

  React.useEffect(() => {
    breakConfigRef.current = breakConfig
  }, [breakConfig])

  React.useEffect(() => {
    breakPausedRef.current = breakPaused
  }, [breakPaused])

  React.useEffect(() => {
    breakPausedRemainingRef.current = breakPausedRemainingMs
  }, [breakPausedRemainingMs])

  React.useEffect(() => {
    breakInterruptedSessionIdRef.current = breakInterruptedSessionId
  }, [breakInterruptedSessionId])

  React.useEffect(() => {
    breakReturnPathRef.current = breakReturnPath
  }, [breakReturnPath])

  React.useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  React.useEffect(() => {
    activeEntryRef.current = activeEntry
  }, [activeEntry])

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
    const handleBreakConfigChange = (event: Event) => {
      const nextConfig =
        event instanceof CustomEvent && event.detail
          ? (event.detail as BreakGuardConfig)
          : readBreakGuardConfig()
      setBreakConfig(nextConfig)
    }

    window.addEventListener('memory-anki-timer-automation-change', handleAutomationChange)
    window.addEventListener(TIMER_FOCUS_UPDATED_EVENT, handleFocusChange)
    window.addEventListener(BREAK_GUARD_UPDATED_EVENT, handleBreakConfigChange)
    return () => {
      window.removeEventListener('memory-anki-timer-automation-change', handleAutomationChange)
      window.removeEventListener(TIMER_FOCUS_UPDATED_EVENT, handleFocusChange)
      window.removeEventListener(BREAK_GUARD_UPDATED_EVENT, handleBreakConfigChange)
    }
  }, [])

  const upsertTimer = React.useCallback((entry: GlobalTimerRegistration) => {
    setEntries((current) => {
      const previous = current[entry.sessionId]
      if (
        previous &&
        previous.scene === entry.scene &&
        previous.title === entry.title &&
        previous.isRouteActive === entry.isRouteActive &&
        previous.becameActiveAt === entry.becameActiveAt &&
        previous.routePath === entry.routePath &&
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

  React.useEffect(() => {
    if (breakState.status !== 'counting_down' || breakPaused) return
    const timer = window.setInterval(() => {
      setBreakTick((current) => current + 1)
      setBreakState((current) => expireBreakGuardIfDue(current))
    }, 250)
    return () => window.clearInterval(timer)
  }, [breakPaused, breakState.status])

  React.useEffect(() => {
    return () => {
      if (promptTimerRef.current != null) {
        window.clearTimeout(promptTimerRef.current)
      }
      if (promptAutoStartTimerRef.current != null) {
        window.clearTimeout(promptAutoStartTimerRef.current)
      }
    }
  }, [])

  const openTarget = React.useCallback((targetPath: string) => {
    const safePath = resolveBreakTargetPath(targetPath, '/freestyle')
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (currentPath === safePath) return
    window.location.assign(safePath)
  }, [])

  const finishBreak = React.useCallback((options?: { openTarget?: boolean }) => {
    const current = breakStateRef.current
    const config = breakConfigRef.current
    const targetPath = resolveBreakTargetPath(breakReturnPathRef.current, config.targetPath)
    if (current.logId) {
      updateBreakGuardLog(current.logId, {
        endedAt: new Date().toISOString(),
        overtime: current.status === 'expired',
        snoozeCount: current.snoozeCount,
      })
    }
    setBreakPaused(false)
    setBreakPausedRemainingMs(null)
    breakInterruptedSessionIdRef.current = null
    setBreakInterruptedSessionId(null)
    breakReturnPathRef.current = null
    setBreakReturnPath(null)
    setBreakState(IDLE_BREAK_GUARD_STATE)
    if (options?.openTarget) {
      openTarget(targetPath)
    }
  }, [openTarget])

  const clearPendingBreakPrompt = React.useCallback(() => {
    if (promptTimerRef.current == null) return
    window.clearTimeout(promptTimerRef.current)
    promptTimerRef.current = null
  }, [])

  const clearPendingBreakPromptAutoStart = React.useCallback(() => {
    if (promptAutoStartTimerRef.current == null) return
    window.clearTimeout(promptAutoStartTimerRef.current)
    promptAutoStartTimerRef.current = null
  }, [])

  const pauseActiveStudyForBreakGuard = React.useCallback(() => {
    const currentActiveEntry = activeEntryRef.current
    breakReturnPathRef.current = currentActiveEntry?.routePath ?? null
    setBreakReturnPath(currentActiveEntry?.routePath ?? null)
    if (currentActiveEntry?.timer.status !== 'running') return
    currentActiveEntry.timer.pause({ source: 'break_guard_prompt' })
    breakInterruptedSessionIdRef.current = currentActiveEntry.timer.sessionId
    setBreakInterruptedSessionId(currentActiveEntry.timer.sessionId)
  }, [])

  const resumeInterruptedStudyAfterPromptCancel = React.useCallback((entry: GlobalTimerRegistration | null) => {
    const interruptedSessionId = breakInterruptedSessionIdRef.current
    if (!entry?.isRouteActive || !interruptedSessionId || entry.timer.sessionId !== interruptedSessionId) return
    entry.timer.resume({ source: 'break_guard_prompt_cancel' })
  }, [])

  const resumeInterruptedStudyAfterBreak = React.useCallback((entry: GlobalTimerRegistration | null) => {
    const config = breakConfigRef.current
    const interruptedSessionId = breakInterruptedSessionIdRef.current
    if (!config.resumeInterruptedStudyOnReturn) return
    if (!entry?.isRouteActive || !interruptedSessionId || entry.timer.sessionId !== interruptedSessionId) return
    if (entry.timer.status !== 'completed' && entry.timer.status !== 'idle') {
      entry.timer.resume({ source: 'break_guard_return_to_study' })
    } else if (entry.timer.status === 'idle') {
      entry.timer.start({ source: 'break_guard_return_to_study' })
    }
  }, [])

  const showBreakPrompt = React.useCallback((currentBreakState: BreakGuardState) => {
    if (!shouldPromptForBreakGuard(breakConfigRef.current, currentBreakState)) return
    clearPendingBreakPrompt()
    pauseActiveStudyForBreakGuard()
    setBreakState((current) =>
      shouldPromptForBreakGuard(breakConfigRef.current, current)
        ? { ...IDLE_BREAK_GUARD_STATE, status: 'prompting' }
        : current,
    )
  }, [clearPendingBreakPrompt, pauseActiveStudyForBreakGuard])

  const scheduleBreakPrompt = React.useCallback((config: BreakGuardConfig, currentBreakState: BreakGuardState) => {
    if (!shouldPromptForBreakGuard(config, currentBreakState)) return
    clearPendingBreakPrompt()
    pauseActiveStudyForBreakGuard()
    promptTimerRef.current = window.setTimeout(() => {
      promptTimerRef.current = null
      showBreakPrompt(breakStateRef.current)
    }, config.promptDelaySeconds * 1000)
  }, [clearPendingBreakPrompt, pauseActiveStudyForBreakGuard, showBreakPrompt])

  const startBreakCountdown = React.useCallback((minutes: number) => {
    const currentConfig = breakConfigRef.current
    const currentActiveEntry = activeEntryRef.current
    const safeMinutes = Math.max(1, Math.round(minutes))
    clearPendingBreakPrompt()
    clearPendingBreakPromptAutoStart()
    const interruptedSessionId =
      breakInterruptedSessionIdRef.current ??
      (currentActiveEntry?.timer.status === 'running' ? currentActiveEntry.timer.sessionId : null)
    const returnPath = breakReturnPathRef.current ?? currentActiveEntry?.routePath ?? null
    breakReturnPathRef.current = returnPath
    setBreakReturnPath(returnPath)
    if (currentActiveEntry?.timer.status === 'running') {
      currentActiveEntry.timer.pause({ source: 'break_guard' })
    }
    const logId = currentConfig.recordBreakLogs ? createBreakLogId() : null
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
    setBreakPaused(false)
    setBreakPausedRemainingMs(null)
    breakInterruptedSessionIdRef.current = interruptedSessionId
    setBreakInterruptedSessionId(interruptedSessionId)
    setBreakState(createBreakGuardCountdown(safeMinutes, Date.now(), logId))
  }, [clearPendingBreakPrompt, clearPendingBreakPromptAutoStart])

  const endBreakAndResumeStudy = React.useCallback((entry: GlobalTimerRegistration | null) => {
    if (!entry?.isRouteActive) return false

    clearPendingBreakPrompt()
    clearPendingBreakPromptAutoStart()
    const config = breakConfigRef.current
    const currentBreakState = breakStateRef.current
    if (currentBreakState.status === 'idle' || currentBreakState.status === 'dismissed') return true

    if (currentBreakState.status === 'prompting') {
      resumeInterruptedStudyAfterPromptCancel(entry)
      setBreakPaused(false)
      setBreakPausedRemainingMs(null)
      setBreakState(IDLE_BREAK_GUARD_STATE)
      breakInterruptedSessionIdRef.current = null
      setBreakInterruptedSessionId(null)
      breakReturnPathRef.current = null
      setBreakReturnPath(null)
      return true
    }

    if (
      config.autoFinishOnStudyReturn &&
      (currentBreakState.status === 'counting_down' || currentBreakState.status === 'expired')
    ) {
      if (currentBreakState.logId) {
        updateBreakGuardLog(currentBreakState.logId, {
          endedAt: new Date().toISOString(),
          overtime: currentBreakState.status === 'expired',
          snoozeCount: currentBreakState.snoozeCount,
        })
      }
      setBreakPaused(false)
      setBreakPausedRemainingMs(null)
      resumeInterruptedStudyAfterBreak(entry)
      setBreakState(IDLE_BREAK_GUARD_STATE)
      breakInterruptedSessionIdRef.current = null
      setBreakInterruptedSessionId(null)
      breakReturnPathRef.current = null
      setBreakReturnPath(null)
      return true
    }

    return false
  }, [clearPendingBreakPrompt, clearPendingBreakPromptAutoStart, resumeInterruptedStudyAfterBreak, resumeInterruptedStudyAfterPromptCancel])

  const returnToStudy = React.useCallback(() => {
    const currentBreakState = breakStateRef.current
    if (currentBreakState.status === 'idle' || currentBreakState.status === 'dismissed') {
      clearPendingBreakPrompt()
      clearPendingBreakPromptAutoStart()
      resumeInterruptedStudyAfterPromptCancel(activeEntryRef.current)
      breakInterruptedSessionIdRef.current = null
      setBreakInterruptedSessionId(null)
      breakReturnPathRef.current = null
      setBreakReturnPath(null)
      return
    }
    endBreakAndResumeStudy(activeEntryRef.current)
  }, [clearPendingBreakPrompt, clearPendingBreakPromptAutoStart, endBreakAndResumeStudy, resumeInterruptedStudyAfterPromptCancel])

  const notifyStudyActivity = React.useCallback((sessionId: string) => {
    const entry = entriesRef.current[sessionId]
    if (!entry?.isRouteActive) return
    endBreakAndResumeStudy(entry)
  }, [endBreakAndResumeStudy])

  React.useEffect(() => {
    if (!activeEntry?.isRouteActive) return
    const currentBreakState = breakStateRef.current
    if (currentBreakState.status === 'idle' || currentBreakState.status === 'dismissed') return
    endBreakAndResumeStudy(activeEntry)
  }, [activeEntry, endBreakAndResumeStudy])

  const contextValue = React.useMemo(
    () => ({
      upsertTimer,
      removeTimer,
      notifyStudyActivity,
    }),
    [notifyStudyActivity, removeTimer, upsertTimer],
  )

  const handleTimerCommand = React.useCallback((command: UnifiedTimerCommand) => {
    const currentBreakState = breakStateRef.current
    const config = breakConfigRef.current
    const currentActiveEntry = activeEntryRef.current

    if (command.type === 'promptBreak') {
      scheduleBreakPrompt(config, currentBreakState)
      return
    }

    if (command.type === 'returnToStudy') {
      returnToStudy()
      return
    }

    if (command.type === 'startBreak') {
      startBreakCountdown(command.minutes)
      return
    }

    if (command.type === 'pause') {
      if (currentBreakState.status === 'counting_down') {
        const remaining = Math.max(0, (currentBreakState.expiresAt ?? Date.now()) - Date.now())
        setBreakPaused(true)
        setBreakPausedRemainingMs(remaining)
        return
      }
      currentActiveEntry?.timer.pause({ source: 'global_floating_timer' })
      return
    }

    if (command.type === 'resume') {
      if (currentBreakState.status === 'counting_down' && breakPausedRef.current) {
        const remaining = breakPausedRemainingRef.current ?? 0
        setBreakState((current) => ({
          ...current,
          expiresAt: Date.now() + remaining,
        }))
        setBreakPaused(false)
        setBreakPausedRemainingMs(null)
        return
      }
      if (currentActiveEntry?.timer.status === 'paused') {
        currentActiveEntry.timer.resume({ source: 'global_floating_timer' })
      } else if (currentActiveEntry?.timer.status === 'idle') {
        currentActiveEntry.timer.start({ source: 'global_floating_timer' })
      }
      return
    }

    if (command.type === 'snooze') {
      if (currentBreakState.status !== 'expired' && currentBreakState.status !== 'counting_down') return
      const nextState = snoozeBreakGuard(currentBreakState, command.minutes)
      if (nextState.logId) {
        updateBreakGuardLog(nextState.logId, { snoozeCount: nextState.snoozeCount })
      }
      setBreakPaused(false)
      setBreakPausedRemainingMs(null)
      setBreakState(nextState)
      return
    }

    if (command.type === 'finishBreak') {
      finishBreak({ openTarget: command.openTarget })
      return
    }

    if (command.type === 'openTarget') {
      openTarget(command.path)
      return
    }

    if (command.type === 'collapse') {
      const bridge = getDesktopTimerBridge()
      bridge?.setOverlayCollapsed?.(command.collapsed)
    }
  }, [finishBreak, openTarget, returnToStudy, scheduleBreakPrompt, startBreakCountdown])

  const timerSnapshot = React.useMemo(() => {
    if (
      breakState.status === 'prompting' ||
      breakState.status === 'counting_down' ||
      breakState.status === 'expired'
    ) {
      return buildBreakTimerSnapshot({
        breakState,
        config: breakConfig,
        targetPath: resolveBreakTargetPath(breakReturnPath, breakConfig.targetPath),
        paused: breakPaused,
        pausedRemainingMs: breakPausedRemainingMs,
      })
    }
    return buildStudyTimerSnapshot({
      activeEntry,
      focusConfig,
      automationConfig,
    })
  }, [activeEntry, automationConfig, breakConfig, breakPaused, breakPausedRemainingMs, breakReturnPath, breakState, breakTick, focusConfig])

  React.useEffect(() => {
    clearPendingBreakPromptAutoStart()
    if (breakState.status !== 'prompting') return
    const defaultMinutes = breakConfig.presetMinutes[0] ?? 1
    promptAutoStartTimerRef.current = window.setTimeout(() => {
      promptAutoStartTimerRef.current = null
      if (breakStateRef.current.status !== 'prompting') return
      startBreakCountdown(defaultMinutes)
    }, 5_000)
    return () => {
      clearPendingBreakPromptAutoStart()
    }
  }, [breakConfig.presetMinutes, breakState.status, clearPendingBreakPromptAutoStart, startBreakCountdown])

  React.useEffect(() => {
    const bridge = getDesktopTimerBridge()
    if (!bridge?.onPauseActiveTimer) return
    return bridge.onPauseActiveTimer(() => {
      activeEntryRef.current?.timer.pause({ source: 'desktop_timer_overlay' })
    })
  }, [])

  React.useEffect(() => {
    const bridge = getDesktopTimerBridge()
    bridge?.publishTimerSnapshot?.(timerSnapshot)
  }, [timerSnapshot])

  React.useEffect(() => {
    const bridge = getDesktopTimerBridge()
    if (!bridge?.onTimerCommand) return
    return bridge.onTimerCommand(handleTimerCommand)
  }, [handleTimerCommand])

  React.useEffect(() => {
    const bridge = getDesktopTimerBridge()
    if (!bridge?.onMainWindowBlur) return
    return bridge.onMainWindowBlur(() => {
      scheduleBreakPrompt(breakConfigRef.current, breakStateRef.current)
    })
  }, [scheduleBreakPrompt])

  return (
    <GlobalTimerContext.Provider value={contextValue}>
      {children}
      {showInPageTimerOverlay ? (
        <GlobalTimerFloatingOverlay
          entries={Object.values(entries)}
          snapshot={timerSnapshot}
          onCommand={handleTimerCommand}
        />
      ) : null}
    </GlobalTimerContext.Provider>
  )
}

export function useGlobalTimerRegistration(entry: {
  scene: TimerFocusScene
  title: string
  timer: TimedSessionController
  isRouteActive: boolean
  becameActiveAt: number
  routePath: string
}) {
  const context = React.useContext(GlobalTimerContext)
  const {
    scene,
    title,
    timer,
    isRouteActive,
    becameActiveAt,
    routePath,
  } = entry
  const notifyStudyActivity = context?.notifyStudyActivity

  const registeredTimer = React.useMemo<TimedSessionController>(() => {
    if (!notifyStudyActivity) return timer
    return {
      ...timer,
      registerActivity: (activityKind, meta) => {
        notifyStudyActivity(timer.sessionId)
        timer.registerActivity(activityKind, meta)
      },
    }
  }, [notifyStudyActivity, timer])

  React.useEffect(() => {
    if (!context) return
    context.upsertTimer({
      sessionId: timer.sessionId,
      scene,
      title,
      timer: registeredTimer,
      isRouteActive,
      becameActiveAt,
      routePath,
    })
    return () => {
      context.removeTimer(timer.sessionId)
    }
  }, [becameActiveAt, context, isRouteActive, registeredTimer, routePath, scene, timer.sessionId, title])

  return registeredTimer
}
