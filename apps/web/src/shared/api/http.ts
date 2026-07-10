import { logAppError } from '@/shared/logs/model/appLogs'
import {
  buildRequestError,
  extractResponseMessage,
  getResponseRequestId,
} from '@/shared/api/jsonResponse'
import { getApiToken } from '@/shared/api/apiToken'
import { isConflictResponse } from '@/shared/api/conflict'
import {
  discardQueuedMutationsByCoalesceKey,
  enqueueMutation,
  isQueuedReplayRequest,
  replayQueuedMutations,
  type EnqueueMutationInput,
  type StoredFormDataEntry,
} from '@/shared/persistence/mutationQueue'

export const API_BASE = '/api/v1'
const MUTATION_ID_HEADER = 'X-Memory-Anki-Mutation-ID'
const LOW_INFORMATION_NETWORK_ERRORS = [
  'load failed',
  'failed to fetch',
  'networkerror',
  'network request failed',
]

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

function readBrowserRuntimeSummary() {
  if (typeof window === 'undefined') {
    return {
      currentUrl: '',
      onlineStatus: 'unknown',
      userAgent: '',
    }
  }
  return {
    currentUrl: window.location.href,
    onlineStatus:
      typeof navigator !== 'undefined' && 'onLine' in navigator
        ? navigator.onLine
          ? 'online'
          : 'offline'
        : 'unknown',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  }
}

function isLowInformationNetworkError(message: string) {
  const normalized = message.trim().toLowerCase()
  return LOW_INFORMATION_NETWORK_ERRORS.some((pattern) => normalized.includes(pattern))
}

function isLocalDesktopRuntime(currentUrl: string, userAgent: string) {
  if (/electron\//i.test(userAgent)) return true
  try {
    const hostname = new URL(currentUrl).hostname
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
  } catch {
    return false
  }
}

function formatCurrentUrlForMessage(currentUrl: string, userAgent: string) {
  if (!currentUrl) return ''
  if (!isLocalDesktopRuntime(currentUrl, userAgent)) return currentUrl
  try {
    const url = new URL(currentUrl)
    return `本机应用${url.pathname}${url.search}${url.hash}`
  } catch {
    return '本机应用'
  }
}

function buildNetworkFailureMessage(input: {
  method: string
  requestUrl: string
  error: unknown
}) {
  const rawMessage = input.error instanceof Error ? input.error.message : String(input.error || '')
  const runtime = readBrowserRuntimeSummary()
  const displayCurrentUrl = formatCurrentUrlForMessage(runtime.currentUrl, runtime.userAgent)
  const lines = [
    `网络请求失败：${input.method.toUpperCase()} ${input.requestUrl}`,
    rawMessage ? `浏览器错误：${rawMessage}` : null,
    displayCurrentUrl ? `当前页面：${displayCurrentUrl}` : null,
    `在线状态：${runtime.onlineStatus}`,
  ].filter(Boolean)

  if (isLowInformationNetworkError(rawMessage)) {
    if (isLocalDesktopRuntime(runtime.currentUrl, runtime.userAgent)) {
      lines.push(
        '这通常表示本机共享服务尚未启动、正在重启或暂时无法连接。',
        '请重新运行 start-desktop.bat；如果只使用手机 PWA，也可以运行 start-pwa.bat。桌面端与手机端会共用同一个本机服务。',
      )
    } else {
      lines.push(
        '这通常表示手机端没有真正连到 PWA 后端，或 Service Worker / Tailscale Serve 仍在使用旧连接。',
        '请依次检查：电脑端共享服务是否在运行；手机 Tailscale 是否已连接；Tailscale HTTPS 转发是否仍有效；刚更新后请访问 /pwa-reset.html 清理旧缓存。',
      )
    }
  }

  if (runtime.userAgent) {
    lines.push(`浏览器：${runtime.userAgent}`)
  }

  return lines.join('\n')
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
  const apiToken = getApiToken()
  if (apiToken && !headers['X-Memory-Anki-Token']) {
    headers['X-Memory-Anki-Token'] = apiToken
  }
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
    const networkMessage = buildNetworkFailureMessage({
      method,
      requestUrl: requestUrl,
      error,
    })
    if (!replayRequest && method.toUpperCase() !== 'GET') {
      await enqueueFailedRequest({
        url: requestUrl,
        method,
        headers,
        mutationId,
        body,
        persistence,
        message: networkMessage,
      })
    }
    throw new Error(networkMessage, { cause: error })
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
  const apiToken = getApiToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(apiToken ? { 'X-Memory-Anki-Token': apiToken } : {}),
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
    const networkMessage = buildNetworkFailureMessage({
      method,
      requestUrl,
      error,
    })
    if (persistence) {
      await enqueueFailedRequest({
        url: requestUrl,
        method,
        headers,
        mutationId,
        body: fetchOptions.body,
        persistence,
        message: networkMessage,
      })
    }
    logAppError({
      feature: 'API 请求',
      stage: 'network_failure',
      error: networkMessage,
      requestSummary: `${method} ${requestUrl}`,
      meta: {
        method,
        url: requestUrl,
        originalError: error instanceof Error ? error.message : String(error),
      },
    })
    throw new Error(networkMessage, { cause: error })
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
