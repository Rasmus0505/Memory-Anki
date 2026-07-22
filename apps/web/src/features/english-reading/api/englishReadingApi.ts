import { API_BASE, fetchWithMutationQueue, request, uploadWithFormData } from '@/shared/api/http'
import { readSseResultResponse } from '@/shared/api/sseResponse'
import type {
  ReadingGenerateStreamStatusEvent,
  ReadingCompletionResponse,
  ReadingDictionaryEntry,
  ReadingGenerateRequest,
  ReadingMaterial,
  ReadingProfile,
  ReadingSentenceTranslationResponse,
  ReadingVersion,
  ReadingVocabularyNote,
  ReadingVocabularyNoteCreateRequest,
  ReadingVocabularyNotesResponse,
  ReadingVocabularyReviewResult,
  ReadingWorkspaceResponse,
  ReadingArticle,
  ReadingArticlesResponse,
  ReadingTarget,
  ReadingExplanation,
  ReadingArticleGenerationConfig,
} from '@/shared/api/contracts'

export function listEnglishReadingArticlesApi() {
  return request<ReadingArticlesResponse>('/english-reading/articles')
}

export function getEnglishReadingArticleApi(articleId: number) {
  return request<ReadingArticle>(`/english-reading/articles/${articleId}`)
}

export function createEnglishReadingArticleApi(input: { text?: string; file?: File | null }) {
  const formData = new FormData()
  if (input.text?.trim()) formData.append('text', input.text)
  if (input.file) formData.append('reading_file', input.file)
  return uploadWithFormData<ReadingArticle>('/english-reading/articles', formData, {
    resourceKey: 'english-reading:article:create',
    description: '导入英语阅读文章',
  })
}

export function renameEnglishReadingArticleApi(articleId: number, title: string) {
  return request<ReadingArticle>(`/english-reading/articles/${articleId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
}

export function deleteEnglishReadingArticleApi(articleId: number) {
  return request<{ deletedArticleIds: number[] }>(`/english-reading/articles/${articleId}`, { method: 'DELETE' })
}

export function createEnglishReadingTargetApi(articleId: number, payload: {
  type: 'word' | 'sentence'
  startOffset: number
  endOffset: number
  quote: string
  priority?: number
}) {
  return request<ReadingTarget>(`/english-reading/articles/${articleId}/targets`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateEnglishReadingTargetApi(targetId: number, priority: number) {
  return request<ReadingTarget>(`/english-reading/targets/${targetId}`, {
    method: 'PATCH',
    body: JSON.stringify({ priority }),
  })
}

export function deleteEnglishReadingTargetApi(targetId: number) {
  return request<{ deletedTargetId: number }>(`/english-reading/targets/${targetId}`, { method: 'DELETE' })
}

export function explainEnglishReadingTargetApi(targetId: number, payload: {
  operationId: string
  cefr: string
  ai_options?: import('@/shared/api/contracts').AiRuntimeOptions
}) {
  return request<ReadingExplanation>(`/english-reading/targets/${targetId}/explanations`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteEnglishReadingExplanationApi(explanationId: number) {
  return request<{ deletedExplanationId: number }>(`/english-reading/explanations/${explanationId}`, { method: 'DELETE' })
}

export function generateTargetedEnglishReadingArticleApi(articleId: number, payload: {
  operationId: string
  targetIds: number[]
  config: ReadingArticleGenerationConfig
  ai_options?: import('@/shared/api/contracts').AiRuntimeOptions
}) {
  return request<{ article: ReadingArticle; run: Record<string, unknown> }>(`/english-reading/articles/${articleId}/generate`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
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
  return uploadWithFormData<ReadingMaterial>('/english-reading/materials', formData, {
    resourceKey: 'english-reading:create-material',
    description: '创建英语阅读材料',
  })
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
  return readSseResultResponse<ReadingVersion, ReadingGenerateStreamStatusEvent>(response, {
    feature: 'English reading stream API',
    handlers,
    statusGuard: isReadingGenerateStreamStatusEvent,
    jsonOptions: { nonJsonErrorMessage: '生成阅读材料失败。' },
    selectResult: (payload) => {
      if (payload && typeof payload === 'object') {
        const version = (payload as { version?: unknown }).version
        return version ? (version as ReadingVersion) : null
      }
      return null
    },
    selectErrorMessage: (payload) => {
      if (payload && typeof payload === 'object') {
        const detail = (payload as { detail?: unknown }).detail
        if (typeof detail === 'string' && detail.trim()) return detail
      }
      return '生成阅读材料失败。'
    },
    unsupportedStreamMessage: '浏览器不支持流式响应读取。',
    parseErrorMessage: '流式响应数据格式无效。',
    missingResultMessage: '流式响应未返回最终结果。',
  })
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

export function listEnglishReadingVocabularyNotesApi(input: {
  dueOnly?: boolean
  limit?: number
} = {}) {
  const params = new URLSearchParams()
  if (input.dueOnly) {
    params.set('dueOnly', 'true')
  }
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit))
  }
  const query = params.toString()
  return request<ReadingVocabularyNotesResponse>(
    `/english-reading/vocabulary-notes${query ? `?${query}` : ''}`,
  )
}

export function createEnglishReadingVocabularyNoteApi(
  payload: ReadingVocabularyNoteCreateRequest,
) {
  return request<ReadingVocabularyNote>('/english-reading/vocabulary-notes', {
    method: 'POST',
    body: JSON.stringify(payload),
    persistence: {
      resourceKey: `english-reading:vocabulary:${payload.word}`,
      description: '保存英语词汇笔记',
      replayMode: 'manual',
    },
  })
}

export function reviewEnglishReadingVocabularyNoteApi(
  noteId: number,
  result: ReadingVocabularyReviewResult,
) {
  return request<ReadingVocabularyNote>(`/english-reading/vocabulary-notes/${noteId}/review`, {
    method: 'POST',
    body: JSON.stringify({ result }),
    persistence: {
      resourceKey: `english-reading:vocabulary:${noteId}:review`,
      description: '复习英语词汇笔记',
      replayMode: 'manual',
    },
  })
}
