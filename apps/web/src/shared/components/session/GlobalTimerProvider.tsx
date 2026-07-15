import * as React from 'react'
import { GlobalTimerFloatingOverlay } from '@/shared/components/session/GlobalTimerFloatingOverlay'
import {
  readTimerAutomationConfig,
  resetTimerAutomationConfig,
  saveTimerAutomationConfig,
  TIMER_AUTOMATION_UPDATED_EVENT,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import { onAppEvent } from '@/shared/events/appEvents'
import {
  getTimerFocusRule,
  readTimerFocusConfig,
  resetTimerFocusConfig,
  saveTimerFocusConfig,
  TIMER_FOCUS_UPDATED_EVENT,
  type TimerFocusConfig,
} from '@/shared/components/session/timer-focus-config'
import {
  getDesktopTimerBridge,
  hasDesktopTimerBridge,
  type UnifiedTimerCommand,
} from '@/shared/components/session/desktopTimerBridge'
import {
  resetBreakGuardConfig,
  saveBreakGuardConfig,
  updateBreakGuardLog,
} from '@/shared/components/session/break-guard-config'
import { TimerAutomationDialog } from '@/shared/components/session/TimerAutomationDialog'
import { snoozeBreakGuard } from '@/shared/components/session/breakGuardModel'
import {
  selectActiveTimerEntry,
  type GlobalTimerRegistration,
} from '@/shared/components/session/globalTimerModel'
import {
  buildBreakTimerSnapshot,
  buildStudyTimerSnapshot,
} from '@/shared/components/session/timerSnapshotBuilders'
import { useBreakGuardMachine } from '@/shared/components/session/useBreakGuardMachine'
import { useDesktopTimerBridgeSync } from '@/shared/components/session/useDesktopTimerBridgeSync'
import { useTimerFocusCycle } from '@/shared/components/session/useTimerFocusCycle'
import {
  GlobalTimerActionsContext,
  type GlobalTimerActions,
} from '@/shared/components/session/globalTimerContext'

export function GlobalTimerProvider({
  children,
}: React.PropsWithChildren) {
  const [entries, setEntries] = React.useState<Record<string, GlobalTimerRegistration>>({})
  const [showInPageTimerOverlay] = React.useState(() => !hasDesktopTimerBridge())
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const activeEntry = React.useMemo(() => selectActiveTimerEntry(Object.values(entries)), [entries])
  const [automationConfig, setAutomationConfig] = React.useState<TimerAutomationConfig>(() =>
    readTimerAutomationConfig(),
  )
  const [focusConfig, setFocusConfig] = React.useState<TimerFocusConfig>(() =>
    readTimerFocusConfig(),
  )
  const {
    breakConfig,
    breakState,
    breakPaused,
    breakPausedRemainingMs,
    breakReturnPath,
    breakTick,
    breakStateRef,
    breakConfigRef,
    breakPausedRef,
    breakPausedRemainingRef,
    activeEntryRef,
    notifyStudyActivity,
    returnToStudy,
    scheduleBreakPrompt,
    startBreakCountdown,
    finishBreak,
    openTarget,
    setBreakPaused,
    setBreakPausedRemainingMs,
    setBreakState,
  } = useBreakGuardMachine({ activeEntry, entries })
  const feedbackSignal = useTimerFocusCycle(activeEntry, focusConfig)

  React.useEffect(() => {
    const handleMainAppClick = (event: MouseEvent) => {
      const target = event.target
      if (
        target instanceof Element &&
        target.closest('[data-timer-overlay-root="true"], [data-timer-activity="ignore"]')
      ) return
      const entry = activeEntryRef.current
      if (!entry?.isRouteActive) return
      if (!notifyStudyActivity(entry.sessionId)) return
      entry.timer.registerActivity('practice_interaction', { source: 'main_app_click' })
    }
    document.addEventListener('click', handleMainAppClick, true)
    return () => document.removeEventListener('click', handleMainAppClick, true)
  }, [activeEntryRef, notifyStudyActivity])
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

  const contextValue = React.useMemo<GlobalTimerActions>(
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

    if (command.type === 'openTimerSettings') {
      setSettingsOpen(true)
      return
    }

    if (command.type === 'promptBreak') {
      if (config.promptOnWindowLeave) {
        scheduleBreakPrompt(config, currentBreakState)
      }
      return
    }

    if (command.type === 'returnToStudy') {
      returnToStudy()
      return
    }

    if (command.type === 'startBreak') {
      currentActiveEntry?.timer.logEvent('break_start', {
        source: 'legacy_break_prompt',
        planned_minutes: command.minutes,
      })
      startBreakCountdown(command.minutes)
      return
    }

    if (command.type === 'continueRound') {
      if (!currentActiveEntry) return
      const rule = getTimerFocusRule(currentActiveEntry.scene, focusConfig)
      const goalSeconds = Math.max(60, Math.round(rule.primaryMinutes * 60))
      const roundElapsedSeconds = Math.max(
        0,
        currentActiveEntry.timer.effectiveSeconds -
          currentActiveEntry.timer.focusRound.startedAtEffectiveSeconds,
      )
      if (roundElapsedSeconds < goalSeconds) return
      currentActiveEntry.timer.startNextFocusRound({ source: 'goal_continue' })
      return
    }

    if (command.type === 'startGoalBreak') {
      if (!currentActiveEntry) return
      const rule = getTimerFocusRule(currentActiveEntry.scene, focusConfig)
      const goalSeconds = Math.max(60, Math.round(rule.primaryMinutes * 60))
      const roundElapsedSeconds = Math.max(
        0,
        currentActiveEntry.timer.effectiveSeconds -
          currentActiveEntry.timer.focusRound.startedAtEffectiveSeconds,
      )
      if (roundElapsedSeconds < goalSeconds) return
      const minutes = Math.max(1, Math.round(command.minutes ?? rule.breakMinutes ?? 5))
      currentActiveEntry.timer.logEvent('break_start', {
        source: 'focus_goal',
        planned_minutes: minutes,
        round_index: currentActiveEntry.timer.focusRound.roundIndex,
      })
      currentActiveEntry.timer.startNextFocusRound({ source: 'focus_goal_break' })
      startBreakCountdown(minutes)
      return
    }

    if (command.type === 'startStudy') {
      if (!currentActiveEntry) return
      currentActiveEntry.timer.logEvent('break_end', {
        source: 'manual_start_study',
        break_status: currentBreakState.status,
      })
      finishBreak()
      if (currentActiveEntry.timer.status === 'paused') {
        currentActiveEntry.timer.resume({ source: 'break_complete_manual' })
      } else if (currentActiveEntry.timer.status === 'idle') {
        currentActiveEntry.timer.start({ source: 'break_complete_manual' })
      }
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
      currentActiveEntry?.timer.logEvent('break_end', {
        source: 'manual_finish_break',
        break_status: currentBreakState.status,
      })
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
  }, [
    activeEntryRef,
    breakConfigRef,
    breakPausedRef,
    breakPausedRemainingRef,
    breakStateRef,
    finishBreak,
    focusConfig,
    openTarget,
    returnToStudy,
    scheduleBreakPrompt,
    setBreakPaused,
    setBreakPausedRemainingMs,
    setBreakState,
    startBreakCountdown,
  ])

  const timerSnapshot = React.useMemo(() => {
    if (
      breakState.status === 'prompting' ||
      breakState.status === 'counting_down' ||
      breakState.status === 'expired'
    ) {
      // The state object changes only on transitions; the tick forces countdown snapshots to refresh.
      void breakTick
      return buildBreakTimerSnapshot({
        breakState,
        config: breakConfig,
        paused: breakPaused,
        pausedRemainingMs: breakPausedRemainingMs,
        targetPath: breakReturnPath,
      })
    }
    return buildStudyTimerSnapshot({
      activeEntry,
      focusConfig,
      automationConfig,
      feedbackSignal,
    })
  }, [activeEntry, automationConfig, breakConfig, breakPaused, breakPausedRemainingMs, breakReturnPath, breakState, breakTick, feedbackSignal, focusConfig])

  useDesktopTimerBridgeSync({
    timerSnapshot,
    handleTimerCommand,
    activeEntryRef,
  })

  return (
    <GlobalTimerActionsContext.Provider value={contextValue}>
      {children}
      {showInPageTimerOverlay ? (
        <GlobalTimerFloatingOverlay
          entries={Object.values(entries)}
          snapshot={timerSnapshot}
          onCommand={handleTimerCommand}
        />
      ) : null}
      <TimerAutomationDialog
        open={settingsOpen}
        config={automationConfig}
        focusConfig={focusConfig}
        breakConfig={breakConfig}
        onOpenChange={setSettingsOpen}
        onSave={(nextConfig) => setAutomationConfig(saveTimerAutomationConfig(nextConfig))}
        onFocusConfigSave={(nextConfig) => setFocusConfig(saveTimerFocusConfig(nextConfig))}
        onBreakConfigSave={(nextConfig) => saveBreakGuardConfig(nextConfig)}
        onReset={() => {
          setAutomationConfig(resetTimerAutomationConfig())
          setFocusConfig(resetTimerFocusConfig())
          resetBreakGuardConfig()
        }}
      />    </GlobalTimerActionsContext.Provider>
  )
}

export { useGlobalTimerRegistration } from '@/shared/components/session/globalTimerContext'
