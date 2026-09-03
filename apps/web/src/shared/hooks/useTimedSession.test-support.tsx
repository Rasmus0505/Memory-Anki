import * as React from 'react'
import { useTimedSession } from '@/shared/hooks/useTimedSession'

export interface TimedSessionTestHarnessProps {
  kind: 'palace_edit' | 'practice' | 'review' | 'quiz'
  sessionKey?: string
  automationScene?: 'palace_edit' | 'practice' | 'review' | 'english' | 'freestyle'
  persistKey?: string | null
  autoStart?: boolean
  persistCompletionRecord?: boolean
  title?: string
  palaceId?: number | null
}

export function TimedSessionTestHarness({
  kind,
  sessionKey = 'test:session',
  automationScene,
  persistKey = null,
  autoStart = false,
  persistCompletionRecord = true,
  title = '测试',
  palaceId = 1,
}: TimedSessionTestHarnessProps) {
  const timer = useTimedSession({
    sessionKey,
    kind,
    title,
    palaceId,
    automationScene,
    persistKey,
    persistCompletionRecord,
  })

  React.useEffect(() => {
    if (autoStart) timer.start({ source: 'test' })
  }, [autoStart, timer])

  return (
    <div>
      <div data-testid="status">{timer.status}</div>
      <div data-testid="pause-reason">{timer.pauseReason ?? ''}</div>
      <div data-testid="pause-count">{timer.pauseCount}</div>
      <div data-testid="seconds">{timer.effectiveSeconds}</div>
      <div data-testid="session-key">{timer.sessionKey}</div>
      <button type="button" onClick={() => timer.start({ source: 'test_start' })}>start</button>
      <button type="button" onClick={() => timer.pause({ source: 'test_pause' })}>pause</button>
      <button type="button" onClick={() => timer.resume({ source: 'test_resume' })}>resume</button>
      <button type="button" onClick={() => timer.setSceneActive(false, { source: 'route_inactive' })}>
        route-leave
      </button>
      <button type="button" onClick={() => timer.setSceneActive(true, { source: 'route_active' })}>
        route-enter
      </button>
      <button type="button" onClick={() => void timer.complete('manual_complete', { source: 'test_complete' })}>
        complete
      </button>
    </div>
  )
}

export function readPersistedTimedSessionTestSnapshot(sessionKey: string) {
  const raw = window.sessionStorage.getItem(`memory-anki-timed-session:${sessionKey}`)
  return raw ? JSON.parse(raw) as Record<string, unknown> : null
}

export async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}
