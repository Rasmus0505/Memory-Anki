import { API_BASE, request } from '@/shared/api/http'
import { getApiToken } from '@/shared/api/apiToken'
import { iterateSseBlocks } from '@/shared/api/sse'
import {
  decodeLiveStudyEnvelope,
  decodeLiveStudyProjection,
  encodeLiveStudyCommand,
  type LiveStudyCommandInput,
  type LiveStudyCommandResponse,
  type LiveStudyEnvelope,
} from '../model/live-study/liveStudyModel'

export async function publishLiveStudyCommand(
  input: LiveStudyCommandInput,
): Promise<LiveStudyCommandResponse> {
  const raw = await request<Record<string, unknown>>('/session/live/commands', {
    method: 'POST',
    body: JSON.stringify(encodeLiveStudyCommand(input)),
    persistence: false,
  })
  return {
    accepted: raw.accepted !== false,
    duplicate: raw.duplicate === true,
    projection: decodeLiveStudyProjection(raw.projection),
  }
}

export async function consumeLiveStudyStream(
  clientId: string,
  onEnvelope: (envelope: LiveStudyEnvelope) => void,
  signal: AbortSignal,
) {
  const apiToken = getApiToken()
  const response = await fetch(
    `${API_BASE}/session/live/stream?client_id=${encodeURIComponent(clientId)}`,
    {
      method: 'GET',
      headers: apiToken ? { 'X-Memory-Anki-Token': apiToken } : undefined,
      signal,
    },
  )
  if (!response.ok || !response.body) {
    throw new Error(`live study stream failed: ${response.status}`)
  }
  for await (const block of iterateSseBlocks(response.body, signal)) {
    if (block.event !== 'snapshot' && block.event !== 'update') continue
    try {
      onEnvelope(decodeLiveStudyEnvelope(JSON.parse(block.data)))
    } catch {
      // Skip a malformed event and keep the stream open.
    }
  }
}
