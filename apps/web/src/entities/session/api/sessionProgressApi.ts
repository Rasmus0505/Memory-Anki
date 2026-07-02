import { request } from '@/shared/api/http'
import type { SessionProgressSnapshot } from '@/shared/api/contracts'

export type SessionProgressMode =
  | 'practice'
  | 'focus-practice'
  | 'segment-practice'
  | 'mini-practice'
  | 'review'
  | 'segment-review'
  | 'mini-review'

export interface SessionProgressPayload {
  reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>
  red_node_ids: string[]
  completed: boolean
}

function sessionProgressPath(mode: SessionProgressMode, id: number) {
  return `/sessions/${mode}/${id}/progress`
}

function sessionProgressResourceKey(mode: SessionProgressMode, id: number) {
  return `session-progress:${mode}:${id}`
}

export function getSessionProgressApi(mode: SessionProgressMode, id: number) {
  return request<{ progress: SessionProgressSnapshot | null }>(sessionProgressPath(mode, id))
}

export function saveSessionProgressApi(
  mode: SessionProgressMode,
  id: number,
  data: SessionProgressPayload,
  description: string,
) {
  const resourceKey = sessionProgressResourceKey(mode, id)
  return request<{ progress: SessionProgressSnapshot }>(sessionProgressPath(mode, id), {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey,
      coalesceKey: resourceKey,
      description,
      replayMode: 'auto',
    },
  })
}

export function clearSessionProgressApi(
  mode: SessionProgressMode,
  id: number,
  description?: string,
) {
  const persistence = description
    ? {
        resourceKey: `${sessionProgressResourceKey(mode, id)}:clear`,
        description,
        replayMode: 'manual' as const,
      }
    : false
  return request<{ ok: boolean }>(sessionProgressPath(mode, id), {
    method: 'DELETE',
    persistence,
  })
}
