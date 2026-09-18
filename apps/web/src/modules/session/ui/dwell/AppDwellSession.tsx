import * as React from 'react'
import { useLocation } from 'react-router-dom'
import { useGlobalTimerRegistration } from '@/shared/components/session/globalTimerContext'
import type { TimerFocusScene } from '@/shared/components/session/timer-scenes'
import { useTimedSession } from '@/modules/session/domain/session-entity/model/timed-session/timedSessionStateMachine'
import {
  DWELL_LIVE_SESSION_KEY,
  dwellKindToSessionKind,
  resolveDwellFragment,
} from '@/modules/session/domain/session-entity/model/timed-session/dwellPolicy'

function toFocusScene(scene: string): TimerFocusScene {
  return scene as TimerFocusScene
}

export function AppDwellSession() {
  const location = useLocation()
  const fragment = React.useMemo(
    () => resolveDwellFragment(`${location.pathname}${location.search}`),
    [location.pathname, location.search],
  )
  const options = React.useMemo(() => ({
    sessionKey: DWELL_LIVE_SESSION_KEY,
    kind: dwellKindToSessionKind(fragment.kind),
    title: fragment.title,
    palaceId: fragment.palaceId,
    automationScene: fragment.scene,
    sourceKind: fragment.sourceKind,
    englishCourseId: fragment.englishCourseId,
    persistCompletionRecord: true,
    routePath: fragment.routePath,
  }), [fragment])
  const timer = useTimedSession(options)

  useGlobalTimerRegistration({
    scene: toFocusScene(fragment.scene),
    title: fragment.title,
    timer,
    isRouteActive: true,
    becameActiveAt: 0,
    routePath: fragment.routePath,
    isDwellSession: true,
  })

  React.useEffect(() => {
    const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden'
    if (!fragment.countable) {
      timer.pause({ reason: 'excluded_route', source: 'excluded_route' })
      timer.setSceneActive(false, { source: 'excluded_route' })
      return
    }
    timer.setSceneActive(true, { source: 'countable_route' })
    if (!visible) return
    if (timer.status === 'idle') {
      timer.start({ source: 'dwell_autostart' })
      return
    }
    if (timer.status === 'paused' && timer.pauseReason !== 'manual') {
      timer.resume({ source: 'countable_route' })
    }
  }, [fragment.countable, fragment.routePath, timer])

  return null
}
