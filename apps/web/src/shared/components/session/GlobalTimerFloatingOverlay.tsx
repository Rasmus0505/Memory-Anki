import * as React from 'react'
import { createPortal } from 'react-dom'
import { Pause, Play, Settings2, Shrink, Expand } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import { TimerAutomationDialog } from '@/shared/components/session/TimerAutomationDialog'
import {
  readTimerAutomationConfig,
  resetTimerAutomationConfig,
  saveTimerAutomationConfig,
  TIMER_AUTOMATION_UPDATED_EVENT,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import { onAppEvent } from '@/shared/events/appEvents'
import {
  getTimerCelebrationConfig,
  readTimerFocusConfig,
  resetTimerFocusConfig,
  saveTimerFocusConfig,
  TIMER_FOCUS_UPDATED_EVENT,
  type TimerFocusConfig,
} from '@/shared/components/session/timer-focus-config'
import { emitTimerCelebration } from '@/shared/components/session/timer-celebration'
import { useMindMapFeedbackSettings } from '@/shared/feedback/mindmap-audio/useMindMapFeedback'
import { getReviewFeedbackEffectiveVolume } from '@/shared/feedback/reviewFeedbackSettings'
import { playFeedbackAudio } from '@/shared/feedback/feedbackCenter'
import {
  readTimerOverlayLayout,
  saveTimerOverlayLayout,
  type TimerOverlayLayout,
} from '@/shared/components/session/timer-overlay-layout'
import type { UnifiedTimerCommand, UnifiedTimerSnapshot } from '@/shared/components/session/desktopTimerBridge'
import {
  BREAK_GUARD_UPDATED_EVENT,
  readBreakGuardConfig,
  saveBreakGuardConfig,
  type BreakGuardConfig,
} from '@/shared/components/session/break-guard-config'
import {
  createTimerOverlaySizeTokens,
  formatClock,
  resolveFloatingTimerLayout,
  selectActiveTimerEntry,
  TIMER_RESIZE_HANDLE_STYLES,
  type GlobalTimerRegistration,
} from '@/shared/components/session/globalTimerModel'
import { formatTimerSnapshotClock } from '@/shared/components/session/timerSnapshotBuilders'
import { useTimerOverlayDrag } from '@/shared/components/session/useTimerOverlayDrag'

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
  const [breakConfig, setBreakConfig] = React.useState<BreakGuardConfig>(() =>
    readBreakGuardConfig(),
  )
  const feedbackSettings = useMindMapFeedbackSettings()
  const [pulseKind, setPulseKind] = React.useState<'interval' | 'goal' | null>(null)
  const [pulseNonce, setPulseNonce] = React.useState(0)
  const [customBreakMinutes, setCustomBreakMinutes] = React.useState('')
  const activeEntry = React.useMemo(() => selectActiveTimerEntry(entries), [entries])
  const [isNarrowViewport, setIsNarrowViewport] = React.useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false,
  )
  const [freestyleMobileTimerExpanded, setFreestyleMobileTimerExpanded] = React.useState(false)
  const [idlePanelExpanded, setIdlePanelExpanded] = React.useState(false)
  const lastFeedbackEventIdRef = React.useRef<string | null>(null)
  const breakExpiredNotifiedRef = React.useRef(false)

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

  const useFreestyleMobileCompactTimer = isNarrowViewport

  React.useEffect(() => {
    if (!useFreestyleMobileCompactTimer) {
      setFreestyleMobileTimerExpanded(false)
    }
  }, [useFreestyleMobileCompactTimer])

  React.useEffect(() => {
    setFreestyleMobileTimerExpanded(false)
    setIdlePanelExpanded(false)
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
    const handleBreakChange = (event: Event) => {
      const nextConfig =
        event instanceof CustomEvent && event.detail
          ? (event.detail as BreakGuardConfig)
          : readBreakGuardConfig()
      setBreakConfig(nextConfig)
    }

    window.addEventListener(TIMER_FOCUS_UPDATED_EVENT, handleFocusChange)
    window.addEventListener(BREAK_GUARD_UPDATED_EVENT, handleBreakChange)
    return () => {
      unsubscribeAutomation()
      window.removeEventListener(TIMER_FOCUS_UPDATED_EVENT, handleFocusChange)
      window.removeEventListener(BREAK_GUARD_UPDATED_EVENT, handleBreakChange)
    }
  }, [])

  React.useEffect(() => {
    if (pulseKind == null) return
    const timer = window.setTimeout(() => setPulseKind(null), pulseKind === 'goal' ? 540 : 360)
    return () => window.clearTimeout(timer)
  }, [pulseKind, pulseNonce])

  React.useEffect(() => {
    const signal = snapshot.feedbackSignal
    if (!signal || lastFeedbackEventIdRef.current === signal.eventId) return
    lastFeedbackEventIdRef.current = signal.eventId
    setPulseKind(signal.kind)
    setPulseNonce((current) => current + 1)
    const kind = signal.kind === 'goal' ? 'primary' : 'secondary'
    emitTimerCelebration({
      completionCount: signal.ordinal,
      kind,
      reducedMotion:
        feedbackSettings.reducedCelebrationMotion ||
        (typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches),
      soundEnabled: feedbackSettings.soundEnabled && feedbackSettings.mode === 'immersive',
      volume: getReviewFeedbackEffectiveVolume(feedbackSettings),
      feedbackIntensity: focusConfig.feedbackIntensity,
      eventConfig: getTimerCelebrationConfig(kind, focusConfig),
    })
  }, [feedbackSettings, focusConfig, snapshot.feedbackSignal])

  React.useEffect(() => {
    const expired = snapshot.mode === 'break' && snapshot.status === 'expired'
    if (!expired) {
      breakExpiredNotifiedRef.current = false
      return
    }
    if (breakExpiredNotifiedRef.current) return
    breakExpiredNotifiedRef.current = true
    playFeedbackAudio({ event: 'navigation', audioScope: 'global' })
    if (
      feedbackSettings.desktopNotificationsEnabled &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      new Notification('休息时间到了', { body: '准备好后手动开始下一轮学习。' })
    }
  }, [feedbackSettings.desktopNotificationsEnabled, snapshot.mode, snapshot.status])

  const {
    beginDrag,
    beginResize,
    handlePointerMoveEvent,
    stopPointerInteraction,
    toggleCollapsed,
    suppressCapsuleClickRef,
  } = useTimerOverlayDrag(layout, persistLayout)

  const isBreakMode = snapshot.mode === 'break'
  const showFullPanel =
    !layout.collapsed &&
    (activeEntry !== null || isBreakMode || idlePanelExpanded) &&
    !(useFreestyleMobileCompactTimer && !freestyleMobileTimerExpanded)
  const layoutWidth = layout.width
  const layoutHeight = layout.height
  const sizeTokens = React.useMemo(
    () => createTimerOverlaySizeTokens({ width: layoutWidth, height: layoutHeight }),
    [layoutHeight, layoutWidth],
  )
  const isBreakExpired = isBreakMode && snapshot.status === 'expired'
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
  const roundSummaryText = roundTargetSeconds > 0
    ? `本轮 ${formatClock(roundElapsedSeconds)}/${formatClock(roundTargetSeconds)}`
    : snapshot.secondaryText
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
  const panelSceneLabel = snapshot.scene
  const panelTitle = snapshot.title
  const panelDigits = isBreakMode
    ? formatTimerSnapshotClock(snapshot.displaySeconds)
    : formatClock(effectiveSeconds)
  const panelPrimaryText = isBreakMode ? snapshot.primaryText : studyStatusText
  const panelSecondaryText = isBreakMode ? snapshot.secondaryText : roundSummaryText
  const studyCapsuleStatus =
    studyPhase === 'idle_warning'
      ? ' · 提醒'
      : studyPhase === 'goal_reached'
        ? ' · 达标'
        : studyPhase === 'paused'
          ? ' · 已暂停'
          : ''
  const capsuleLabel = isBreakMode
    ? snapshot.status === 'expired'
      ? '休息到点'
      : snapshot.status === 'prompting'
        ? '休息询问'
        : `休息 ${formatTimerSnapshotClock(snapshot.displaySeconds)}`
    : activeEntry
      ? `${snapshot.scene}${studyCapsuleStatus} ${formatClock(effectiveSeconds)}`
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
            延后 {firstSnooze} 分钟
          </Button>
          <Button
            type="button"
            size="sm"
            className="memory-anki-global-timer-action-button flex-1"
            style={sizeTokens.actionButtonStyle}
            onClick={() => onCommand({ type: 'startStudy' })}
          >
            <Play className="memory-anki-global-timer-icon mr-2" style={sizeTokens.iconStyle} />
            开始学习
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

  const renderStudyActions = () => {
    if (studyPhase === 'goal_reached') {
      const suggestedBreakMinutes = Math.max(1, snapshot.suggestedBreakMinutes ?? 5)
      return (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="memory-anki-global-timer-action-button flex-1"
            style={sizeTokens.actionButtonStyle}
            onClick={() => onCommand({ type: 'continueRound' })}
          >
            继续学习
          </Button>
          <Button
            type="button"
            size="sm"
            className="memory-anki-global-timer-action-button flex-1"
            style={sizeTokens.actionButtonStyle}
            onClick={() => onCommand({ type: 'startGoalBreak', minutes: suggestedBreakMinutes })}
          >
            休息 {suggestedBreakMinutes} 分钟
          </Button>
        </>
      )
    }

    const canPause = snapshot.availableActions.includes('pause')
    const canResume = snapshot.availableActions.includes('resume')
    if (canPause) {
      return (
        <Button
          type="button"
          size="sm"
          className="memory-anki-global-timer-action-button flex-1"
          style={sizeTokens.actionButtonStyle}
          onClick={() => onCommand({ type: 'pause' })}
        >
          <Pause className="memory-anki-global-timer-icon mr-2" style={sizeTokens.iconStyle} />
          暂停
        </Button>
      )
    }

    if (canResume) {
      return (
        <Button
          type="button"
          size="sm"
          className="memory-anki-global-timer-action-button flex-1"
          style={sizeTokens.actionButtonStyle}
          onClick={() => onCommand({ type: 'resume' })}
        >
          <Play className="memory-anki-global-timer-icon mr-2" style={sizeTokens.iconStyle} />
          {studyPhase === 'paused' ? '继续' : '开始'}
        </Button>
      )
    }

    return (
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
    )
  }

  const overlay = (
    <>
      {pulseKind ? (
        <div
          key={`${pulseKind}-${pulseNonce}`}
          className={cn(
            'memory-anki-timer-screen-pulse',
            pulseKind === 'goal'
              ? 'memory-anki-timer-screen-pulse-primary'
              : 'memory-anki-timer-screen-pulse-secondary',
          )}
          aria-hidden="true"
        />
      ) : null}
      <div
data-timer-overlay-root="true"
        data-semantic-state={snapshot.semanticState ?? 'idle'}
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
              !isBreakMode && studyPhase === 'idle_warning' && 'memory-anki-global-timer-panel-warning',
              !isBreakMode && studyPhase === 'goal_reached' && 'memory-anki-global-timer-panel-goal',
              pulseKind === 'goal' && 'memory-anki-global-timer-panel-primary',
              pulseKind === 'interval' && 'memory-anki-global-timer-panel-secondary',
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
                  onClick={() => {
                    setIdlePanelExpanded(false)
                    toggleCollapsed()
                  }}
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
              {!isBreakMode && roundTargetSeconds > 0 ? (
                <div
                  className="memory-anki-timer-round-progress"
                  role="progressbar"
                  aria-label="本轮专注进度"
                  aria-valuemin={0}
                  aria-valuemax={roundTargetSeconds}
                  aria-valuenow={Math.min(roundElapsedSeconds, roundTargetSeconds)}
                >
                  <span style={{ width: `${roundProgress * 100}%` }} />
                </div>
              ) : null}
              <div className="memory-anki-global-timer-body-spacer" aria-hidden="true" />
              <div className="memory-anki-global-timer-actions">
                {isBreakMode ? renderBreakActions() : renderStudyActions()}
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
            className={cn(
              'memory-anki-global-timer-capsule',
              !isBreakMode && studyPhase === 'idle_warning' && 'memory-anki-global-timer-capsule-warning',
              !isBreakMode && studyPhase === 'goal_reached' && 'memory-anki-global-timer-capsule-goal',
            )}
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
              if (!activeEntry && !isBreakMode) {
                setIdlePanelExpanded(true)
              }
              persistLayout((current) => ({ ...current, collapsed: false }))
            }}
            title={activeEntry ? `${snapshot.scene} 计时器` : '展开计时器'}
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
        breakConfig={breakConfig}
        onFocusConfigSave={(nextConfig) => {
          const saved = saveTimerFocusConfig(nextConfig)
          setFocusConfig(saved)
        }}
        onBreakConfigSave={(nextConfig) => {
          const saved = saveBreakGuardConfig(nextConfig)
          setBreakConfig(saved)
        }}
      />
    </>
  )

  if (typeof document === 'undefined') {
    return overlay
  }

  return createPortal(overlay, document.body)
}
