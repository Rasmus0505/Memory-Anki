import { request } from '@/shared/api/http'
import type { ResolvedAiRuntimeMeta } from '@/shared/api/contracts'

export type VoiceCoachEvent =
  | 'session_start'
  | 'idle_nudge'
  | 'edit_idle_nudge'
  | 'milestone'
  | 'all_clear_ready'
  | 'session_complete'

export interface VoiceCoachSynthesizeResponse {
  ok: boolean
  event: VoiceCoachEvent
  text: string
  cache_key: string
  audio_url: string
  cached: boolean
  model: string
  voice: string
  audio_format: string
  sample_rate: number
  request_id: string
  resolved_ai?: ResolvedAiRuntimeMeta | null
}

export function synthesizeVoiceCoachApi(
  event: VoiceCoachEvent,
  aiOptions?: import('@/shared/api/contracts').AiRuntimeOptions,
) {
  const payload: Record<string, unknown> = { event }
  if (aiOptions) {
    payload.ai_options = aiOptions
  }
  return request<VoiceCoachSynthesizeResponse>('/voice-coach/synthesize', {
    method: 'POST',
    body: JSON.stringify(payload),
    persistence: false,
  })
}
