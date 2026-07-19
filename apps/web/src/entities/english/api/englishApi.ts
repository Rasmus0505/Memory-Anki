import { API_BASE, request, uploadWithFormData } from '@/shared/api/http'
import { logAppError } from '@/shared/logs/model/appLogs'
import type {
  EnglishCourseDetail,
  EnglishGenerationLogEvent,
  EnglishGenerationLogResponse,
  EnglishCourseProgress,
  EnglishPatternCollectRequest,
  EnglishPatternCollectResponse,
  EnglishPatternCreateRequest,
  EnglishPatternDetail,
  EnglishPatternDueSentencesResponse,
  EnglishPatternListResponse,
  EnglishPatternReviewResult,
  EnglishPatternSentence,
  EnglishPatternSentenceUpsertRequest,
  EnglishPatternUpdateRequest,
  EnglishSentenceCheckResponse,
  EnglishWorkspaceResponse,
} from '@/shared/api/contracts'

export function getEnglishWorkspaceApi() {
  return request<EnglishWorkspaceResponse>('/english')
}

export function getEnglishCurrentTaskApi() {
  return request<{ task: EnglishWorkspaceResponse['currentTask'] }>('/english/current-task')
}

export function getEnglishTaskGenerationLogApi(taskId: string) {
  return request<EnglishGenerationLogResponse>(`/english/tasks/${taskId}/generation-log`)
}

export function getEnglishCourseGenerationLogApi(courseId: number) {
  return request<EnglishGenerationLogResponse>(`/english/courses/${courseId}/generation-log`)
}

interface EnglishTaskStreamHandlers {
  onStatus?: (payload: { task: NonNullable<EnglishWorkspaceResponse['currentTask']> }) => void
  onLog?: (payload: { event: EnglishGenerationLogEvent }) => void
  onDone?: (payload: { task: NonNullable<EnglishWorkspaceResponse['currentTask']> }) => void
  onError?: (payload: { task?: NonNullable<EnglishWorkspaceResponse['currentTask']>; error: string }) => void
}

function parseEnglishTaskStreamPayload(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch (error) {
    logAppError({
      feature: '英语任务流',
      stage: 'json_parse_error',
      error,
      responseSummary: raw.slice(0, 1200),
    })
    return null
  }
}

export function subscribeEnglishTaskStream(taskId: string, handlers: EnglishTaskStreamHandlers) {
  if (typeof EventSource === 'undefined') {
    handlers.onError?.({ error: '当前浏览器不支持实时任务流。' })
    return () => {}
  }
  const streamUrl = `${API_BASE}/english/tasks/${taskId}/stream`
  const eventSource = new EventSource(streamUrl)
  let closed = false

  const bind = (name: 'status' | 'log' | 'done' | 'error', handler: (payload: Record<string, unknown>) => void) => {
    eventSource.addEventListener(name, (event) => {
      if (!(event instanceof MessageEvent)) return
      const payload = parseEnglishTaskStreamPayload(event.data)
      if (!payload) return
      handler(payload)
    })
  }

  bind('status', (payload) => {
    handlers.onStatus?.(payload as { task: NonNullable<EnglishWorkspaceResponse['currentTask']> })
  })
  bind('log', (payload) => {
    handlers.onLog?.(payload as { event: EnglishGenerationLogEvent })
  })
  bind('done', (payload) => {
    handlers.onDone?.(payload as { task: NonNullable<EnglishWorkspaceResponse['currentTask']> })
    if (!closed) {
      closed = true
      eventSource.close()
    }
  })
  bind('error', (payload) => {
    handlers.onError?.(payload as { task?: NonNullable<EnglishWorkspaceResponse['currentTask']>; error: string })
    if (!closed) {
      closed = true
      eventSource.close()
    }
  })

  eventSource.onerror = () => {
    if (closed) return
    handlers.onError?.({ error: '英语任务实时连接已断开。' })
    closed = true
    eventSource.close()
  }

  return () => {
    if (closed) return
    closed = true
    eventSource.close()
  }
}

export async function uploadEnglishVideoApi(
  file: File,
  aiOptions?: import('@/shared/api/contracts').AiRuntimeOptions,
) {
  const formData = new FormData()
  formData.append('video_file', file)
  if (aiOptions) {
    formData.append('ai_options', JSON.stringify(aiOptions))
  }
  return uploadWithFormData<{ task: NonNullable<EnglishWorkspaceResponse['currentTask']> }>(
    '/english/upload',
    formData,
    {
      resourceKey: `english:upload:${file.name || 'video'}`,
      description: '上传英语视频',
    },
  )
}

export function retryEnglishCurrentTaskApi() {
  return request<{ task: NonNullable<EnglishWorkspaceResponse['currentTask']> }>(
    '/english/current-task/retry',
    {
      method: 'POST',
      persistence: {
        resourceKey: 'english:current-task:retry',
        description: '重试英语任务',
        replayMode: 'manual',
      },
    },
  )
}

export function clearEnglishCurrentTaskApi() {
  return request<{ ok: boolean }>('/english/current-task', {
    method: 'DELETE',
    persistence: {
      resourceKey: 'english:current-task:clear',
      description: '清除英语任务',
      replayMode: 'manual',
    },
  })
}

export function getEnglishContinueCourseApi() {
  return request<{ course: EnglishWorkspaceResponse['continueCourse'] }>('/english/continue')
}

export function getEnglishCourseApi(courseId: number) {
  return request<EnglishCourseDetail>(`/english/courses/${courseId}`)
}

export function getEnglishCourseProgressApi(courseId: number) {
  return request<EnglishCourseProgress>(`/english/courses/${courseId}/progress`)
}

export function updateEnglishCourseProgressApi(
  courseId: number,
  payload: {
    currentSentenceIndex: number
    completedSentenceIndexes: number[]
  },
) {
  return request<EnglishCourseProgress>(`/english/courses/${courseId}/progress`, {
    method: 'PUT',
    body: JSON.stringify(payload),
    persistence: {
      resourceKey: `english-course:${courseId}:progress`,
      coalesceKey: `english-course:${courseId}:progress`,
      description: '保存英语课程进度',
      replayMode: 'auto',
    },
  })
}

export function checkEnglishSentenceApi(
  courseId: number,
  payload: {
    sentenceIndex: number
    inputText: string
  },
) {
  return request<EnglishSentenceCheckResponse>(`/english/courses/${courseId}/check`, {
    method: 'POST',
    body: JSON.stringify(payload),
    persistence: {
      resourceKey: `english-course:${courseId}:check:${payload.sentenceIndex}`,
      description: '保存英语句子练习结果',
      replayMode: 'auto',
    },
  })
}

export function deleteEnglishCourseApi(courseId: number) {
  return request<{ ok: boolean }>(`/english/courses/${courseId}`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `english-course:${courseId}:delete`,
      description: '删除英语课程',
      replayMode: 'manual',
    },
  })
}

export function buildEnglishCourseMediaUrl(courseId: number) {
  return `${API_BASE}/english/courses/${courseId}/media`
}

export function listEnglishPatternsApi(input?: {
  includeArchived?: boolean
  limit?: number
}) {
  const params = new URLSearchParams()
  if (input?.includeArchived) params.set('includeArchived', 'true')
  if (input?.limit != null) params.set('limit', String(input.limit))
  const query = params.toString()
  return request<EnglishPatternListResponse>(`/english/patterns${query ? `?${query}` : ''}`)
}

export function createEnglishPatternApi(payload: EnglishPatternCreateRequest) {
  return request<EnglishPatternDetail>('/english/patterns', {
    method: 'POST',
    body: JSON.stringify(payload),
    persistence: {
      resourceKey: 'english-pattern:create',
      description: '创建英语句模',
      replayMode: 'manual',
    },
  })
}

export function getEnglishPatternApi(patternId: number) {
  return request<EnglishPatternDetail>(`/english/patterns/${patternId}`)
}

export function updateEnglishPatternApi(
  patternId: number,
  payload: EnglishPatternUpdateRequest,
) {
  return request<EnglishPatternDetail>(`/english/patterns/${patternId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    persistence: {
      resourceKey: `english-pattern:${patternId}:update`,
      description: '更新英语句模',
      replayMode: 'manual',
    },
  })
}

export function deleteEnglishPatternApi(patternId: number) {
  return request<{ ok: boolean; id: number }>(`/english/patterns/${patternId}`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `english-pattern:${patternId}:delete`,
      description: '删除英语句模',
      replayMode: 'manual',
    },
  })
}

export function upsertEnglishPatternPromptApi(
  patternId: number,
  payload: {
    promptId?: number | null
    textEn?: string
    textZh?: string
    promptIndex?: number
  },
) {
  return request<EnglishPatternDetail>(`/english/patterns/${patternId}/prompts`, {
    method: 'POST',
    body: JSON.stringify(payload),
    persistence: {
      resourceKey: `english-pattern:${patternId}:prompt`,
      description: '保存句模问题',
      replayMode: 'manual',
    },
  })
}

export function upsertEnglishPatternSentenceApi(
  promptId: number,
  payload: EnglishPatternSentenceUpsertRequest,
) {
  return request<EnglishPatternSentence>(
    `/english/patterns/prompts/${promptId}/sentences`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      persistence: {
        resourceKey: `english-pattern-prompt:${promptId}:sentence`,
        description: '保存句模观点长句',
        replayMode: 'manual',
      },
    },
  )
}

export function listEnglishPatternDueSentencesApi(input?: {
  patternId?: number
  limit?: number
}) {
  const params = new URLSearchParams()
  if (input?.patternId != null) params.set('patternId', String(input.patternId))
  if (input?.limit != null) params.set('limit', String(input.limit))
  const query = params.toString()
  return request<EnglishPatternDueSentencesResponse>(
    `/english/patterns/sentences/due${query ? `?${query}` : ''}`,
  )
}

export function reviewEnglishPatternSentenceApi(
  sentenceId: number,
  result: EnglishPatternReviewResult,
) {
  return request<EnglishPatternSentence>(
    `/english/patterns/sentences/${sentenceId}/review`,
    {
      method: 'POST',
      body: JSON.stringify({ result }),
      persistence: {
        resourceKey: `english-pattern-sentence:${sentenceId}:review`,
        description: '句模句子复习评分',
        replayMode: 'auto',
      },
    },
  )
}

export function collectEnglishPatternSentenceApi(payload: EnglishPatternCollectRequest) {
  return request<EnglishPatternCollectResponse>('/english/patterns/collect', {
    method: 'POST',
    body: JSON.stringify(payload),
    persistence: {
      resourceKey: 'english-pattern:collect',
      description: '收藏句子到句模',
      replayMode: 'manual',
    },
  })
}
