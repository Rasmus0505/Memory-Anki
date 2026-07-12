import * as React from 'react'
import type { TimedSessionController } from '@/shared/hooks/timedSessionModel'

function controllerChanged(
  previous: TimedSessionController,
  current: TimedSessionController,
) {
  return (Object.keys(current) as Array<keyof TimedSessionController>)
    .some((key) => previous[key] !== current[key])
}

export function useStableTimedSessionController(
  controller: TimedSessionController,
) {
  const controllerRef = React.useRef(controller)
  if (controllerChanged(controllerRef.current, controller)) {
    controllerRef.current = controller
  }
  return controllerRef.current
}