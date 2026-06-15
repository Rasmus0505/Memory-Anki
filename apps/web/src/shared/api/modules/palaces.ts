import { API_BASE, fetchWithMutationQueue, request } from "@/shared/api/http"
import { parseSseEventBlock } from '@/shared/api/sse'
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
  MiniPalaceSummary,
  PalaceFocusSessionResponse,
  PalaceGroupedListResponse,
  PalaceListItem,
  MiniReviewMode,
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

export function togglePalaceFocusNodeApi(id: number, nodeUid: string, focused?: boolean) {
  return request<{
    ok: boolean
    palace_id: number
    node_uid: string
    focused: boolean
    focus_node_uids: string[]
    focus_count: number
    item: PalaceListItem
  }>(`/palaces/${id}/focus-nodes/${encodeURIComponent(nodeUid)}`, {
    method: 'PUT',
    body: focused === undefined ? undefined : JSON.stringify({ focused }),
    persistence: {
      resourceKey: `palace:${id}:focus-node:${nodeUid}`,
      coalesceKey: `palace:${id}:focus-node:${nodeUid}`,
      description: focused === false ? '取消专项卡标记' : '标记专项卡',
      replayMode: focused === undefined ? 'manual' : 'auto',
    },
  })
}

export function getPalaceReviewPlanApi(id: number) {
  return request<PalaceReviewPlanResponse>(`/palaces/${id}/review-plan`)
}

export function createPalaceApi(data: any) {
  return request<any>("/palaces", {
    method: "POST",
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:create:${data?.title ?? 'untitled'}`,
      description: '创建宫殿',
      replayMode: 'manual',
    },
  })
}

export function updatePalaceApi(id: number, data: any) {
  return request<any>(`/palaces/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${id}:meta`,
      coalesceKey: `palace:${id}:meta`,
      description: '保存宫殿信息',
      replayMode: 'auto',
    },
  })
}

export function deletePalaceApi(id: number) {
  return request<any>(`/palaces/${id}`, {
    method: "DELETE",
    persistence: {
      resourceKey: `palace:${id}:delete`,
      description: '删除宫殿',
      replayMode: 'manual',
    },
  })
}

export async function uploadAttachmentApi(palaceId: number, file: File) {
  const form = new FormData()
  form.append("file", file)
  const response = await fetchWithMutationQueue(
    `${API_BASE}/palaces/${palaceId}/upload`,
    {
      method: "POST",
      body: form,
    },
    {
      resourceKey: `palace:${palaceId}:attachment:${file.name}`,
      description: `上传附件：${file.name}`,
      replayMode: 'manual',
    },
  )
  return response.json()
}

export function deleteAttachmentApi(id: number) {
  return request<any>(`/attachments/${id}`, {
    method: "DELETE",
    persistence: {
      resourceKey: `attachment:${id}:delete`,
      description: '删除附件',
      replayMode: 'manual',
    },
  })
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

export function getMiniPalacesApi(id: number) {
  return request<{ items: MiniPalaceSummary[] }>(`/palaces/${id}/mini-palaces`)
}

export function createMiniPalaceApi(
  palaceId: number,
  data: {
    name?: string
    node_uids: string[]
  },
) {
  return request<{ item: MiniPalaceSummary }>(`/palaces/${palaceId}/mini-palaces`, {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${palaceId}:mini-palaces:create`,
      description: `创建小宫殿：${data.name || '默认命名'}`,
      replayMode: 'manual',
    },
  })
}

export function updateMiniPalaceApi(
  miniPalaceId: number,
  data: Partial<{
    name: string
    node_uids: string[]
    sort_order: number
  }>,
) {
  return request<{ item: MiniPalaceSummary }>(`/palace-mini-palaces/${miniPalaceId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace-mini-palace:${miniPalaceId}`,
      coalesceKey: `palace-mini-palace:${miniPalaceId}`,
      description: '保存小宫殿',
      replayMode: 'auto',
    },
  })
}

export function deleteMiniPalaceApi(miniPalaceId: number) {
  return request<{ ok: boolean }>(`/palace-mini-palaces/${miniPalaceId}`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `palace-mini-palace:${miniPalaceId}:delete`,
      description: '删除小宫殿',
      replayMode: 'manual',
    },
  })
}


export function getPalaceMiniPalaceApi(miniPalaceId: number) {
  return request<{
    item: MiniPalaceSummary
    palace: any
    editor_doc: Record<string, unknown> | string | null
  }>(`/palace-mini-palaces/${miniPalaceId}`)
}

export function updateMiniPalaceReviewProgressApi(
  miniPalaceId: number,
  data: {
    completed_count: number
    completed_review_number?: number | null
    completed_at?: string | null
  },
) {
  return request<{ item: MiniPalaceSummary; palace: any }>(
    `/palace-mini-palaces/${miniPalaceId}/review-progress`,
    {
      method: 'PUT',
      body: JSON.stringify(data),
      persistence: {
        resourceKey: `palace-mini-palace:${miniPalaceId}:review-progress`,
        coalesceKey: `palace-mini-palace:${miniPalaceId}:review-progress`,
        description: '保存小宫殿复习进度',
        replayMode: 'auto',
      },
    },
  )
}

export function getMiniPracticeSessionProgressApi(miniPalaceId: number) {
  return request<{ progress: SessionProgressSnapshot | null }>(
    `/sessions/mini-practice/${miniPalaceId}/progress`,
  )
}

export function saveMiniPracticeSessionProgressApi(
  miniPalaceId: number,
  data: {
    reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>
    red_node_ids: string[]
    completed: boolean
  },
) {
  return request<{ progress: SessionProgressSnapshot }>(
    `/sessions/mini-practice/${miniPalaceId}/progress`,
    {
      method: 'PUT',
      body: JSON.stringify(data),
      persistence: {
        resourceKey: `session-progress:mini-practice:${miniPalaceId}`,
        coalesceKey: `session-progress:mini-practice:${miniPalaceId}`,
        description: '保存小宫殿练习进度',
        replayMode: 'auto',
      },
    },
  )
}

export function clearMiniPracticeSessionProgressApi(miniPalaceId: number) {
  return request<{ ok: boolean }>(
    `/sessions/mini-practice/${miniPalaceId}/progress`,
    { method: 'DELETE' },
  )
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
    persistence: {
      resourceKey: `palace:${palaceId}:segments:create`,
      description: `创建分块：${data.name || '未命名分块'}`,
      replayMode: 'manual',
    },
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
    persistence: {
      resourceKey: `palace-segment:${segmentId}`,
      coalesceKey: `palace-segment:${segmentId}`,
      description: '保存分块',
      replayMode: 'auto',
    },
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
    persistence: {
      resourceKey: `palace-segment:${segmentId}:review-progress`,
      coalesceKey: `palace-segment:${segmentId}:review-progress`,
      description: '保存分块复习进度',
      replayMode: 'auto',
    },
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
    persistence: {
      resourceKey: `palace:${palaceId}:default-segment-review-progress`,
      coalesceKey: `palace:${palaceId}:default-segment-review-progress`,
      description: '保存默认分块复习进度',
      replayMode: 'auto',
    },
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
    persistence: {
      resourceKey: `palace:${palaceId}:practice-flag`,
      coalesceKey: `palace:${palaceId}:practice-flag`,
      description: '保存宫殿练习标记',
      replayMode: 'auto',
    },
  })
}

export function updatePalaceMiniReviewModeApi(
  palaceId: number,
  data: {
    mini_review_mode: MiniReviewMode
  },
) {
  return request<{ item: PalaceListItem }>(`/palaces/${palaceId}/mini-review-mode`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${palaceId}:mini-review-mode`,
      coalesceKey: `palace:${palaceId}:mini-review-mode`,
      description: '保存小宫殿复习归属',
      replayMode: 'auto',
    },
  })
}

export function deletePalaceSegmentApi(segmentId: number) {
  return request<{ ok: boolean }>(`/palace-segments/${segmentId}`, {
    method: "DELETE",
    persistence: {
      resourceKey: `palace-segment:${segmentId}:delete`,
      description: '删除分块',
      replayMode: 'manual',
    },
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
    persistence: {
      resourceKey: `palace:${id}:editor`,
      coalesceKey: `palace:${id}:editor`,
      description: '保存宫殿脑图',
      replayMode: 'auto',
    },
  })
}

export function savePalaceEditorWithOptionsApi(id: number, data: PalaceEditorSavePayload | Record<string, unknown>) {
  return request<{ palace: any } & MindMapEditorState>(`/palaces/${id}/editor`, {
    method: "PUT",
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${id}:editor`,
      coalesceKey: `palace:${id}:editor`,
      description: '保存宫殿脑图',
      replayMode: 'auto',
    },
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
    persistence: {
      resourceKey: `session-progress:practice:${id}`,
      coalesceKey: `session-progress:practice:${id}`,
      description: '保存练习进度',
      replayMode: 'auto',
    },
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
    persistence: {
      resourceKey: `session-progress:focus-practice:${id}`,
      coalesceKey: `session-progress:focus-practice:${id}`,
      description: '保存专项练习进度',
      replayMode: 'auto',
    },
  })
}

export function clearPracticeSessionProgressApi(id: number) {
  return request<{ ok: boolean }>(`/sessions/practice/${id}/progress`, {
    method: "DELETE",
    persistence: {
      resourceKey: `session-progress:practice:${id}:clear`,
      description: '清除练习进度',
      replayMode: 'manual',
    },
  })
}

export function clearFocusPracticeSessionProgressApi(id: number) {
  return request<{ ok: boolean }>(`/sessions/focus-practice/${id}/progress`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `session-progress:focus-practice:${id}:clear`,
      description: '清除专项练习进度',
      replayMode: 'manual',
    },
  })
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
    persistence: {
      resourceKey: `session-progress:segment-practice:${id}`,
      coalesceKey: `session-progress:segment-practice:${id}`,
      description: '保存分块练习进度',
      replayMode: 'auto',
    },
  })
}

export function clearSegmentPracticeSessionProgressApi(id: number) {
  return request<{ ok: boolean }>(`/sessions/segment-practice/${id}/progress`, {
    method: "DELETE",
    persistence: {
      resourceKey: `session-progress:segment-practice:${id}:clear`,
      description: '清除分块练习进度',
      replayMode: 'manual',
    },
  })
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
    persistence: {
      resourceKey: `palace:${id}:restore-version:${versionId}`,
      description: '恢复宫殿版本',
      replayMode: 'manual',
    },
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
    ai_options?: import('@/shared/api/contracts').AiRuntimeOptions
  },
) {
  const form = new FormData()
  form.append('entity_key', options.entityKey)
  form.append('mode', options.mode)
  if (options.fallbackTitle) {
    form.append('fallback_title', options.fallbackTitle)
  }
  if (options.ai_options) {
    form.append('ai_options', JSON.stringify(options.ai_options))
  }
  form.append('file', file)
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import/jobs/image`,
    {
      method: 'POST',
      body: form,
    },
    {
      resourceKey: `import-job:image:${options.entityKey}:${file.name}`,
      description: `创建图片导入任务：${file.name}`,
      replayMode: 'manual',
    },
  )
  return readImportJson<MindMapImportJob>(response)
}

export async function createBatchImportJobApi(
  files: File[],
  options: {
    entityKey: string
    fallbackTitle?: string
    structureImageIndex?: number
    ai_options?: import('@/shared/api/contracts').AiRuntimeOptions
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
  if (options.ai_options) {
    form.append('ai_options', JSON.stringify(options.ai_options))
  }
  files.forEach((file) => form.append('files', file))
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import/jobs/batch`,
    {
      method: 'POST',
      body: form,
    },
    {
      resourceKey: `import-job:batch:${options.entityKey}:${files.map((file) => file.name).join(',')}`,
      description: '创建批量导入任务',
      replayMode: 'manual',
    },
  )
  return readImportJson<MindMapImportJob>(response)
}

export async function createPdfImportJobApi(
  data: MindMapPdfImportPreviewRequest & {
    entity_key: string
    mode: 'mindmap' | 'text'
  },
) {
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import/jobs/pdf`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
    {
      resourceKey: `import-job:pdf:${data.entity_key}`,
      description: '创建 PDF 导入任务',
      replayMode: 'manual',
    },
  )
  return readImportJson<MindMapImportJob>(response)
}

export async function completeImportJobFromPreviewApi(
  jobId: string,
  data: {
    result: Record<string, unknown>
    usage?: Record<string, number>
  },
) {
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import/jobs/${jobId}/complete-from-preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
    {
      resourceKey: `import-job:${jobId}:complete-from-preview`,
      description: '完成导入预览任务',
      replayMode: 'manual',
    },
  )
  return readImportJson<MindMapImportJob>(response)
}

export async function runImportJobApi(jobId: string) {
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import/jobs/${jobId}/run`,
    {
      method: 'POST',
    },
    {
      resourceKey: `import-job:${jobId}:run`,
      description: '运行导入任务',
      replayMode: 'manual',
    },
  )
  return readImportJson<MindMapImportJob>(response)
}

export async function pauseImportJobApi(jobId: string) {
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import/jobs/${jobId}/pause`,
    {
      method: 'POST',
    },
    {
      resourceKey: `import-job:${jobId}:pause`,
      description: '暂停导入任务',
      replayMode: 'manual',
    },
  )
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
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import/jobs/${jobId}`,
    {
      method: 'DELETE',
    },
    {
      resourceKey: `import-job:${jobId}:delete`,
      description: '删除导入任务',
      replayMode: 'manual',
    },
  )
  return readImportJson<{ ok: boolean; job: MindMapImportJob }>(response)
}
