import * as React from 'react'
import { getDesktopTimerBridge } from '@/shared/components/session/desktopTimerBridge'
import {
  readTimerAutomationConfig,
  type TimerAutomationActivityKind,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import type { TimedSessionMeta } from './timedSessionModel'

export function clearTimedSessionTimeout(ref: React.MutableRefObject<number | null>) {
  if (ref.current != null) {
    window.clearTimeout(ref.current)
    ref.current = null
  }
}

export function clearTimedSessionInterval(ref: React.MutableRefObject<number | null>) {
  if (ref.current != null) {
    window.clearInterval(ref.current)
    ref.current = null
  }
}

interface TimedSessionBrowserPauseOptions {
  sceneActiveRef: React.MutableRefObject<boolean>
  statusRef: React.MutableRefObject<string>
  hiddenPauseRef: React.MutableRefObject<number | null>
  autoPauseRef: React.MutableRefObject<number | null>
  tickerRef: React.MutableRefObject<number | null>
  hiddenPauseMs: number
  pause: (meta?: TimedSessionMeta) => void
  registerActivity: (
    activityKind: TimerAutomationActivityKind,
    meta?: TimedSessionMeta,
  ) => void
  clearTimer: (ref: React.MutableRefObject<number | null>) => void
  clearIntervalTimer: (ref: React.MutableRefObject<number | null>) => void
}

export function useTimedSessionBrowserPauseEffects({
  sceneActiveRef,
  statusRef,
  hiddenPauseRef,
  autoPauseRef,
  tickerRef,
  hiddenPauseMs,
  pause,
  registerActivity,
  clearTimer,
  clearIntervalTimer,
}: TimedSessionBrowserPauseOptions) {
  React.useEffect(() => {
    const handleVisibility = () => {
      if (!sceneActiveRef.current) {
        clearTimer(hiddenPauseRef)
        return
      }
      if (document.visibilityState === 'hidden') {
        clearTimer(hiddenPauseRef)
        hiddenPauseRef.current = window.setTimeout(() => {
          pause({ reason: 'hidden' })
        }, hiddenPauseMs)
        return
      }
      clearTimer(hiddenPauseRef)
      if (statusRef.current === 'paused') {
        registerActivity('window_return', { reason: 'visible' })
      }
    }

    const handleBlur = () => {
      if (!sceneActiveRef.current) {
        clearTimer(hiddenPauseRef)
        return
      }
      clearTimer(hiddenPauseRef)
      hiddenPauseRef.current = window.setTimeout(() => {
        pause({ reason: 'blur' })
      }, hiddenPauseMs)
    }

    const handleFocus = () => {
      clearTimer(hiddenPauseRef)
      if (!sceneActiveRef.current) {
        return
      }
      if (statusRef.current === 'paused') {
        registerActivity('window_return', { reason: 'focus' })
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('focus', handleFocus)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('focus', handleFocus)
      clearTimer(hiddenPauseRef)
      clearTimer(autoPauseRef)
      clearIntervalTimer(tickerRef)
    }
  }, [
    autoPauseRef,
    clearIntervalTimer,
    clearTimer,
    hiddenPauseMs,
    hiddenPauseRef,
    pause,
    registerActivity,
    sceneActiveRef,
    statusRef,
    tickerRef,
  ])
}

export function useTimedSessionAutomationConfigSubscription(
  setAutomationConfig: React.Dispatch<React.SetStateAction<TimerAutomationConfig>>,
) {
  React.useEffect(() => {
    const handleAutomationChange = (event: Event) => {
      const nextConfig =
        event instanceof CustomEvent && event.detail
          ? (event.detail as TimerAutomationConfig)
          : readTimerAutomationConfig()
      setAutomationConfig(nextConfig)
    }

    window.addEventListener('memory-anki-timer-automation-change', handleAutomationChange)
    return () => {
      window.removeEventListener('memory-anki-timer-automation-change', handleAutomationChange)
    }
  }, [setAutomationConfig])
}

export function useTimedSessionGlowReset(
  glowState: string,
  setGlowState: React.Dispatch<React.SetStateAction<'idle' | 'running' | 'paused'>>,
) {
  React.useEffect(() => {
    if (glowState === 'idle') return
    const timer = window.setTimeout(() => setGlowState('idle'), 1000)
    return () => window.clearTimeout(timer)
  }, [glowState, setGlowState])
}

export function useTimedSessionUnloadPersistence(
  _storageKey: string | null,
  leaveScene: (meta?: TimedSessionMeta) => Promise<unknown>,
) {
  React.useEffect(() => {
    let pendingLeave: Promise<unknown> | null = null
    const persistOnce = (source: string) => {
      if (!pendingLeave) {
        pendingLeave = leaveScene({ source }).finally(() => {
          pendingLeave = null
        })
      }
      return pendingLeave
    }
    const handlePersistOnUnload = (event: Event) => {
      const source = event.type === 'pagehide' ? 'pagehide' : 'beforeunload'
      void persistOnce(source)
    }
    const bridge = getDesktopTimerBridge()
    const unsubscribeDesktopFlush = bridge?.onDesktopFlushRequest?.((request) =>
      persistOnce(request.reason ?? 'desktop_flush'),
    )
    window.addEventListener('beforeunload', handlePersistOnUnload)
    window.addEventListener('pagehide', handlePersistOnUnload)
    return () => {
      unsubscribeDesktopFlush?.()
      window.removeEventListener('beforeunload', handlePersistOnUnload)
      window.removeEventListener('pagehide', handlePersistOnUnload)
    }
  }, [leaveScene])
}
