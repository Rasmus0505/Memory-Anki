import type { SessionProgressSnapshot } from '@/shared/api/contracts'

export type SessionProgressMode = 'practice'

export interface SessionProgressPayload {
  reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>
  red_node_ids: string[]
  completed: boolean
}

export async function getSessionProgressApi(_mode: SessionProgressMode, _id: number) {
  return { progress: null as SessionProgressSnapshot | null }
}

export async function saveSessionProgressApi(
  mode: SessionProgressMode,
  id: number,
  data: SessionProgressPayload,
  _description: string,
) {
  const progress: SessionProgressSnapshot = {
    id: 0,
    session_kind: mode,
    palace_id: id,
    reveal_map: data.reveal_map as SessionProgressSnapshot['reveal_map'],
    red_node_ids: data.red_node_ids,
    completed: data.completed,
    updated_at: new Date().toISOString(),
  }
  return { progress }
}

export async function clearSessionProgressApi(
  _mode: SessionProgressMode,
  _id: number,
  _description?: string,
) {
  return { ok: true }
}
