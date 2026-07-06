import { logAppError } from '@/shared/logs/model/appLogs'
import {
  buildRequestError,
  extractResponseMessage,
  getResponseRequestId,
} from '@/shared/api/jsonResponse'
import { isConflictResponse } from '@/shared/api/conflict'
import {
  discardQueuedMutationsByCoalesceKey,
  enqueueMutation,
  isQueuedReplayRequest,
  replayQueuedMutations,
  type EnqueueMutationInput,
  type StoredFormDataEntry,
} from '@/shared/persistence/mutationQueue'

export function normalizeApiOrigin(value: string | undefined) {
  const origin = value?.trim()
  if (!origin) return ''
  return origin.replace(/\/+$/, '')
}

export const API_BASE = `${normalizeApiOrigin(import.meta.env.VITE_API_ORIGIN)}/api/v1`
const MUTATION_ID_HEADER = 'X-Memory-Anki-Mutation-ID'

export interface RequestPersistenceOptions {
  resourceKey: string
  coalesceKey?: string | null
  description?: string
  replayMode?: 'auto' | 'manual'
}

export interface PersistedRequestInit extends RequestInit {
  persistence?: RequestPersistenceOptions | false
}

function generateMutationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function normalizeHeaders(headers?: HeadersInit) {
  const result: Record<string, string> = {}
  if (!headers) return result
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key] = value
    })
    return result
  }
  if (Array.isArray(headers)) {
    headers.forEach(([key, value]) => {
      result[key] = value
    })
    return result
  }
  return { ...headers }
}

function hasMutationId(headers: Record<string, string>) {
  return Object.keys(headers).some((key) => key.toLowerCase() === MUTATION_ID_HEADER.toLowerCase())
}

function getMutationId(headers: Record<string, string>) {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === MUTATION_ID_HEADER.toLowerCase()) return value
  }
  return null
}

function canPersistRequestBody(body: BodyInit | null | undefined) {
  return body == null || typeof body === 'string' || (typeof FormData !== 'undefined' && body instanceof FormData)
}

async function enqueueFailedRequest(input: {
  url: string
  method: string
  headers: Record<string, string>
  mutationId: string
  body: BodyInit | null | undefined
  persistence: RequestPersistenceOptions
  status?: number
  message?: string
}) {
  if (!canPersistRequestBody(input.body)) return null
  const formDataEntries =
    typeof FormData !== 'undefined' && input.body instanceof FormData
      ? serializeFormData(input.body)
      : undefined
  const conflict = input.status != null && isConflictResponse(input.status, input.message || '')
  const mutation: EnqueueMutationInput = {
    mutationId: input.mutationId,
    resourceKey: input.persistence.resourceKey,
    coalesceKey: input.persistence.coalesceKey,
    description: input.persistence.description,
    url: input.url,
    method: input.method,
    headers: input.headers,
    bodyKind:
      typeof FormData !== 'undefined' && input.body instanceof FormData
        ? 'formData'
        : input.body
          ? 'json'
          : 'empty',
    body: typeof input.body === 'string' ? input.body : null,
    formDataEntries,
    replayMode: input.persistence.replayMode ?? 'manual',
    initialStatus: conflict
      ? 'conflict'
      : input.persistence.replayMode === 'auto'
        ? 'pending'
        : 'manual',
    errorMessage: input.message,
    conflictMessage: conflict ? input.message : undefined,
    lastResponseStatus: input.status,
  }
  const queued = await enqueueMutation(mutation)
  if (queued.replayMode === 'auto' && queued.status === 'pending') {
    void replayQueuedMutations()
  }
  return queued
}

function serializeFormData(formData: FormData): StoredFormDataEntry[] {
  const entries: StoredFormDataEntry[] = []
  formData.forEach((value, name) => {
    if (typeof value === 'string') {
      entries.push({ name, value })
      return
    }
    const fileName =
      typeof File !== 'undefined' && value instanceof File && value.name
        ? value.name
        : undefined
    entries.push({ name, value, fileName })
  })
  return entries
}

export async function fetchWithMutationQueue(
  requestUrl: string,
  options: RequestInit,
  persistence: RequestPersistenceOptions,
) {
  const method = options.method || 'GET'
  const replayRequest = isQueuedReplayRequest(options.headers)
  const headers = normalizeHeaders(options.headers)
  const mutationId = getMutationId(headers) ?? generateMutationId()
  if (method.toUpperCase() !== 'GET' && !hasMutationId(headers)) {
    headers[MUTATION_ID_HEADER] = mutationId
  }
  const body = options.body
  try {
    const response = await fetch(requestUrl, {
      ...options,
      headers,
    })
    if (
      !replayRequest &&
      method.toUpperCase() !== 'GET' &&
      !response.ok &&
      (response.status >= 500 || isConflictResponse(response.status))
    ) {
      const message = await response.clone().text().catch(() => `HTTP ${response.status}`)
      await enqueueFailedRequest({
        url: requestUrl,
        method,
        headers,
        mutationId,
        body,
        persistence,
        status: response.status,
        message,
      })
    }
    if (response.ok && persistence.coalesceKey) {
      await discardQueuedMutationsByCoalesceKey(persistence.coalesceKey)
    }
    return response
  } catch (error) {
    if (!replayRequest && method.toUpperCase() !== 'GET') {
      await enqueueFailedRequest({
        url: requestUrl,
        method,
        headers,
        mutationId,
        body,
        persistence,
        message: error instanceof Error ? error.message : '网络请求失败',
      })
    }
    throw error
  }
}

export async function request<T>(url: string, options?: PersistedRequestInit): Promise<T> {
  const requestUrl = `${API_BASE}${url}`
  const method = options?.method || 'GET'
  const { persistence: rawPersistence, ...fetchOptions } = options ?? {}
  const isWrite = method.toUpperCase() !== 'GET'
  const replayRequest = isQueuedReplayRequest(fetchOptions.headers)
  const persistence =
    rawPersistence === false || !isWrite || replayRequest
      ? null
      : rawPersistence ?? {
          resourceKey: `generic:${method.toUpperCase()}:${url}`,
          description: `${method.toUpperCase()} ${url}`,
          replayMode: 'manual' as const,
        }
  const headers = {
    'Content-Type': 'application/json',
    ...normalizeHeaders(fetchOptions.headers),
  }
  const mutationId = getMutationId(headers) ?? generateMutationId()
  if (isWrite && !hasMutationId(headers)) {
    headers[MUTATION_ID_HEADER] = mutationId
  }
  let response: Response

  try {
    response = await fetch(requestUrl, {
      ...fetchOptions,
      headers,
    })
  } catch (error) {
    if (persistence) {
      await enqueueFailedRequest({
        url: requestUrl,
        method,
        headers,
        mutationId,
        body: fetchOptions.body,
        persistence,
        message: error instanceof Error ? error.message : '网络请求失败',
      })
    }
    logAppError({
      feature: 'API 请求',
      stage: 'network_failure',
      error,
      requestSummary: `${method} ${requestUrl}`,
      meta: {
        method,
        url: requestUrl,
      },
    })
    throw error
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const message = extractResponseMessage(response.status, body)
    const requestId = getResponseRequestId(response)
    if (persistence && (response.status >= 500 || isConflictResponse(response.status, message))) {
      await enqueueFailedRequest({
        url: requestUrl,
        method,
        headers,
        mutationId,
        body: fetchOptions.body,
        persistence,
        status: response.status,
        message,
      })
    }
    console.error('[API ERROR]', {
      url: requestUrl,
      method,
      status: response.status,
      body,
    })
    logAppError({
      feature: 'API 请求',
      stage: 'http_error',
      error: message,
      requestSummary: `${method} ${requestUrl}`,
      responseSummary: body.slice(0, 1200),
      requestId,
      meta: {
        method,
        url: requestUrl,
        status: response.status,
        requestId,
      },
    })
    throw buildRequestError(message, requestId)
  }

  if (persistence?.coalesceKey) {
    await discardQueuedMutationsByCoalesceKey(persistence.coalesceKey)
  }

  const contentType = response.headers.get('content-type')
  if (contentType?.includes('application/json')) {
    try {
      return await response.json()
    } catch (error) {
      const requestId = getResponseRequestId(response)
      logAppError({
        feature: 'API 请求',
        stage: 'json_parse_error',
        error,
        requestSummary: `${method} ${requestUrl}`,
        requestId,
        meta: {
          method,
          url: requestUrl,
          contentType,
          requestId,
        },
      })
      throw buildRequestError(
        error instanceof Error ? error.message || 'JSON 解析失败' : 'JSON 解析失败',
        requestId,
      )
    }
  }
  return response.text() as unknown as T
}

export async function uploadWithFormData<T>(
  url: string,
  formData: FormData,
  persistence: { resourceKey: string; description: string },
): Promise<T> {
  const response = await fetchWithMutationQueue(
    `${API_BASE}${url}`,
    {
      method: 'POST',
      body: formData,
    },
    {
      ...persistence,
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
      // Ignore JSON parse failures and use the raw text body.
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}
