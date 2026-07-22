import { describe, expect, it } from 'vitest'
import {
  closeSceneSegment,
  createActiveSceneSegment,
} from './timedSessionSegments'

describe('timed session segments', () => {
  it('creates an active scene segment snapshot', () => {
    expect(createActiveSceneSegment({
      scene: 'freestyle',
      kind: 'practice',
      palaceId: 1,
      sourceKind: 'palace',
      englishCourseId: null,
      title: 'Memory',
      startedAt: '2026-01-01 10:00:00',
      effectiveSecondsAtStart: 12,
    })).toEqual({
      scene: 'freestyle',
      kind: 'practice',
      palaceId: 1,
      sourceKind: 'palace',
      englishCourseId: null,
      title: 'Memory',
      startedAt: '2026-01-01 10:00:00',
      startEffectiveSeconds: 12,
    })
  })

  it('closes an active segment when effective time advanced', () => {
    const active = createActiveSceneSegment({
      scene: 'freestyle',
      kind: 'practice',
      palaceId: null,
      sourceKind: null,
      englishCourseId: null,
      title: 'Memory',
      startedAt: '2026-01-01 10:00:00',
      effectiveSecondsAtStart: 5,
    })

    expect(closeSceneSegment({
      active,
      segments: [],
      endedAt: '2026-01-01 10:01:00',
      effectiveSecondsNow: 36,
    })).toEqual({
      active: null,
      segments: [{
        scene: 'freestyle',
        kind: 'practice',
        palaceId: null,
        sourceKind: null,
        englishCourseId: null,
        title: 'Memory',
        startedAt: '2026-01-01 10:00:00',
        endedAt: '2026-01-01 10:01:00',
        effectiveSeconds: 31,
      }],
    })
  })

  it('drops zero-length segments', () => {
    const active = createActiveSceneSegment({
      scene: 'freestyle',
      kind: 'practice',
      palaceId: null,
      sourceKind: null,
      englishCourseId: null,
      title: 'Memory',
      startedAt: '2026-01-01 10:00:00',
      effectiveSecondsAtStart: 5,
    })

    expect(closeSceneSegment({
      active,
      segments: [],
      endedAt: '2026-01-01 10:01:00',
      effectiveSecondsNow: 5,
    })).toEqual({
      active: null,
      segments: [],
    })
  })
})
