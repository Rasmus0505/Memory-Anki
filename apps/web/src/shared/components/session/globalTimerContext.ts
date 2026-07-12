import * as React from 'react'
import type { GlobalTimerRegistration } from '@/shared/components/session/globalTimerModel'
import type { TimerFocusScene } from '@/shared/components/session/timer-focus-config'
import type { TimedSessionController } from '@/shared/hooks/useTimedSession'

export interface GlobalTimerActions {
  upsertTimer: (entry: GlobalTimerRegistration) => void
  removeTimer: (sessionId: string) => void
  notifyStudyActivity: (sessionId: string) => boolean
}

export const GlobalTimerActionsContext = React.createContext<GlobalTimerActions | null>(null)

export function useGlobalTimerRegistration(entry: {
  scene: TimerFocusScene
  title: string
  timer: TimedSessionController
  isRouteActive: boolean
  becameActiveAt: number
  routePath?: string
}) {
  const context = React.useContext(GlobalTimerActionsContext)
  const {
    scene,
    title,
    timer,
    isRouteActive,
    becameActiveAt,
    routePath,
  } = entry

  const registeredTimer = React.useMemo<TimedSessionController>(() => ({
    ...timer,
    registerActivity: () => undefined,
  }), [timer])

  React.useEffect(() => {
    if (!context) return
    context.upsertTimer({
      sessionId: timer.sessionId,
      scene,
      title,
      timer,
      isRouteActive,
      becameActiveAt,
      routePath:
        routePath ??
        (typeof window === 'undefined'
          ? ''
          : `${window.location.pathname}${window.location.search}${window.location.hash}`),
    })
    return () => {
      context.removeTimer(timer.sessionId)
    }
  }, [becameActiveAt, context, isRouteActive, routePath, scene, timer, title])

  return registeredTimer
}
