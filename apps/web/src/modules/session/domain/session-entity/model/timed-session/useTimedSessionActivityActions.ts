import * as React from 'react'
import type { SessionEventRecord } from '../session-records'
import type { SessionStatus, TimedSessionMeta } from '@/shared/hooks/timedSessionModel'

type MutableValueRef<T> = { current: T }

type SessionTransition = (meta?: TimedSessionMeta) => unknown

interface TimedSessionActivityActionsInput {
  armAutoPause: () => void
  lastActivityAtRef: MutableValueRef<number | null>
  pushEvent: (type: SessionEventRecord['type'], meta?: TimedSessionMeta) => void
  resume: SessionTransition
  sceneActiveRef: MutableValueRef<boolean>
  start: SessionTransition
  statusRef: MutableValueRef<SessionStatus>
}

export function useTimedSessionActivityActions({
  armAutoPause,
  lastActivityAtRef,
  pushEvent,
  resume,
  sceneActiveRef,
  start,
  statusRef,
}: TimedSessionActivityActionsInput) {
  // Activity is deliberately not part of the live timer contract. Keep this
  // compatibility hook for old imports, but never start/resume or alter time.
  const registerActivity = React.useCallback((...args: unknown[]) => {
    void args
    void armAutoPause
    void lastActivityAtRef
    void resume
    void sceneActiveRef
    void start
    void statusRef
  }, [armAutoPause, lastActivityAtRef, resume, sceneActiveRef, start, statusRef])

  const logEvent = React.useCallback((type: SessionEventRecord['type'], meta?: TimedSessionMeta) => {
    pushEvent(type, meta)
  }, [pushEvent])

  return { logEvent, registerActivity }
}
