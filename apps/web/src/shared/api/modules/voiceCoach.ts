import { request } from '@/shared/api/http'

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
}

export function synthesizeVoiceCoachApi(event: VoiceCoachEvent) {
  return request<VoiceCoachSynthesizeResponse>('/voice-coach/synthesize', {
    method: 'POST',
    body: JSON.stringify({ event }),
  })
}
