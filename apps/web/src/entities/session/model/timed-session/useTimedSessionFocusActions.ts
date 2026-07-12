import * as React from 'react'
import type { SessionEventRecord } from '../session-records'
import {
  DEFAULT_TIMED_SESSION_FOCUS_ROUND,
  type TimedSessionFocusRoundState,
  type TimedSessionMeta,
} from '@/shared/hooks/timedSessionModel'
import { markDirty } from '@/shared/persistence/autosaveCoordinator'

type MutableValueRef<T> = { current: T }

type PushTimedSessionEvent = (
  type: SessionEventRecord['type'],
  meta?: TimedSessionMeta,
) => void

interface TimedSessionFocusActionsInput {
  autoSaveKey: string
  durationEditedRef: MutableValueRef<boolean>
  effectiveSecondsRef: MutableValueRef<number>
  focusRoundRef: MutableValueRef<TimedSessionFocusRoundState>
  persistSnapshot: () => void
  pushEvent: PushTimedSessionEvent
  setDurationEdited: React.Dispatch<React.SetStateAction<boolean>>
  setEffectiveSeconds: React.Dispatch<React.SetStateAction<number>>
  setFocusRound: React.Dispatch<React.SetStateAction<TimedSessionFocusRoundState>>
}

export function useTimedSessionFocusActions({
  autoSaveKey,
  durationEditedRef,
  effectiveSecondsRef,
  focusRoundRef,
  persistSnapshot,
  pushEvent,
  setDurationEdited,
  setEffectiveSeconds,
  setFocusRound,
}: TimedSessionFocusActionsInput) {
  const acknowledgeFocusInterval = React.useCallback((count: number, meta?: TimedSessionMeta) => {
    const safeCount = Math.max(0, Math.round(count))
    if (safeCount <= focusRoundRef.current.acknowledgedIntervalCount) return
    const next = {
      ...focusRoundRef.current,
      acknowledgedIntervalCount: safeCount,
    }
    focusRoundRef.current = next
    setFocusRound(next)
    pushEvent('focus_interval_complete', {
      round_index: next.roundIndex,
      interval_count: safeCount,
      ...(meta ?? {}),
    })
    markDirty(autoSaveKey, 'focus_interval_complete')
  }, [autoSaveKey, focusRoundRef, pushEvent, setFocusRound])

  const acknowledgeFocusGoal = React.useCallback((meta?: TimedSessionMeta) => {
    if (focusRoundRef.current.goalCelebrated) return
    const next = {
      ...focusRoundRef.current,
      goalCelebrated: true,
    }
    focusRoundRef.current = next
    setFocusRound(next)
    pushEvent('focus_round_complete', {
      round_index: next.roundIndex,
      ...(meta ?? {}),
    })
    markDirty(autoSaveKey, 'focus_round_complete')
  }, [autoSaveKey, focusRoundRef, pushEvent, setFocusRound])

  const startNextFocusRound = React.useCallback((meta?: TimedSessionMeta) => {
    const next: TimedSessionFocusRoundState = {
      roundIndex: focusRoundRef.current.roundIndex + 1,
      startedAtEffectiveSeconds: effectiveSecondsRef.current,
      acknowledgedIntervalCount: 0,
      goalCelebrated: false,
    }
    focusRoundRef.current = next
    setFocusRound(next)
    pushEvent('focus_round_continue', {
      round_index: next.roundIndex,
      started_at_effective_seconds: next.startedAtEffectiveSeconds,
      ...(meta ?? {}),
    })
    markDirty(autoSaveKey, 'focus_round_continue')
  }, [autoSaveKey, effectiveSecondsRef, focusRoundRef, pushEvent, setFocusRound])

  const adjustDuration = React.useCallback((seconds: number) => {
    effectiveSecondsRef.current = Math.max(0, Math.round(seconds))
    setEffectiveSeconds(effectiveSecondsRef.current)
    if (focusRoundRef.current.startedAtEffectiveSeconds > effectiveSecondsRef.current) {
      const next = { ...DEFAULT_TIMED_SESSION_FOCUS_ROUND }
      focusRoundRef.current = next
      setFocusRound(next)
    }
    setDurationEdited(true)
    durationEditedRef.current = true
    pushEvent('adjust_duration', { seconds: effectiveSecondsRef.current })
    persistSnapshot()
    markDirty(autoSaveKey, 'adjust_duration')
  }, [
    autoSaveKey,
    durationEditedRef,
    effectiveSecondsRef,
    focusRoundRef,
    persistSnapshot,
    pushEvent,
    setDurationEdited,
    setEffectiveSeconds,
    setFocusRound,
  ])

  return {
    acknowledgeFocusGoal,
    acknowledgeFocusInterval,
    adjustDuration,
    startNextFocusRound,
  }
}