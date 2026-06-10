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
  const id = record.id ?? crypto.randomUUID()
  return request<{ item: TimeSessionRecord | null }>('/time-records', {
    method: 'POST',
    body: JSON.stringify({ ...record, id }),
    persistence: {
      resourceKey: `time-record:${id}`,
      description: `保存学习时长：${record.title || record.kind}`,
      replayMode: 'auto',
    },
  })
}

export async function updateTimeRecordApi(
  id: string,
  updater: Partial<TimeSessionRecord>,
) {
  return request<{ item: TimeSessionRecord | null }>(`/time-records/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updater),
    persistence: {
      resourceKey: `time-record:${id}`,
      coalesceKey: `time-record:${id}`,
      description: '更新时间记录',
      replayMode: 'auto',
    },
  })
}

export async function softDeleteTimeRecordApi(id: string) {
  return request<{ item: TimeSessionRecord | null }>(`/time-records/${id}/soft-delete`, {
    method: 'POST',
    persistence: {
      resourceKey: `time-record:${id}:soft-delete`,
      description: '删除时间记录',
      replayMode: 'manual',
    },
  })
}

export async function restoreTimeRecordApi(id: string) {
  return request<{ item: TimeSessionRecord | null }>(`/time-records/${id}/restore`, {
    method: 'POST',
    persistence: {
      resourceKey: `time-record:${id}:restore`,
      description: '恢复时间记录',
      replayMode: 'manual',
    },
  })
}

export async function getTimeRecordingThresholdApi() {
  return request<{ seconds: number }>('/settings/time-recording-threshold')
}

export async function setTimeRecordingThresholdApi(seconds: number) {
  return request<{ seconds: number }>('/settings/time-recording-threshold', {
    method: 'PUT',
    body: JSON.stringify({ seconds }),
    persistence: {
      resourceKey: 'settings:time-recording-threshold',
      coalesceKey: 'settings:time-recording-threshold',
      description: '保存时间记录阈值',
      replayMode: 'auto',
    },
  })
}

export async function importLegacyTimeRecordsApi(records: TimeSessionRecord[]) {
  return request<{ imported: number }>('/time-records/import-legacy', {
    method: 'POST',
    body: JSON.stringify({ records }),
    persistence: {
      resourceKey: 'time-records:import-legacy',
      description: '导入旧版时间记录',
      replayMode: 'manual',
    },
  })
}

export function buildTimeRecord(
  params: Omit<TimeSessionRecord, 'id'> & { id?: string },
): Omit<TimeSessionRecord, 'id'> & { id?: string } {
  return params
}

export type { SessionCompletionMethod, SessionKind }
