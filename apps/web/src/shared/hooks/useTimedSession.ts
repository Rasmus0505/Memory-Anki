import { getWeeklyLocalSessionStats } from '@/modules/session/public'
import { useTimedSession as useTimedSessionStateMachine } from '@/modules/session/public'
import type { TimedSessionController, TimedSessionOptions } from './timedSessionModel'

export type { TimedSessionController, TimedSessionOptions } from './timedSessionModel'

export function useTimedSession(options: TimedSessionOptions): TimedSessionController {
  return useTimedSessionStateMachine(options)
}

export { getWeeklyLocalSessionStats }
export { shouldAutoStartOnPageEnter } from '@/shared/components/session/timer-automation-config'
