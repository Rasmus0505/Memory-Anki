export interface AiCallLogArtifact {
  name: string
  label: string
  mime_type: string
  source_kind: string
  url: string
}
export interface AiCallLogSummary {
  id: string
  feature: string
  operation: string
  job_id?: string | null
  palace_id?: number | null
  status: string
  provider: string
  base_url: string
  model: string
  request_id: string
  created_at?: string | null
  updated_at?: string | null
}
export interface AiCallLogDetail extends AiCallLogSummary {
  request_payload: Record<string, unknown>
  response_payload: Record<string, unknown>
  error_payload: Record<string, unknown>
  prompt_text: string
  response_text: string
  input_artifacts: AiCallLogArtifact[]
}
export interface AiCallLogListResponse {
  items: AiCallLogSummary[]
}
