import { API_BASE, fetchWithMutationQueue, request } from '@/shared/api/http'
import type {
  ReadingCompletionResponse,
  ReadingGenerateRequest,
  ReadingMaterial,
  ReadingProfile,
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
