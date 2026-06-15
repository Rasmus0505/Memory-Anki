import { request } from '@/shared/api/http'
import type {
  AiCallLogDetail,
  AiCallLogListResponse,
} from '@/shared/api/contracts'

export function listAiCallLogsApi(params?: {
  jobId?: string | null
  palaceId?: number | null
  provider?: string | null
  model?: string | null
  feature?: string | null
  status?: string | null
  limit?: number
}) {
  const search = new URLSearchParams()
  if (params?.jobId) search.set('job_id', params.jobId)
  if (typeof params?.palaceId === 'number') search.set('palace_id', String(params.palaceId))
  if (params?.provider) search.set('provider', params.provider)
  if (params?.model) search.set('model', params.model)
  if (params?.feature) search.set('feature', params.feature)
  if (params?.status) search.set('status', params.status)
  if (typeof params?.limit === 'number') search.set('limit', String(params.limit))
  const suffix = search.toString() ? `?${search.toString()}` : ''
  return request<AiCallLogListResponse>(`/ai-call-logs${suffix}`)
}

export function getAiCallLogApi(logId: string) {
  return request<AiCallLogDetail>(`/ai-call-logs/${logId}`)
}
