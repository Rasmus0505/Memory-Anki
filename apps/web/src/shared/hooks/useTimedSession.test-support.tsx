import * as React from 'react'
import { useTimedSession } from '@/shared/hooks/useTimedSession'

export interface TimedSessionTestHarnessProps {
  kind: 'palace_edit' | 'practice' | 'review'
  automationScene?: 'palace_edit' | 'practice' | 'review' | 'english'
  autoPauseMs?: number
  hiddenPauseMs?: number
  persistKey?: string | null
  autoStart?: boolean
  persistCompletionRecord?: boolean
}

export function TimedSessionTestHarness({
  kind,
  automationScene,
  autoPauseMs,
  hiddenPauseMs,
  persistKey = null,
  autoStart = true,
  persistCompletionRecord = true,
}: TimedSessionTestHarnessProps) {
  const timer = useTimedSession({
    kind,
    title: '测试',
    palaceId: 1,
    automationScene,
    autoPauseMs,
    hiddenPauseMs,
    persistKey,
    persistCompletionRecord,
  })

  React.useEffect(() => {
    if (!autoStart) return
    timer.start({ source: 'test' })
    // Start once so later rerenders don't mask pause/resume behavior under test.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

  return (
    <div>
      <div data-testid="status">{timer.status}</div>
      <div data-testid="pause-count">{timer.pauseCount}</div>
      <div data-testid="seconds">{timer.effectiveSeconds}</div>
      <div data-testid="idle-seconds">{timer.idleSeconds}</div>
      <div data-testid="focus-round-index">{timer.focusRound.roundIndex}</div>
      <div data-testid="focus-round-start">{timer.focusRound.startedAtEffectiveSeconds}</div>
      <div data-testid="focus-goal-celebrated">{String(timer.focusRound.goalCelebrated)}</div>
      <button type="button" onClick={() => timer.registerActivity('node_switch', { source: 'test_node_switch' })}>
        node-switch
      </button>
      <button type="button" onClick={() => timer.registerActivity('edit_operation', { source: 'test_edit_operation' })}>
        edit-op
      </button>
      <button type="button" onClick={() => timer.registerActivity('practice_interaction', { source: 'test_practice_interaction' })}>
        practice-op
      </button>
      <button type="button" onClick={() => void timer.complete('manual_complete', { source: 'test_complete' })}>
        complete
      </button>
      <button type="button" onClick={() => timer.pause({ source: 'test_pause' })}>
        pause
      </button>
      <button type="button" onClick={() => timer.resume({ source: 'test_resume' })}>
        resume
      </button>
      <button type="button" onClick={() => timer.acknowledgeFocusInterval(1, { source: 'test_interval' })}>
        acknowledge-interval
      </button>
      <button type="button" onClick={() => timer.acknowledgeFocusGoal({ source: 'test_goal' })}>
        acknowledge-goal
      </button>
      <button type="button" onClick={() => timer.startNextFocusRound({ source: 'test_next_round' })}>
        next-round
      </button>
    </div>
  )
}

export function readPersistedTimedSessionTestSnapshot(persistKey: string) {
  const raw = window.sessionStorage.getItem(`memory-anki-timed-session:${persistKey}`)
  return raw
    ? JSON.parse(raw) as {
        recordId?: string | null
        resumeDeadlineAt?: string | null
        sceneSegments?: Array<{ scene: string; effectiveSeconds: number }>
        focusRound?: {
          roundIndex: number
          startedAtEffectiveSeconds: number
          acknowledgedIntervalCount: number
          goalCelebrated: boolean
        }
        lastActivityAtMs?: number | null
        autoPauseDeadlineAtMs?: number | null
      }
    : null
}

export async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}
