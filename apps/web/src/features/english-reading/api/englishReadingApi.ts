import { API_BASE, fetchWithMutationQueue, request } from '@/shared/api/http'
import type {
  ReadingGenerateStreamStatusEvent,
  ReadingCompletionResponse,
  ReadingDictionaryEntry,
  ReadingGenerateRequest,
  ReadingMaterial,
  ReadingProfile,
  ReadingSentenceTranslationResponse,
  ReadingVersion,
  ReadingWorkspaceResponse,
} from '@/shared/api/contracts'

async function uploadWithFormData<T>(url: string, formData: FormData): Promise<T> {
  const response = await fetchWithMutationQueue(
    `${API_BASE}${url}`,
    {
      method: 'POST',
      body: formData,
    },
    {
      resourceKey: 'english-reading:create-material',
      description: '创建英语阅读材料',
      replayMode: 'manual',
    },
  )
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    let message = body || `HTTP ${response.status}`
    try {
      const parsed = JSON.parse(body) as { detail?: unknown }
      if (typeof parsed.detail === 'string' && parsed.detail.trim()) {
        message = parsed.detail
      }
    } catch {
      // Ignore parse errors and use the raw message.
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export function getEnglishReadingProfileApi() {
  return request<ReadingProfile>('/english-reading/profile')
}

export function getEnglishReadingWorkspaceApi() {
  return request<ReadingWorkspaceResponse>('/english-reading')
}

export function updateEnglishReadingProfileApi(payload: { declaredCefr: ReadingProfile['declaredCefr'] }) {
  return request<ReadingProfile>('/english-reading/profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
    persistence: {
      resourceKey: 'english-reading:profile',
      coalesceKey: 'english-reading:profile',
      description: '更新英语阅读等级',
      replayMode: 'auto',
    },
  })
}

export function createEnglishReadingMaterialApi(input: { text?: string; file?: File | null }) {
  const formData = new FormData()
  if (input.text?.trim()) {
    formData.append('text', input.text)
  }
  if (input.file) {
    formData.append('reading_file', input.file)
  }
  return uploadWithFormData<ReadingMaterial>('/english-reading/materials', formData)
}

export function generateEnglishReadingVersionApi(
  materialId: number,
  payload: ReadingGenerateRequest,
) {
  return request<ReadingVersion>(`/english-reading/materials/${materialId}/generate`, {
    method: 'POST',
    body: JSON.stringify(payload),
    persistence: {
      resourceKey: `english-reading:material:${materialId}:generate`,
      description: '生成英语阅读版本',
      replayMode: 'manual',
    },
  })
}

function parseSseEventBlock(block: string): { event: string; data: string } | null {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
  if (lines.length === 0) return null
  let event = 'message'
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }
  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}

function isReadingGenerateStreamStatusEvent(
  payload: unknown,
): payload is ReadingGenerateStreamStatusEvent {
  if (!payload || typeof payload !== 'object') {
    return false
  }
  const candidate = payload as Record<string, unknown>
  return (
    typeof candidate.stage === 'string' &&
    typeof candidate.step === 'number' &&
    typeof candidate.totalSteps === 'number' &&
    typeof candidate.message === 'string'
  )
}

async function parseEnglishReadingStream(
  response: Response,
  handlers?: {
    onStatus?: (event: ReadingGenerateStreamStatusEvent) => void
  },
) {
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    let message = body || `HTTP ${response.status}`
    try {
      const parsed = JSON.parse(body) as { detail?: unknown }
      if (typeof parsed.detail === 'string' && parsed.detail.trim()) {
        message = parsed.detail
      }
    } catch {
      // Ignore parse errors and use raw text.
    }
    throw new Error(message)
  }
  if (!response.body) {
    throw new Error('浏览器不支持流式响应读取。')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalVersion: ReadingVersion | null = null
  let finalError = ''
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const parsedEvent = parseSseEventBlock(part)
      if (!parsedEvent) continue
      const payload = JSON.parse(parsedEvent.data) as Record<string, unknown>
      if (parsedEvent.event === 'status') {
        if (isReadingGenerateStreamStatusEvent(payload)) {
          handlers?.onStatus?.(payload)
        }
        continue
      }
      if (parsedEvent.event === 'result') {
        finalVersion = payload.version as ReadingVersion
        continue
      }
      if (parsedEvent.event === 'error') {
        finalError =
          typeof payload.detail === 'string'
            ? payload.detail
            : '生成阅读材料失败。'
      }
    }
    if (done) break
  }
  if (finalVersion) return finalVersion
  if (finalError) throw new Error(finalError)
  throw new Error('流式响应未返回最终结果。')
}

export async function generateEnglishReadingVersionStreamApi(
  materialId: number,
  payload: ReadingGenerateRequest,
  handlers?: {
    onStatus?: (event: ReadingGenerateStreamStatusEvent) => void
  },
) {
  const response = await fetchWithMutationQueue(
    `${API_BASE}/english-reading/materials/${materialId}/generate/stream`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
    },
    {
      resourceKey: `english-reading:material:${materialId}:generate-stream`,
      description: '流式生成英语阅读版本',
      replayMode: 'manual',
    },
  )
  return parseEnglishReadingStream(response, handlers)
}

export function getEnglishReadingMaterialApi(materialId: number) {
  return request<ReadingMaterial>(`/english-reading/materials/${materialId}`)
}

export function updateEnglishReadingMaterialApi(
  materialId: number,
  payload: { title: string },
) {
  return request<ReadingMaterial>(`/english-reading/materials/${materialId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    persistence: {
      resourceKey: `english-reading:material:${materialId}:update`,
      coalesceKey: `english-reading:material:${materialId}:update`,
      description: '更新英语阅读材料',
      replayMode: 'auto',
    },
  })
}

export function deleteEnglishReadingMaterialApi(materialId: number) {
  return request<{ deletedMaterialId: number }>(`/english-reading/materials/${materialId}`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `english-reading:material:${materialId}:delete`,
      description: '删除英语阅读材料',
      replayMode: 'manual',
    },
  })
}

export function getEnglishReadingVersionApi(materialId: number) {
  return request<ReadingVersion>(`/english-reading/materials/${materialId}/version`)
}

export function getEnglishReadingDictionaryApi(
  word: string,
) {
  return request<ReadingDictionaryEntry>(
    `/english-reading/dictionary?word=${encodeURIComponent(word)}`,
  )
}

export function translateEnglishReadingSentenceApi(
  text: string,
  aiOptions?: import('@/shared/api/contracts').AiRuntimeOptions,
) {
  return request<ReadingSentenceTranslationResponse>('/english-reading/sentence-translation', {
    method: 'POST',
    body: JSON.stringify({ text, ai_options: aiOptions }),
  })
}

export function completeEnglishReadingMaterialApi(
  materialId: number,
  payload: {
    versionId?: number | null
    feedback: 'too_easy' | 'just_right' | 'too_hard'
    durationSeconds: number
    hoverCount: number
    expandCount: number
  },
) {
  return request<ReadingCompletionResponse>(`/english-reading/materials/${materialId}/complete`, {
    method: 'POST',
    body: JSON.stringify(payload),
    persistence: {
      resourceKey: `english-reading:material:${materialId}:complete`,
      description: '完成英语阅读',
      replayMode: 'manual',
    },
  })
}
