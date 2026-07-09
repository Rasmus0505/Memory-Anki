import * as React from 'react'
import type { GlobalTimerRegistration } from '@/shared/components/session/globalTimerModel'
import type { TimerFocusScene } from '@/shared/components/session/timer-focus-config'
import type { TimedSessionController } from '@/shared/hooks/useTimedSession'

export interface GlobalTimerActions {
  upsertTimer: (entry: GlobalTimerRegistration) => void
  removeTimer: (sessionId: string) => void
  notifyStudyActivity: (sessionId: string) => void
}

export const GlobalTimerActionsContext = React.createContext<GlobalTimerActions | null>(null)

export function useGlobalTimerRegistration(entry: {
  scene: TimerFocusScene
  title: string
  timer: TimedSessionController
  isRouteActive: boolean
  becameActiveAt: number
}) {
  const context = React.useContext(GlobalTimerActionsContext)
  const {
    scene,
    title,
    timer,
    isRouteActive,
    becameActiveAt,
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
    })
    return () => {
      context.removeTimer(timer.sessionId)
    }
  }, [becameActiveAt, context, isRouteActive, registeredTimer, scene, timer.sessionId, title])

  return registeredTimer
}
