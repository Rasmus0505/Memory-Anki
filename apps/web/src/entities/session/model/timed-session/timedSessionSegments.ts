import type { SessionKind } from '@/entities/session/model/session-records'
import type {
  ActiveSceneSegmentSnapshot,
  SessionSceneSegment,
  TimedSessionSourceKind,
} from '@/shared/hooks/timedSessionModel'
import type { SessionScene } from '@/entities/session/model/session-records'

export function createActiveSceneSegment(input: {
  scene: SessionScene
  kind: SessionKind
  palaceId: number | null
  sourceKind: TimedSessionSourceKind
  englishCourseId: number | null
  title: string
  startedAt: string
  effectiveSecondsAtStart: number
}): ActiveSceneSegmentSnapshot {
  return {
    scene: input.scene,
    kind: input.kind,
    palaceId: input.palaceId,
    sourceKind: input.sourceKind,
    englishCourseId: input.englishCourseId,
    title: input.title,
    startedAt: input.startedAt,
    startEffectiveSeconds: input.effectiveSecondsAtStart,
  }
}

export function closeSceneSegment(input: {
  active: ActiveSceneSegmentSnapshot | null
  segments: SessionSceneSegment[]
  endedAt: string
  effectiveSecondsNow: number
}): { segments: SessionSceneSegment[]; active: null } {
  if (!input.active) {
    return {
      segments: input.segments,
      active: null,
    }
  }

  const effectiveSegmentSeconds = Math.max(
    0,
    Math.round(input.effectiveSecondsNow - input.active.startEffectiveSeconds),
  )
  if (effectiveSegmentSeconds <= 0) {
    return {
      segments: input.segments,
      active: null,
    }
  }

  return {
    segments: [
      ...input.segments,
      {
        scene: input.active.scene,
        kind: input.active.kind,
        palaceId: input.active.palaceId,
        sourceKind: input.active.sourceKind,
        englishCourseId: input.active.englishCourseId,
        title: input.active.title,
        startedAt: input.active.startedAt,
        endedAt: input.endedAt,
        effectiveSeconds: effectiveSegmentSeconds,
      },
    ],
    active: null,
  }
}
