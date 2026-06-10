import { API_BASE, fetchWithMutationQueue, request } from '@/shared/api/http'
import { logAppError } from '@/shared/logs/model/appLogs'
import type {
  EnglishCourseDetail,
  EnglishGenerationLogEvent,
  EnglishGenerationLogResponse,
  EnglishCourseProgress,
  EnglishSentenceCheckResponse,
  EnglishWorkspaceResponse,
} from '@/shared/api/contracts'

async function uploadWithFormData<T>(url: string, formData: FormData): Promise<T> {
  const fileName = formData.get('video_file')
  const response = await fetchWithMutationQueue(
    `${API_BASE}${url}`,
    {
      method: 'POST',
      body: formData,
    },
    {
      resourceKey: `english:upload:${typeof fileName === 'string' ? fileName : 'video'}`,
      description: '上传英语视频',
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
      // Ignore JSON parse failures here and use the raw text body.
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

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

export async function uploadEnglishVideoApi(file: File) {
  const formData = new FormData()
  formData.append('video_file', file)
  return uploadWithFormData<{ task: NonNullable<EnglishWorkspaceResponse['currentTask']> }>(
    '/english/upload',
    formData,
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
