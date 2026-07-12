import type { SessionProgressSnapshot } from '@/shared/api/contracts'
import {
  createStudySessionApi,
  getActiveStudySessionByTargetApi,
  patchStudySessionApi,
  type StudySessionItem,
  type StudySessionPayload,
  type StudySessionScene,
  type StudySessionTargetType,
} from '@/entities/study-session/api'

export type SessionProgressMode =
  | 'practice'
  | 'focus-practice'
  | 'segment-practice'
  | 'mini-practice'
  | 'review'

export interface SessionProgressPayload {
  reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>
  red_node_ids: string[]
  completed: boolean
}

function sessionProgressResourceKey(mode: SessionProgressMode, id: number) {
  return `session-progress:${mode}:${id}`
}

function sessionProgressSessionId(mode: SessionProgressMode, id: number) {
  return `session-progress-${mode}-${id}`
}

function modeToStudyTarget(mode: SessionProgressMode, id: number): {
  scene: StudySessionScene
  targetType: StudySessionTargetType
  targetId: number
} {
  if (mode === 'focus-practice') return { scene: 'focus_practice', targetType: 'palace', targetId: id }
  if (mode === 'segment-practice') return { scene: 'segment_practice', targetType: 'palace_segment', targetId: id }
  if (mode === 'mini-practice') return { scene: 'mini_practice', targetType: 'mini_palace', targetId: id }
  if (mode === 'review') return { scene: 'review', targetType: 'review_schedule', targetId: id }
  return { scene: 'practice', targetType: 'palace', targetId: id }
}

function studySessionToProgress(item: StudySessionItem | null): SessionProgressSnapshot | null {
  if (!item) return null
  const progress = item.progress || {}
  return {
    id: Number.parseInt(item.id.replace(/\D+/g, ''), 10) || 0,
    session_kind: item.scene.replace(/-/g, '_') as SessionProgressSnapshot['session_kind'],
    palace_id: item.palace_id,
    review_schedule_id: item.target_type === 'review_schedule' ? item.target_id : null,
    palace_segment_id: item.palace_segment_id,
    mini_palace_id: item.mini_palace_id,
    reveal_map: (progress.reveal_map || {}) as SessionProgressSnapshot['reveal_map'],
    red_node_ids: (progress.red_node_ids || []) as string[],
    completed: Boolean(progress.completed),
    updated_at: item.updated_at,
  }
}

export async function getSessionProgressApi(mode: SessionProgressMode, id: number) {
  const target = modeToStudyTarget(mode, id)
  const result = await getActiveStudySessionByTargetApi({
    targetType: target.targetType,
    targetId: target.targetId,
    scene: target.scene,
  })
  return { progress: studySessionToProgress(result.item) }
}

export async function saveSessionProgressApi(
  mode: SessionProgressMode,
  id: number,
  data: SessionProgressPayload,
  description: string,
) {
  const resourceKey = sessionProgressResourceKey(mode, id)
  const target = modeToStudyTarget(mode, id)
  const existing = await getActiveStudySessionByTargetApi({
    targetType: target.targetType,
    targetId: target.targetId,
    scene: target.scene,
  })
  const payload: Partial<StudySessionPayload> = {
    scene: target.scene,
    target_type: target.targetType,
    target_id: target.targetId,
    progress: data,
  }
  const result = existing.item
    ? await patchStudySessionApi(existing.item.id, payload, {
        persistence: {
          resourceKey,
          coalesceKey: resourceKey,
          description,
          replayMode: 'auto',
        },
      })
    : await createStudySessionApi({
        ...payload,
        id: sessionProgressSessionId(mode, id),
        status: 'active',
        started_at: new Date().toISOString(),
      } as StudySessionPayload)
  return { progress: studySessionToProgress(result.item) as SessionProgressSnapshot }
}

export async function clearSessionProgressApi(
  mode: SessionProgressMode,
  id: number,
  description?: string,
) {
  const target = modeToStudyTarget(mode, id)
  const existing = await getActiveStudySessionByTargetApi({
    targetType: target.targetType,
    targetId: target.targetId,
    scene: target.scene,
  })
  if (!existing.item) return { ok: true }
  const persistence = description
    ? {
        resourceKey: `${sessionProgressResourceKey(mode, id)}:clear`,
        description,
        replayMode: 'manual' as const,
      }
    : {
        resourceKey: `${sessionProgressResourceKey(mode, id)}:clear`,
        description: 'Clear session progress',
        replayMode: 'manual' as const,
      }
  await patchStudySessionApi(existing.item.id, {
    status: 'abandoned',
    ended_at: new Date().toISOString(),
    progress: { ...existing.item.progress, completed: true },
  }, {
    persistence,
  })
  return { ok: true }
}
