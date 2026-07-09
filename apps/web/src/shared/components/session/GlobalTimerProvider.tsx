import * as React from 'react'
import { GlobalTimerFloatingOverlay } from '@/shared/components/session/GlobalTimerFloatingOverlay'
import {
  readTimerAutomationConfig,
  TIMER_AUTOMATION_UPDATED_EVENT,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import { onAppEvent } from '@/shared/events/appEvents'
import {
  readTimerFocusConfig,
  TIMER_FOCUS_UPDATED_EVENT,
  type TimerFocusConfig,
} from '@/shared/components/session/timer-focus-config'
import {
  getDesktopTimerBridge,
  hasDesktopTimerBridge,
  type UnifiedTimerCommand,
} from '@/shared/components/session/desktopTimerBridge'
import { updateBreakGuardLog } from '@/shared/components/session/break-guard-config'
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
import {
  GlobalTimerActionsContext,
  type GlobalTimerActions,
} from '@/shared/components/session/globalTimerContext'

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
        paused: breakPaused,
        pausedRemainingMs: breakPausedRemainingMs,
        targetPath: breakReturnPath,
      })
    }
    return buildStudyTimerSnapshot({
      activeEntry,
      focusConfig,
      automationConfig,
    })
  }, [activeEntry, automationConfig, breakConfig, breakPaused, breakPausedRemainingMs, breakReturnPath, breakState, breakTick, focusConfig])

  useDesktopTimerBridgeSync({
    timerSnapshot,
    handleTimerCommand,
    activeEntryRef,
    scheduleBreakPrompt,
    breakConfigRef,
    breakStateRef,
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
    </GlobalTimerActionsContext.Provider>
  )
}

export { useGlobalTimerRegistration } from '@/shared/components/session/globalTimerContext'
