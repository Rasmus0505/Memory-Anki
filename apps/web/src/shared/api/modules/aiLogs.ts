import { request } from '@/shared/api/http'
import type {
  AiCallLogDetail,
  AiCallLogListResponse,
} from '@/shared/api/contracts'

export function listAiCallLogsApi(params?: {
  jobId?: string | null
  palaceId?: number | null
  limit?: number
}) {
  const search = new URLSearchParams()
  if (params?.jobId) search.set('job_id', params.jobId)
  if (typeof params?.palaceId === 'number') search.set('palace_id', String(params.palaceId))
  if (typeof params?.limit === 'number') search.set('limit', String(params.limit))
  const suffix = search.toString() ? `?${search.toString()}` : ''
  return request<AiCallLogListResponse>(`/ai-call-logs${suffix}`)
}

export function getAiCallLogApi(logId: string) {
  return request<AiCallLogDetail>(`/ai-call-logs/${logId}`)
}
