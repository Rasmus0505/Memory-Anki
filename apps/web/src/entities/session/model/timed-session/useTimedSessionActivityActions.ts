import * as React from 'react'
import type { SessionEventRecord } from '../session-records'
import {
  isActivityEnabled,
  type TimerAutomationActivityKind,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import type { SessionStatus, TimedSessionMeta } from '@/shared/hooks/timedSessionModel'

type MutableValueRef<T> = { current: T }

type SessionTransition = (meta?: TimedSessionMeta) => unknown

interface TimedSessionActivityActionsInput {
  armAutoPause: () => void
  automationConfig: TimerAutomationConfig
  lastActivityAtRef: MutableValueRef<number | null>
  pushEvent: (type: SessionEventRecord['type'], meta?: TimedSessionMeta) => void
  resume: SessionTransition
  sceneActiveRef: MutableValueRef<boolean>
  start: SessionTransition
  statusRef: MutableValueRef<SessionStatus>
}

export function useTimedSessionActivityActions({
  armAutoPause,
  automationConfig,
  lastActivityAtRef,
  pushEvent,
  resume,
  sceneActiveRef,
  start,
  statusRef,
}: TimedSessionActivityActionsInput) {
  const registerActivity = React.useCallback((
    activityKind: TimerAutomationActivityKind,
    meta?: TimedSessionMeta,
  ) => {
    if (!sceneActiveRef.current || !isActivityEnabled(activityKind, automationConfig)) return
    if (statusRef.current === 'idle') {
      start({ source: 'auto', ...(meta ?? {}) })
      return
    }
    if (statusRef.current === 'paused') {
      resume({ source: 'auto', ...(meta ?? {}) })
      return
    }
    if (statusRef.current === 'running') {
      lastActivityAtRef.current = Date.now()
      armAutoPause()
    }
  }, [armAutoPause, automationConfig, lastActivityAtRef, resume, sceneActiveRef, start, statusRef])

  const logEvent = React.useCallback((type: SessionEventRecord['type'], meta?: TimedSessionMeta) => {
    pushEvent(type, meta)
  }, [pushEvent])

  return { logEvent, registerActivity }
}