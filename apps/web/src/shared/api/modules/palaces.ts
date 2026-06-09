import { API_BASE, request } from "@/shared/api/http"
import { logAppError } from '@/shared/logs/model/appLogs'
import type {
  ImageTextPreviewResponse,
  ImportStreamDeltaEvent,
  ImportStreamStatusEvent,
  MindMapAiSplitRequest,
  MindMapAiSplitResponse,
  MindMapBatchImportPreviewResponse,
  MindMapEditorState,
  PalaceEditorSavePayload,
  MindMapImportJob,
  MindMapImportJobListResponse,
  MindMapImportPreviewResponse,
  MindMapPdfImportPreviewRequest,
  PalaceFocusSessionResponse,
  PalaceGroupedListResponse,
  PalaceListItem,
  PalaceReviewPlanResponse,
  PalaceSubjectShelfResponse,
  PalaceSegmentSummary,
  PalaceVersionDetail,
  PalaceVersionListResponse,
  SessionProgressSnapshot,
  TextPdfImportPreviewRequest,
} from "@/shared/api/contracts"

interface ImportStreamHandlers {
  onStatus?: (event: ImportStreamStatusEvent) => void
  onDelta?: (event: ImportStreamDeltaEvent) => void
}

function getResponseRequestId(response: Response) {
  return response.headers.get('X-Request-ID') || ''
}

function buildRequestError(message: string, requestId: string) {
  const error = new Error(message) as Error & { requestId?: string }
  error.requestId = requestId || undefined
  return error
}

function attachRequestId<T>(payload: T, requestId: string): T {
  if (!requestId || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload
  }
  return {
    ...(payload as Record<string, unknown>),
    request_id: requestId,
  } as T
}

function extractImportApiMessage(status: number, body: string): string {
  const normalized = body.trim()
  if (!normalized) {
    return `HTTP ${status}`
  }
  try {
    const parsed = JSON.parse(normalized) as { detail?: unknown; error?: unknown; message?: unknown }
    if (typeof parsed.detail === 'string' && parsed.detail.trim()) return parsed.detail
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message
  } catch {
    // Fall through to plain-text handling below.
  }
  if (/^\s*</.test(normalized) || /internal server error/i.test(normalized)) {
    return '服务端暂时返回了非 JSON 错误页，请稍后继续识别。'
  }
  return normalized
}

async function readImportJson<T>(response: Response): Promise<T> {
  const body = await response.text().catch(() => '')
  const requestId = getResponseRequestId(response)
  if (!response.ok) {
    const message = extractImportApiMessage(response.status, body)
    logAppError({
      feature: '导入接口',
      stage: 'http_error',
      error: message,
      responseSummary: body.slice(0, 1200),
      requestId,
      meta: {
        status: response.status,
        requestId,
      },
    })
    throw buildRequestError(message, requestId)
  }
  try {
    return attachRequestId(JSON.parse(body) as T, requestId)
  } catch (error) {
    const message = extractImportApiMessage(response.status, body)
    logAppError({
      feature: '导入接口',
      stage: 'json_parse_error',
      error,
      responseSummary: body.slice(0, 1200),
      requestId,
      meta: {
        status: response.status,
        requestId,
      },
    })
    throw buildRequestError(message, requestId)
  }
}

function parseSseEventBlock(block: string): { event: string; data: string } | null {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
  if (lines.length === 0) return null
  let event = "message"
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim()
      continue
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim())
    }
  }
  if (dataLines.length === 0) return null
  return { event, data: dataLines.join("\n") }
}

async function parseImportStreamResponse<T extends { ok: boolean; error?: string }>(
  response: Response,
  handlers?: ImportStreamHandlers,
): Promise<T> {
  const requestId = getResponseRequestId(response)
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    const message = extractImportApiMessage(response.status, body)
    logAppError({
      feature: '导入流式接口',
      stage: 'http_error',
      error: message,
      responseSummary: body.slice(0, 1200),
      requestId,
      meta: {
        status: response.status,
        requestId,
      },
    })
    throw buildRequestError(message, requestId)
  }

  const contentType = response.headers.get("content-type") || ""
  if (!contentType.includes("text/event-stream")) {
    return readImportJson<T>(response)
  }

  if (!response.body) {
    throw new Error("浏览器不支持流式响应读取。")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let finalResult: T | null = null
  let finalError = ""

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() ?? ""

    for (const part of parts) {
      const parsedEvent = parseSseEventBlock(part)
      if (!parsedEvent) continue
      let payload: any
      try {
        payload = JSON.parse(parsedEvent.data)
      } catch (error) {
        logAppError({
          feature: '导入流式接口',
          stage: 'sse_json_parse_error',
          error,
          responseSummary: parsedEvent.data.slice(0, 1200),
          requestId,
          meta: {
            event: parsedEvent.event,
            requestId,
          },
        })
        throw buildRequestError('模型返回的流式数据格式异常。', requestId)
      }
      if (parsedEvent.event === "status") {
        handlers?.onStatus?.(payload as ImportStreamStatusEvent)
        continue
      }
      if (parsedEvent.event === "delta") {
        handlers?.onDelta?.(payload as ImportStreamDeltaEvent)
        continue
      }
      if (parsedEvent.event === "result") {
        finalResult = payload as T
        continue
      }
      if (parsedEvent.event === "error") {
        finalError = typeof payload?.error === "string" ? payload.error : "识别失败，请稍后重试。"
        logAppError({
          feature: '导入流式接口',
          stage: 'sse_error_event',
          error: finalError,
          responseSummary: parsedEvent.data.slice(0, 1200),
          requestId,
          meta: {
            event: parsedEvent.event,
            requestId,
          },
        })
      }
    }

    if (done) break
  }

  if (buffer.trim()) {
    const trailingEvent = parseSseEventBlock(buffer)
    if (trailingEvent) {
      let payload: any
      try {
        payload = JSON.parse(trailingEvent.data)
      } catch (error) {
        logAppError({
          feature: '导入流式接口',
          stage: 'trailing_sse_json_parse_error',
          error,
          responseSummary: trailingEvent.data.slice(0, 1200),
          requestId,
          meta: {
            event: trailingEvent.event,
            requestId,
          },
        })
        throw buildRequestError('模型返回的流式数据格式异常。', requestId)
      }
      if (trailingEvent.event === "result") {
        finalResult = payload as T
      } else if (trailingEvent.event === "error") {
        finalError = typeof payload?.error === "string" ? payload.error : "识别失败，请稍后重试。"
        logAppError({
          feature: '导入流式接口',
          stage: 'trailing_sse_error_event',
          error: finalError,
          responseSummary: trailingEvent.data.slice(0, 1200),
          requestId,
          meta: {
            event: trailingEvent.event,
            requestId,
          },
        })
      } else if (trailingEvent.event === "status") {
        handlers?.onStatus?.(payload as ImportStreamStatusEvent)
      } else if (trailingEvent.event === "delta") {
        handlers?.onDelta?.(payload as ImportStreamDeltaEvent)
      }
    }
  }

  if (finalResult) {
    return attachRequestId(finalResult, requestId)
  }
  if (finalError) {
    return attachRequestId({ ok: false, error: finalError } as T, requestId)
  }
  throw buildRequestError("流式响应未返回最终结果。", requestId)
}

export function buildAttachmentUrl(attachmentId: number) {
  return `${API_BASE}/attachments/${attachmentId}`
}

export function getPalacesApi(params?: Record<string, string>) {
  const q = params ? `?${new URLSearchParams(params).toString()}` : ""
  return request<PalaceListItem[]>(`/palaces${q}`)
}

export function getPalacesGroupedApi(params?: Record<string, string>) {
  const q = params ? `?${new URLSearchParams(params).toString()}` : ""
  return request<PalaceGroupedListResponse>(`/palaces/grouped${q}`)
}

export function getPalaceSubjectShelfApi(params?: Record<string, string>) {
  const q = params ? `?${new URLSearchParams(params).toString()}` : ""
  return request<PalaceSubjectShelfResponse>(`/palaces/subjects${q}`)
}

export function getPalaceApi(id: number) {
  return request<any>(`/palaces/${id}`)
}

export function togglePalaceFocusNodeApi(id: number, nodeUid: string) {
  return request<{
    ok: boolean
    palace_id: number
    node_uid: string
    focused: boolean
    focus_node_uids: string[]
    focus_count: number
    item: PalaceListItem
  }>(`/palaces/${id}/focus-nodes/${encodeURIComponent(nodeUid)}`, { method: 'PUT' })
}

export function getPalaceReviewPlanApi(id: number) {
  return request<PalaceReviewPlanResponse>(`/palaces/${id}/review-plan`)
}

export function createPalaceApi(data: any) {
  return request<any>("/palaces", { method: "POST", body: JSON.stringify(data) })
}

export function updatePalaceApi(id: number, data: any) {
  return request<any>(`/palaces/${id}`, { method: "PUT", body: JSON.stringify(data) })
}

export function deletePalaceApi(id: number) {
  return request<any>(`/palaces/${id}`, { method: "DELETE" })
}

export async function uploadAttachmentApi(palaceId: number, file: File) {
  const form = new FormData()
  form.append("file", file)
  const response = await fetch(`${API_BASE}/palaces/${palaceId}/upload`, {
    method: "POST",
    body: form,
  })
  return response.json()
}

export function deleteAttachmentApi(id: number) {
  return request<any>(`/attachments/${id}`, { method: "DELETE" })
}

export function getPalaceEditorApi(id: number) {
  return request<{ palace: any } & MindMapEditorState>(`/palaces/${id}/editor`)
}

export function getPalaceFocusSessionApi(id: number) {
  return request<PalaceFocusSessionResponse>(`/palaces/${id}/focus-session`)
}

export function getPalaceSegmentsApi(id: number) {
  return request<{ items: PalaceSegmentSummary[] }>(`/palaces/${id}/segments`)
}

export function createPalaceSegmentApi(
  palaceId: number,
  data: {
    name?: string
    color?: string
    created_at?: string | null
    node_uids: string[]
  },
) {
  return request<{ item: PalaceSegmentSummary }>(`/palaces/${palaceId}/segments`, {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export function updatePalaceSegmentApi(
  segmentId: number,
  data: Partial<{
    name: string
    color: string
    created_at: string | null
    sort_order: number
    node_uids: string[]
  }>,
) {
  return request<{ item: PalaceSegmentSummary }>(`/palace-segments/${segmentId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export function updatePalaceSegmentReviewProgressApi(
  segmentId: number,
  data: {
    completed_count: number
    completed_review_number?: number | null
    completed_at?: string | null
  },
) {
  return request<{ item: PalaceSegmentSummary }>(`/palace-segments/${segmentId}/review-progress`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export function updateDefaultSegmentReviewProgressApi(
  palaceId: number,
  data: {
    completed_count: number
    completed_review_number?: number | null
    completed_at?: string | null
  },
) {
  return request<{ item: PalaceSegmentSummary | null }>(`/palaces/${palaceId}/default-segment/review-progress`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export function updatePalacePracticeFlagApi(
  palaceId: number,
  data: {
    needs_practice: boolean
  },
) {
  return request<{ item: any }>(`/palaces/${palaceId}/practice-flag`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export function deletePalaceSegmentApi(segmentId: number) {
  return request<{ ok: boolean }>(`/palace-segments/${segmentId}`, {
    method: "DELETE",
  })
}

export function getPalaceSegmentApi(segmentId: number) {
  return request<{
    item: PalaceSegmentSummary
    palace: any
    editor_doc: Record<string, unknown> | string | null
  }>(`/palace-segments/${segmentId}`)
}

export function savePalaceEditorApi(id: number, data: PalaceEditorSavePayload) {
  return request<{ palace: any } & MindMapEditorState>(`/palaces/${id}/editor`, {
    method: "PUT",
    body: JSON.stringify({ editor_source: "palace_edit_autosave", ...data }),
  })
}

export function savePalaceEditorWithOptionsApi(id: number, data: PalaceEditorSavePayload | Record<string, unknown>) {
  return request<{ palace: any } & MindMapEditorState>(`/palaces/${id}/editor`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export async function splitMindMapNodeApi(palaceId: number, data: MindMapAiSplitRequest) {
  const requestUrl = `${API_BASE}/palaces/${palaceId}/editor/ai-split`
  let response: Response
  try {
    response = await fetch(requestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  } catch (error) {
    logAppError({
      feature: 'AI 分卡',
      stage: 'network_failure',
      error,
      requestSummary: `POST ${requestUrl}`,
      meta: {
        palaceId,
      },
    })
    throw error
  }
  return readImportJson<MindMapAiSplitResponse>(response)
}

export function getPracticeSessionProgressApi(id: number) {
  return request<{ progress: SessionProgressSnapshot | null }>(`/sessions/practice/${id}/progress`)
}

export function getFocusPracticeSessionProgressApi(id: number) {
  return request<{ progress: SessionProgressSnapshot | null }>(`/sessions/focus-practice/${id}/progress`)
}

export function getSegmentPracticeSessionProgressApi(id: number) {
  return request<{ progress: SessionProgressSnapshot | null }>(`/sessions/segment-practice/${id}/progress`)
}

export function savePracticeSessionProgressApi(
  id: number,
  data: {
    reveal_map: Record<string, "hidden" | "placeholder" | "revealed">
    red_node_ids: string[]
    completed: boolean
  },
) {
  return request<{ progress: SessionProgressSnapshot }>(`/sessions/practice/${id}/progress`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export function saveFocusPracticeSessionProgressApi(
  id: number,
  data: {
    reveal_map: Record<string, "hidden" | "placeholder" | "revealed">
    red_node_ids: string[]
    completed: boolean
  },
) {
  return request<{ progress: SessionProgressSnapshot }>(`/sessions/focus-practice/${id}/progress`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export function clearPracticeSessionProgressApi(id: number) {
  return request<{ ok: boolean }>(`/sessions/practice/${id}/progress`, { method: "DELETE" })
}

export function clearFocusPracticeSessionProgressApi(id: number) {
  return request<{ ok: boolean }>(`/sessions/focus-practice/${id}/progress`, { method: 'DELETE' })
}

export function saveSegmentPracticeSessionProgressApi(
  id: number,
  data: {
    reveal_map: Record<string, "hidden" | "placeholder" | "revealed">
    red_node_ids: string[]
    completed: boolean
  },
) {
  return request<{ progress: SessionProgressSnapshot }>(`/sessions/segment-practice/${id}/progress`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export function clearSegmentPracticeSessionProgressApi(id: number) {
  return request<{ ok: boolean }>(`/sessions/segment-practice/${id}/progress`, { method: "DELETE" })
}

export function getPalaceVersionsApi(id: number) {
  return request<PalaceVersionListResponse>(`/palaces/${id}/versions`)
}

export function getPalaceVersionDetailApi(palaceId: number, versionId: number) {
  return request<PalaceVersionDetail>(`/palaces/${palaceId}/versions/${versionId}`)
}

export function restorePalaceVersionApi(id: number, versionId: number) {
  return request<any>(`/palaces/${id}/restore-version`, {
    method: "POST",
    body: JSON.stringify({ version_id: versionId }),
  })
}

export function getPalaceChaptersApi(id: number) {
  return request<any[]>(`/palaces/${id}/chapters`)
}

export function linkPalaceChaptersApi(
  palaceId: number,
  data: { chapter_ids: number[]; primary_chapter_id?: number | null },
) {
  return request<any>(`/palaces/${palaceId}/chapters`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export async function previewMindMapImportApi(file: File, handlers?: ImportStreamHandlers) {
  const form = new FormData()
  form.append("file", file)
  const response = await fetch(`${API_BASE}/import/preview-mindmap`, {
    method: "POST",
    body: form,
  })
  return parseImportStreamResponse<MindMapImportPreviewResponse>(response, handlers)
}

export async function previewImageTextApi(file: File, handlers?: ImportStreamHandlers) {
  const form = new FormData()
  form.append("file", file)
  const response = await fetch(`${API_BASE}/import/preview-text`, {
    method: "POST",
    body: form,
  })
  return parseImportStreamResponse<ImageTextPreviewResponse>(response, handlers)
}

export async function previewMindMapBatchImportApi(
  files: File[],
  options?: {
    structureImageIndex?: number
    fallbackTitle?: string
  },
  handlers?: ImportStreamHandlers,
) {
  const form = new FormData()
  files.forEach((file) => form.append("files", file))
  if (typeof options?.structureImageIndex === "number") {
    form.append("structure_image_index", String(options.structureImageIndex))
  }
  if (options?.fallbackTitle) {
    form.append("fallback_title", options.fallbackTitle)
  }
  const response = await fetch(`${API_BASE}/import/preview-mindmap-batch`, {
    method: "POST",
    body: form,
  })
  return parseImportStreamResponse<MindMapBatchImportPreviewResponse>(response, handlers)
}

export async function previewMindMapPdfImportApi(
  data: MindMapPdfImportPreviewRequest,
  handlers?: ImportStreamHandlers,
) {
  const response = await fetch(`${API_BASE}/import/preview-mindmap-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  return parseImportStreamResponse<MindMapImportPreviewResponse>(response, handlers)
}

export async function previewPdfTextApi(
  data: TextPdfImportPreviewRequest,
  handlers?: ImportStreamHandlers,
) {
  const response = await fetch(`${API_BASE}/import/preview-text-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  return parseImportStreamResponse<ImageTextPreviewResponse>(response, handlers)
}

export async function createImageImportJobApi(
  file: File,
  options: {
    entityKey: string
    mode: 'mindmap' | 'text'
    fallbackTitle?: string
  },
) {
  const form = new FormData()
  form.append('entity_key', options.entityKey)
  form.append('mode', options.mode)
  if (options.fallbackTitle) {
    form.append('fallback_title', options.fallbackTitle)
  }
  form.append('file', file)
  const response = await fetch(`${API_BASE}/import/jobs/image`, {
    method: 'POST',
    body: form,
  })
  return readImportJson<MindMapImportJob>(response)
}

export async function createBatchImportJobApi(
  files: File[],
  options: {
    entityKey: string
    fallbackTitle?: string
    structureImageIndex?: number
  },
) {
  const form = new FormData()
  form.append('entity_key', options.entityKey)
  if (options.fallbackTitle) {
    form.append('fallback_title', options.fallbackTitle)
  }
  if (typeof options.structureImageIndex === 'number') {
    form.append('structure_image_index', String(options.structureImageIndex))
  }
  files.forEach((file) => form.append('files', file))
  const response = await fetch(`${API_BASE}/import/jobs/batch`, {
    method: 'POST',
    body: form,
  })
  return readImportJson<MindMapImportJob>(response)
}

export async function createPdfImportJobApi(
  data: MindMapPdfImportPreviewRequest & {
    entity_key: string
    mode: 'mindmap' | 'text'
  },
) {
  const response = await fetch(`${API_BASE}/import/jobs/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return readImportJson<MindMapImportJob>(response)
}

export async function completeImportJobFromPreviewApi(
  jobId: string,
  data: {
    result: Record<string, unknown>
    usage?: Record<string, number>
  },
) {
  const response = await fetch(`${API_BASE}/import/jobs/${jobId}/complete-from-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return readImportJson<MindMapImportJob>(response)
}

export async function runImportJobApi(jobId: string) {
  const response = await fetch(`${API_BASE}/import/jobs/${jobId}/run`, {
    method: 'POST',
  })
  return readImportJson<MindMapImportJob>(response)
}

export async function pauseImportJobApi(jobId: string) {
  const response = await fetch(`${API_BASE}/import/jobs/${jobId}/pause`, {
    method: 'POST',
  })
  return readImportJson<MindMapImportJob>(response)
}

export async function getImportJobApi(jobId: string) {
  const response = await fetch(`${API_BASE}/import/jobs/${jobId}`)
  return readImportJson<MindMapImportJob>(response)
}

export async function listImportJobsApi(entityKey: string) {
  const response = await fetch(`${API_BASE}/import/jobs?${new URLSearchParams({ entity_key: entityKey }).toString()}`)
  return readImportJson<MindMapImportJobListResponse>(response)
}

export async function deleteImportJobApi(jobId: string) {
  const response = await fetch(`${API_BASE}/import/jobs/${jobId}`, {
    method: 'DELETE',
  })
  return readImportJson<{ ok: boolean; job: MindMapImportJob }>(response)
}
