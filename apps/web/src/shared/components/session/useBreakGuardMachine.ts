import * as React from 'react'
import { getDesktopTimerBridge } from '@/shared/components/session/desktopTimerBridge'
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
  IDLE_BREAK_GUARD_STATE,
  shouldPromptForBreakGuard,
  type BreakGuardState,
} from '@/shared/components/session/breakGuardModel'
import type { GlobalTimerRegistration } from '@/shared/components/session/globalTimerModel'
import { createBreakLogId } from '@/shared/components/session/timerSnapshotBuilders'

export function useBreakGuardMachine({
  activeEntry,
  entries,
}: {
  activeEntry: GlobalTimerRegistration | null
  entries: Record<string, GlobalTimerRegistration>
}) {
  const [breakConfig, setBreakConfig] = React.useState<BreakGuardConfig>(() => readBreakGuardConfig())
  const [breakState, setBreakState] = React.useState<BreakGuardState>(IDLE_BREAK_GUARD_STATE)
  const [breakPaused, setBreakPaused] = React.useState(false)
  const [breakPausedRemainingMs, setBreakPausedRemainingMs] = React.useState<number | null>(null)
  const [breakInterruptedSessionId, setBreakInterruptedSessionId] = React.useState<string | null>(null)
  const [breakReturnPath, setBreakReturnPath] = React.useState<string | null>(null)
  const [breakTick, setBreakTick] = React.useState(0)
  const promptTimerRef = React.useRef<number | null>(null)
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
    if (breakConfigRef.current.alertStrength !== 'strong') return
    const autoOpenKey = `${breakState.startedAt ?? 'idle'}:${breakState.snoozeCount}`
    if (breakAutoOpenedKeyRef.current === autoOpenKey) return
    const bridge = getDesktopTimerBridge()
    if (!bridge?.openMainTarget) return
    breakAutoOpenedKeyRef.current = autoOpenKey
    bridge.openMainTarget(sanitizeTargetPath(breakReturnPathRef.current))
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
    const handleBreakConfigChange = (event: Event) => {
      const nextConfig =
        event instanceof CustomEvent && event.detail
          ? (event.detail as BreakGuardConfig)
          : readBreakGuardConfig()
      setBreakConfig(nextConfig)
    }

    window.addEventListener(BREAK_GUARD_UPDATED_EVENT, handleBreakConfigChange)
    return () => {
      window.removeEventListener(BREAK_GUARD_UPDATED_EVENT, handleBreakConfigChange)
    }
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
    }
  }, [])

  const openTarget = React.useCallback((targetPath: string) => {
    const safePath = sanitizeTargetPath(targetPath)
    if (window.location.pathname === safePath) return
    window.location.assign(safePath)
  }, [])

  const clearInterruptedStudy = React.useCallback(() => {
    breakInterruptedSessionIdRef.current = null
    breakReturnPathRef.current = null
    setBreakInterruptedSessionId(null)
    setBreakReturnPath(null)
  }, [])

  const finishBreak = React.useCallback((options?: { openTarget?: boolean }) => {
    const current = breakStateRef.current
    const config = breakConfigRef.current
    if (current.logId) {
      updateBreakGuardLog(current.logId, {
        endedAt: new Date().toISOString(),
        overtime: current.status === 'expired',
        snoozeCount: current.snoozeCount,
      })
    }
    setBreakPaused(false)
    setBreakPausedRemainingMs(null)
    clearInterruptedStudy()
    setBreakState(IDLE_BREAK_GUARD_STATE)
    if (options?.openTarget) {
      openTarget(config.targetPath)
    }
  }, [clearInterruptedStudy, openTarget])

  const clearPendingBreakPrompt = React.useCallback(() => {
    if (promptTimerRef.current == null) return
    window.clearTimeout(promptTimerRef.current)
    promptTimerRef.current = null
  }, [])

  const pauseActiveStudyForBreakGuard = React.useCallback(() => {
    const currentActiveEntry = activeEntryRef.current
    if (currentActiveEntry?.timer.status !== 'running') return
    currentActiveEntry.timer.pause({ source: 'break_guard_prompt' })
    breakInterruptedSessionIdRef.current = currentActiveEntry.timer.sessionId
    breakReturnPathRef.current = currentActiveEntry.routePath
    setBreakInterruptedSessionId(currentActiveEntry.timer.sessionId)
    setBreakReturnPath(currentActiveEntry.routePath)
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
    const interruptedSessionId =
      breakInterruptedSessionIdRef.current ??
      (currentActiveEntry?.timer.status === 'running' ? currentActiveEntry.timer.sessionId : null)
    const returnPath = breakReturnPathRef.current ?? currentActiveEntry?.routePath ?? null
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
    breakReturnPathRef.current = returnPath
    setBreakInterruptedSessionId(interruptedSessionId)
    setBreakReturnPath(returnPath)
    setBreakState(createBreakGuardCountdown(safeMinutes, Date.now(), logId))
  }, [clearPendingBreakPrompt])

  const endBreakAndResumeStudy = React.useCallback((entry: GlobalTimerRegistration | null) => {
    if (!entry?.isRouteActive) return false

    clearPendingBreakPrompt()
    const config = breakConfigRef.current
    const currentBreakState = breakStateRef.current
    if (currentBreakState.status === 'idle' || currentBreakState.status === 'dismissed') return true

    if (currentBreakState.status === 'prompting') {
      resumeInterruptedStudyAfterPromptCancel(entry)
      setBreakPaused(false)
      setBreakPausedRemainingMs(null)
      setBreakState(IDLE_BREAK_GUARD_STATE)
      clearInterruptedStudy()
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
      clearInterruptedStudy()
      return true
    }

    return false
  }, [clearInterruptedStudy, clearPendingBreakPrompt, resumeInterruptedStudyAfterBreak, resumeInterruptedStudyAfterPromptCancel])

  const returnToStudy = React.useCallback(() => {
    const currentBreakState = breakStateRef.current
    if (currentBreakState.status === 'idle' || currentBreakState.status === 'dismissed') {
      clearPendingBreakPrompt()
      resumeInterruptedStudyAfterPromptCancel(activeEntryRef.current)
      clearInterruptedStudy()
      return
    }
    endBreakAndResumeStudy(activeEntryRef.current)
  }, [clearInterruptedStudy, clearPendingBreakPrompt, endBreakAndResumeStudy, resumeInterruptedStudyAfterPromptCancel])

  const notifyStudyActivity = React.useCallback((sessionId: string) => {
    const entry = entriesRef.current[sessionId]
    if (!entry?.isRouteActive) return false
    return endBreakAndResumeStudy(entry)
  }, [endBreakAndResumeStudy])

  return {
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
  }
}

function sanitizeTargetPath(targetPath: string | null | undefined) {
  return targetPath && targetPath.startsWith('/') && !targetPath.startsWith('//')
    ? targetPath
    : '/freestyle'
}
