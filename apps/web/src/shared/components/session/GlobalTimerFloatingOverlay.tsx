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
  TIMER_AUTOMATION_UPDATED_EVENT,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import { onAppEvent } from '@/shared/events/appEvents'
import {
  getTimerCelebrationConfig,
  getTimerFocusRule,
  readTimerFocusConfig,
  resetTimerFocusConfig,
  saveTimerFocusConfig,
  TIMER_FOCUS_SCENE_LABELS,
  TIMER_FOCUS_UPDATED_EVENT,
  type TimerFocusConfig,
} from '@/shared/components/session/timer-focus-config'
import {
  readTimerOverlayLayout,
  saveTimerOverlayLayout,
  type TimerOverlayLayout,
} from '@/shared/components/session/timer-overlay-layout'
import { emitTimerCelebration } from '@/shared/components/session/timer-celebration'
import type { UnifiedTimerCommand, UnifiedTimerSnapshot } from '@/shared/components/session/desktopTimerBridge'
import { useMindMapFeedbackSettings } from '@/shared/components/mindmap-host/useMindMapFeedback'
import { getReviewFeedbackEffectiveVolume } from '@/shared/feedback/reviewFeedbackSettings'
import {
  createTimerOverlaySizeTokens,
  formatClock,
  formatIdlePrimaryProgress,
  formatPrimaryProgress,
  resolveFloatingTimerLayout,
  selectActiveTimerEntry,
  TIMER_RESIZE_HANDLE_STYLES,
  type GlobalTimerRegistration,
} from '@/shared/components/session/globalTimerModel'
import { formatTimerSnapshotClock } from '@/shared/components/session/timerSnapshotBuilders'
import { useTimerOverlayDrag } from '@/shared/components/session/useTimerOverlayDrag'

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

export function GlobalTimerFloatingOverlay({
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
    const unsubscribeAutomation = onAppEvent(TIMER_AUTOMATION_UPDATED_EVENT, (detail) => {
      const nextConfig = detail || readTimerAutomationConfig()
      setAutomationConfig(nextConfig)
    })
    const handleFocusChange = (event: Event) => {
      const nextConfig =
        event instanceof CustomEvent && event.detail
          ? (event.detail as TimerFocusConfig)
          : readTimerFocusConfig()
      setFocusConfig(nextConfig)
    }

    window.addEventListener(TIMER_FOCUS_UPDATED_EVENT, handleFocusChange)
    return () => {
      unsubscribeAutomation()
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

  const {
    beginDrag,
    beginResize,
    handlePointerMoveEvent,
    stopPointerInteraction,
    toggleCollapsed,
    suppressCapsuleClickRef,
  } = useTimerOverlayDrag(layout, persistLayout)

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
