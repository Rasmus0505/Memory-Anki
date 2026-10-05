import * as React from 'react'
import { useLocation } from 'react-router-dom'
import { useGlobalTimerRegistration } from '@/shared/components/session/globalTimerContext'
import type { TimerFocusScene } from '@/shared/components/session/timer-scenes'
import { useTimedSession } from '@/modules/session/domain/session-entity/model/timed-session/timedSessionStateMachine'
import {
  peekDwellFragmentOverride,
  subscribeDwellFragmentOverrides,
} from '@/modules/session/domain/session-entity/model/timed-session/dwellFragmentOverride'
import {
  DWELL_LIVE_SESSION_KEY,
  applyDwellFragmentOverride,
  dwellKindToSessionKind,
  resolveDwellFragment,
} from '@/modules/session/domain/session-entity/model/timed-session/dwellPolicy'

function toFocusScene(scene: string): TimerFocusScene {
  return scene as TimerFocusScene
}

export function AppDwellSession() {
  const location = useLocation()
  const routeFragment = React.useMemo(
    () => resolveDwellFragment(`${location.pathname}${location.search}`),
    [location.pathname, location.search],
  )
  const override = React.useSyncExternalStore(
    subscribeDwellFragmentOverrides,
    peekDwellFragmentOverride,
    peekDwellFragmentOverride,
  )
  const fragment = React.useMemo(
    () => applyDwellFragmentOverride(routeFragment, override),
    [override, routeFragment],
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
    // All application routes accept clicks; route changes never start/resume time.
    timer.setSceneActive(true, { source: 'route_activity' })
  }, [fragment.countable, fragment.routePath, timer])

  return null
}
