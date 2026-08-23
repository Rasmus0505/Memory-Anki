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
const LOCAL_GET_RETRY_DELAYS_MS = [250, 750]
// 读请求超时预算。半开连接（手机休眠、Tailscale 重连、后端重启中）下 fetch 不会 reject，
// 于是页面永远停在骨架屏且没有重试入口。超时把它变成一个可见、可重试的错误。
// 写请求刻意不设超时：请求已经发出去了，超时只会让客户端与服务端状态产生分歧，
// 让 mutation queue 保持唯一权威。
const GET_REQUEST_TIMEOUT_MS = 20_000
const TIMEOUT_ERROR_NAME = 'MemoryAnkiRequestTimeoutError'

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

function createRequestTimeoutError(method: string, requestUrl: string) {
  const error = new Error(
    `请求超过 ${Math.round(GET_REQUEST_TIMEOUT_MS / 1000)} 秒未响应：${method.toUpperCase()} ${requestUrl}`,
  )
  error.name = TIMEOUT_ERROR_NAME
  return error
}

function isRequestTimeoutError(error: unknown) {
  return error instanceof Error && error.name === TIMEOUT_ERROR_NAME
}

function isAbortError(error: unknown) {
  if (isRequestTimeoutError(error)) return true
  if (error instanceof Error) return error.name === 'AbortError' || error.name === 'TimeoutError'
  return false
}

interface TimedFetchResponse {
  response: Response
  finish: () => void
  normalizeBodyError: (error: unknown) => unknown
  readBody: <T>(read: () => Promise<T>) => Promise<T>
}

async function fetchWithTransientRetry(
  requestUrl: string,
  init: RequestInit,
  method: string,
): Promise<TimedFetchResponse> {
  const isGet = method.toUpperCase() === 'GET'
  const shouldRetry = isGet
  // 调用方自带 signal 时不接管它的生命周期，只保留原有行为。
  const shouldTimeout = isGet && !init.signal
  let lastError: unknown
  for (let attempt = 0; attempt <= (shouldRetry ? LOCAL_GET_RETRY_DELAYS_MS.length : 0); attempt += 1) {
    // 每次重试都要新的 controller：AbortSignal 一旦 abort 就无法复用。
    const controller = shouldTimeout ? new AbortController() : null
    const timer = controller
      ? window.setTimeout(() => controller.abort(createRequestTimeoutError(method, requestUrl)), GET_REQUEST_TIMEOUT_MS)
      : null
    const finish = () => {
      if (timer !== null) window.clearTimeout(timer)
    }
    const normalizeBodyError = (error: unknown) => (
      controller?.signal.aborted && isAbortError(error)
        ? createRequestTimeoutError(method, requestUrl)
        : error
    )
    const readBody = <T>(read: () => Promise<T>) => {
      if (!controller) return read()
      return new Promise<T>((resolve, reject) => {
        let settled = false
        const settle = (callback: () => void) => {
          if (settled) return
          settled = true
          controller.signal.removeEventListener('abort', onAbort)
          callback()
        }
        const onAbort = () => settle(() => reject(createRequestTimeoutError(method, requestUrl)))
        controller.signal.addEventListener('abort', onAbort, { once: true })
        if (controller.signal.aborted) {
          onAbort()
          return
        }
        Promise.resolve()
          .then(read)
          .then(
            (value) => settle(() => resolve(value)),
            (error) => settle(() => reject(error)),
          )
      })
    }
    try {
      const response = await fetch(requestUrl, controller ? { ...init, signal: controller.signal } : init)
      // Keep a GET's budget alive until its body is consumed. A half-open
      // Tailscale response can resolve fetch() at headers and then leave
      // response.json() pending forever.
      return { response, finish, normalizeBodyError, readBody }
    } catch (error) {
      // 超时后不再重试：连挂 20s 的链路，再等 3 次只会把 20s 变成 60s。
      finish()
      const normalized = normalizeBodyError(error)
      lastError = normalized
      const rawMessage = normalized instanceof Error ? normalized.message : String(normalized || '')
      const runtime = readBrowserRuntimeSummary()
      if (
        !shouldRetry
        || isRequestTimeoutError(normalized)
        || !isLocalDesktopRuntime(runtime.currentUrl, runtime.userAgent)
        || !isLowInformationNetworkError(rawMessage)
        || attempt >= LOCAL_GET_RETRY_DELAYS_MS.length
      ) {
        throw normalized
      }
      await new Promise((resolve) => window.setTimeout(resolve, LOCAL_GET_RETRY_DELAYS_MS[attempt]))
    }
  }
  throw lastError
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

  if (isRequestTimeoutError(input.error)) {
    if (isLocalDesktopRuntime(runtime.currentUrl, runtime.userAgent)) {
      lines.push(
        '连接已建立但服务端迟迟没有返回，通常是本机服务正在重启、迁移数据库或被占用。',
        '请稍等几秒后重试；若持续如此，请重新运行 start-all.bat 并查看 logs/ 下的日志。',
      )
    } else {
      lines.push(
        '连接没有断开，但一直没有响应，通常是 Tailscale 链路半开（手机休眠后重连）或电脑端服务已停止。',
        '请先重试；仍然无响应时，关掉再打开手机 Tailscale 开关，并确认电脑端共享服务仍在运行。',
      )
    }
  } else if (isLowInformationNetworkError(rawMessage)) {
    if (isLocalDesktopRuntime(runtime.currentUrl, runtime.userAgent)) {
      lines.push(
        '这通常表示本机共享服务尚未启动、正在重启或暂时无法连接。',
        '请重新运行 start-all.bat（可选 --desktop / --pwa / --both）。桌面端与手机端会共用同一个本机服务。',
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
  let timedResponse: TimedFetchResponse

  try {
    timedResponse = await fetchWithTransientRetry(requestUrl, {
      ...fetchOptions,
      headers,
    }, method)
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

  const { response } = timedResponse
  try {
    if (!response.ok) {
      const body = await timedResponse.readBody(() => response.text()).catch((error: unknown) => {
        const normalized = timedResponse.normalizeBodyError(error)
        if (isRequestTimeoutError(normalized)) throw normalized
        return ''
      })
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
      throw buildRequestError(message, requestId, {
        feature: persistence?.description || 'API 请求',
        method,
        url: requestUrl,
        status: response.status,
      })
    }

    if (persistence?.coalesceKey) {
      await discardQueuedMutationsByCoalesceKey(persistence.coalesceKey)
    }

    const contentType = response.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      try {
        return await timedResponse.readBody(() => response.json())
      } catch (error) {
        const normalized = timedResponse.normalizeBodyError(error)
        if (isRequestTimeoutError(normalized)) throw normalized
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
          {
            feature: persistence?.description || 'API 响应解析',
            method,
            url: requestUrl,
            status: response.status,
          },
        )
      }
    }
    return await timedResponse.readBody(() => response.text()) as unknown as T
  } catch (error) {
    const normalized = timedResponse.normalizeBodyError(error)
    if (!isRequestTimeoutError(normalized)) throw error
    const networkMessage = buildNetworkFailureMessage({
      method,
      requestUrl,
      error: normalized,
    })
    logAppError({
      feature: 'API 请求',
      stage: 'network_failure',
      error: networkMessage,
      requestSummary: `${method} ${requestUrl}`,
      meta: {
        method,
        url: requestUrl,
        originalError: normalized instanceof Error ? normalized.message : String(normalized),
      },
    })
    throw new Error(networkMessage, { cause: error })
  } finally {
    timedResponse.finish()
  }
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
      } else if (
        parsed.detail
        && typeof parsed.detail === 'object'
        && 'message' in parsed.detail
        && typeof parsed.detail.message === 'string'
        && parsed.detail.message.trim()
      ) {
        message = parsed.detail.message
      }
    } catch {
      // Ignore JSON parse failures and use the raw text body.
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}
