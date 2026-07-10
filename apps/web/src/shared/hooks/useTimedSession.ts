import { getWeeklyLocalSessionStats } from '@/entities/session/model'
import { useTimedSession as useTimedSessionStateMachine } from '@/entities/session/model/timed-session/timedSessionStateMachine'
import type { TimedSessionController, TimedSessionOptions } from './timedSessionModel'

export type { TimedSessionController, TimedSessionOptions } from './timedSessionModel'

export function useTimedSession(options: TimedSessionOptions): TimedSessionController {
  return useTimedSessionStateMachine(options)
}

export { getWeeklyLocalSessionStats }
export { shouldAutoStartOnPageEnter } from '@/shared/components/session/timer-automation-config'
