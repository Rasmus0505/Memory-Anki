import * as React from 'react'
import { getDesktopTimerBridge } from '@/shared/components/session/desktopTimerBridge'
import {
  readTimerAutomationConfig,
  TIMER_AUTOMATION_UPDATED_EVENT,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import { onAppEvent } from '@/shared/events/appEvents'
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
  /**
   * Soft pause while the window is blurred but still visible (desktop alt-tab,
   * keyboard, sheets). Does not write a completed time record.
   */
  pause: (meta?: TimedSessionMeta) => void
  /**
   * Persist + suspend when the page is truly backgrounded. Critical for PWA:
   * pagehide is unreliable, and without a desktop flush bridge backgrounding
   * would otherwise leave only status=active autosave checkpoints (hidden from
   * the completed time-record list).
   */
  leaveScene: (meta?: TimedSessionMeta) => Promise<unknown>
  /**
   * Immediately stop wall-clock accrual when the document hides. Mobile PWA
   * freezes setTimeout/setInterval; leave debounces must not be the only
   * correctness path or hang-up time is credited on the next tick.
   */
  freezeClockOnDocumentHidden: (meta?: TimedSessionMeta) => void
  /**
   * Crash-safe snapshot written the instant the page hides, before the debounce
   * window opens. Backgrounding and leaving the scene are deliberately
   * decoupled: waiting out `hiddenPauseMs` before persisting would lose the
   * session if the OS killed the tab mid-window, but persisting without pausing
   * costs nothing — the eventual record overwrites this one by id.
   */
  persistBackgroundCheckpoint: () => void
  /**
   * Decide brief-dip resume vs durable leave using wall-clock time spent hidden.
   * Must not rely on background timers having fired.
   */
  resolveVisibilityReturn: (meta?: TimedSessionMeta) => void
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
  leaveScene,
  freezeClockOnDocumentHidden,
  persistBackgroundCheckpoint,
  resolveVisibilityReturn,
  clearTimer,
  clearIntervalTimer,
}: TimedSessionBrowserPauseOptions) {
  // Only auto-resume after a visibility leave if the study route was active when
  // the page hid. Route leave already clears sceneActive; do not revive that session.
  const shouldResumeAfterVisibilityRef = React.useRef(false)

  React.useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (!sceneActiveRef.current) {
          clearTimer(hiddenPauseRef)
          shouldResumeAfterVisibilityRef.current = false
          return
        }
        shouldResumeAfterVisibilityRef.current = true
        clearTimer(hiddenPauseRef)
        // Freeze first: hidden gaps must never enter effectiveSeconds, even if
        // the grace setTimeout is delayed or cancelled by a later visible event.
        freezeClockOnDocumentHidden({ reason: 'document_hidden' })
        if (hiddenPauseMs <= 0) {
          // Immediate leave writes left_page; no intermediate saved checkpoint.
          void leaveScene({ reason: 'document_hidden' })
          return
        }
        // Crash-safe checkpoint during the grace window only. leaveScene will
        // overwrite the same record id when grace expires or return exceeds it.
        if (statusRef.current === 'running' || statusRef.current === 'paused') {
          persistBackgroundCheckpoint()
        }
        // Best-effort leave while backgrounded. Correctness on return is handled
        // by resolveVisibilityReturn with wall-clock grace (timers may freeze).
        hiddenPauseRef.current = window.setTimeout(() => {
          void leaveScene({ reason: 'document_hidden' })
        }, hiddenPauseMs)
        return
      }
      // Foreground: cancel pending leave and resolve freeze/leave with wall clock.
      clearTimer(hiddenPauseRef)
      if (shouldResumeAfterVisibilityRef.current) {
        shouldResumeAfterVisibilityRef.current = false
        resolveVisibilityReturn({ source: 'document_visible' })
      }
    }

    const handleBlur = () => {
      if (!sceneActiveRef.current) {
        clearTimer(hiddenPauseRef)
        return
      }
      clearTimer(hiddenPauseRef)
      hiddenPauseRef.current = window.setTimeout(() => {
        // True background (tab/app hidden): durable leave. Soft blur only: pause.
        if (document.visibilityState === 'hidden') {
          shouldResumeAfterVisibilityRef.current = true
          freezeClockOnDocumentHidden({ reason: 'window_blur_hidden' })
          void leaveScene({ reason: 'window_blur_hidden' })
          return
        }
        pause({ reason: 'window_blur' })
      }, hiddenPauseMs)
    }

    const handleFocus = () => {
      clearTimer(hiddenPauseRef)
      // Soft pause stays paused (autoResumeOnWindowReturn is separate). Visibility
      // leave recovery is handled by visibilitychange → document_visible.
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
    freezeClockOnDocumentHidden,
    hiddenPauseMs,
    hiddenPauseRef,
    leaveScene,
    pause,
    persistBackgroundCheckpoint,
    resolveVisibilityReturn,
    sceneActiveRef,
    statusRef,
    tickerRef,
  ])
}

export function useTimedSessionAutomationConfigSubscription(
  setAutomationConfig: React.Dispatch<React.SetStateAction<TimerAutomationConfig>>,
) {
  React.useEffect(() => {
    return onAppEvent(TIMER_AUTOMATION_UPDATED_EVENT, (detail) => {
      const nextConfig = detail || readTimerAutomationConfig()
      setAutomationConfig(nextConfig)
    })
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
