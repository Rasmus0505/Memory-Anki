import * as React from 'react'
import {
  type UnifiedTimerFeedbackSignal,
} from '@/shared/components/session/desktopTimerBridge'
import type { GlobalTimerRegistration } from '@/shared/components/session/globalTimerModel'
import {
  getTimerFocusRule,
  type TimerFocusConfig,
} from '@/shared/components/session/timer-focus-config'

export function useTimerFocusCycle(
  activeEntry: GlobalTimerRegistration | null,
  focusConfig: TimerFocusConfig,
) {
  const [feedbackSignal, setFeedbackSignal] = React.useState<UnifiedTimerFeedbackSignal | null>(null)

  React.useEffect(() => {
    setFeedbackSignal(null)
  }, [activeEntry?.sessionId])

  React.useEffect(() => {
    if (!activeEntry || activeEntry.timer.status === 'idle' || activeEntry.timer.status === 'completed') {
      return
    }

    const focusRule = getTimerFocusRule(activeEntry.scene, focusConfig)
    const goalSeconds = Math.max(60, Math.round(focusRule.primaryMinutes * 60))
    const intervalSeconds = Math.max(
      60,
      Math.min(goalSeconds, Math.round(focusRule.secondaryMinutes * 60)),
    )
    const roundState = activeEntry.timer.focusRound
    const roundElapsedSeconds = Math.max(
      0,
      activeEntry.timer.effectiveSeconds - roundState.startedAtEffectiveSeconds,
    )
    if (roundElapsedSeconds >= goalSeconds) {
      if (roundState.goalCelebrated) return
      activeEntry.timer.acknowledgeFocusGoal({
        source: 'focus_cycle',
        goal_seconds: goalSeconds,
      })
      setFeedbackSignal({
        eventId: `${activeEntry.sessionId}:round:${roundState.roundIndex}:goal`,
        kind: 'goal',
        ordinal: roundState.roundIndex,
        roundIndex: roundState.roundIndex,
        occurredAt: Date.now(),
      })
      return
    }

    const intervalCount = Math.min(
      Math.floor(roundElapsedSeconds / intervalSeconds),
      Math.floor(Math.max(0, goalSeconds - 1) / intervalSeconds),
    )
    if (intervalCount <= roundState.acknowledgedIntervalCount) return

    activeEntry.timer.acknowledgeFocusInterval(intervalCount, {
      source: 'focus_cycle',
      interval_seconds: intervalSeconds,
    })
    setFeedbackSignal({
      eventId: `${activeEntry.sessionId}:round:${roundState.roundIndex}:interval:${intervalCount}`,
      kind: 'interval',
      ordinal: intervalCount,
      roundIndex: roundState.roundIndex,
      occurredAt: Date.now(),
    })
  }, [activeEntry, focusConfig])

  return feedbackSignal
}
