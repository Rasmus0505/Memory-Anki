import { describe, expect, it } from 'vitest'
import { formatLocalApiDateTime } from '@/shared/lib/dateTime'
import { buildSuspendedSceneLeaveState } from './timedSessionSceneLeave'

describe('timed session scene leave state', () => {
  it('builds suspended timestamps and persisted leave meta', () => {
    const currentMs = new Date(2026, 0, 1, 10, 0, 0, 123).getTime()

    expect(buildSuspendedSceneLeaveState({
      currentMs,
      resumeWindowMs: 90_000,
      meta: { source: 'scene_inactive' },
      includePersistedRecord: true,
    })).toEqual({
      suspendedAt: formatLocalApiDateTime(new Date(currentMs)),
      resumeDeadlineAt: formatLocalApiDateTime(new Date(currentMs + 90_000)),
      persistedLeaveMeta: {
        source: 'scene_inactive',
        persisted_record: true,
      },
    })
  })

  it('marks unload-persisted leave state when requested', () => {
    const state = buildSuspendedSceneLeaveState({
      currentMs: new Date(2026, 0, 1, 10, 0, 0).getTime(),
      resumeWindowMs: 30_000,
      includePersistedRecord: true,
      includeUnloadPersisted: true,
    })

    expect(state.persistedLeaveMeta).toEqual({
      persisted_record: true,
      unload_persisted: true,
    })
  })
})
