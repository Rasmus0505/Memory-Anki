import { request } from '@/shared/api/http'
import type {
  SessionCompletionMethod,
  SessionKind,
  TimeSessionRecord,
} from '@/entities/session/model/session-records'

export interface TimeRecordListResponse {
  items: TimeSessionRecord[]
}

export async function listTimeRecordsApi(options?: {
  includeDeleted?: boolean
  includeBelowThreshold?: boolean
}) {
  const params = new URLSearchParams()
  if (options?.includeDeleted) params.set('include_deleted', 'true')
  if (options?.includeBelowThreshold) params.set('include_below_threshold', 'true')
  const query = params.toString() ? `?${params.toString()}` : ''
  return request<TimeRecordListResponse>(`/time-records${query}`)
}

export async function createTimeRecordApi(
  record: Omit<TimeSessionRecord, 'id'> & { id?: string },
) {
  return request<{ item: TimeSessionRecord | null }>('/time-records', {
    method: 'POST',
    body: JSON.stringify({ ...record, id: record.id ?? crypto.randomUUID() }),
  })
}

export async function updateTimeRecordApi(
  id: string,
  updater: Partial<TimeSessionRecord>,
) {
  return request<{ item: TimeSessionRecord | null }>(`/time-records/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updater),
  })
}

export async function softDeleteTimeRecordApi(id: string) {
  return request<{ item: TimeSessionRecord | null }>(`/time-records/${id}/soft-delete`, {
    method: 'POST',
  })
}

export async function restoreTimeRecordApi(id: string) {
  return request<{ item: TimeSessionRecord | null }>(`/time-records/${id}/restore`, {
    method: 'POST',
  })
}

export async function getTimeRecordingThresholdApi() {
  return request<{ seconds: number }>('/settings/time-recording-threshold')
}

export async function setTimeRecordingThresholdApi(seconds: number) {
  return request<{ seconds: number }>('/settings/time-recording-threshold', {
    method: 'PUT',
    body: JSON.stringify({ seconds }),
  })
}

export async function importLegacyTimeRecordsApi(records: TimeSessionRecord[]) {
  return request<{ imported: number }>('/time-records/import-legacy', {
    method: 'POST',
    body: JSON.stringify({ records }),
  })
}

export function buildTimeRecord(
  params: Omit<TimeSessionRecord, 'id'> & { id?: string },
): Omit<TimeSessionRecord, 'id'> & { id?: string } {
  return params
}

export type { SessionCompletionMethod, SessionKind }
