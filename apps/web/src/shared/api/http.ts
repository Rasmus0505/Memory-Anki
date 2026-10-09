import { noteApiStep } from '@/shared/api/requestOutcome'
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
/**
 * Correlation id for the server's request log.
 *
 * The backend already accepts and echoes this header
 * (`core/request_logging.py` reads `X-Request-ID`, stamps it on every log line
 * and returns it in the response), but the client never sent one, so the server
 * minted its own id per request and threw it away when the response failed to
 * arrive. That broke the causal chain in exactly the case that matters: a
 * request that times out or is killed by a lock has no response, therefore no
 * server-generated id, therefore nothing in the browser that can be matched
 * against `logs/pwa-api.log`. Diagnosing it required guessing from timestamps.
 *
 * Sending our own id fixes that: one user action, one id, visible in the copied
 * diagnostics AND in every server log line for that request.
 */
const REQUEST_ID_HEADER = 'X-Request-ID'
const LOW_INFORMATION_NETWORK_ERRORS = [
  'load failed',
  'failed to fetch',
  'networkerror',
  'network request failed',
]
const LOCAL_GET_RETRY_DELAYS_MS = [250, 750]
// 读请求超时预算。半开连接（手机休眠、Tailscale 重连、后端重启中）下 fetch 不会 reject，
// 于是页面永远停在骨架屏且没有重试入口。超时把它变成一个可见、可重试的错误。
// 写请求默认不设超时：请求已经发出去了，超时只会让客户端与服务端状态产生分歧，
// 让 mutation queue 保持唯一权威。唯一的例外是显式传 timeoutMs 的写请求，见
// PersistedRequestInit.timeoutMs。
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
  /**
   * Optional per-request transport timeout, overriding the default
   * "writes are never timed out" rule. Only use it for write requests that the
   * caller retries itself and keeps out of the mutation queue (`persistence:
   * false`) — otherwise a timeout would create a client/server divergence that
   * the queue is supposed to prevent.
   */
  timeoutMs?: number
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

function hasHeader(headers: Record<string, string>, name: string) {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase())
}

/**
 * Ensure the request carries a correlation id, returning the one in use.
 *
 * A caller that already set `X-Request-ID` keeps it, so a retry of the same
 * operation can deliberately reuse the id its first attempt was logged under —
 * that is what turns "three failed attempts" into one traceable story.
 */
function ensureRequestId(headers: Record<string, string>) {
  if (!hasHeader(headers, REQUEST_ID_HEADER)) {
    headers[REQUEST_ID_HEADER] = generateMutationId()
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === REQUEST_ID_HEADER.toLowerCase()) return value
  }
  return ''
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
  if (!currentUrl) return false
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

function createRequestTimeoutError(method: string, requestUrl: string, budgetMs: number) {
  const error = new Error(
    `请求超过 ${Math.round(budgetMs / 1000)} 秒未响应：${method.toUpperCase()} ${requestUrl}`,
  )
  error.name = TIMEOUT_ERROR_NAME
  return error
}

/** Reads get a default budget; writes only when the caller opts in. */
function resolveRequestTimeoutMs(method: string, timeoutMs?: number) {
  if (typeof timeoutMs === 'number' && timeoutMs > 0) return timeoutMs
  return method.toUpperCase() === 'GET' ? GET_REQUEST_TIMEOUT_MS : null
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
  timeoutMs?: number,
): Promise<TimedFetchResponse> {
  const isGet = method.toUpperCase() === 'GET'
  const shouldRetry = isGet
  const configuredTimeoutMs = resolveRequestTimeoutMs(method, timeoutMs)
  const budgetMs = configuredTimeoutMs ?? GET_REQUEST_TIMEOUT_MS
  // 调用方自带 signal 时不接管它的生命周期，只保留原有行为。
  const shouldTimeout = configuredTimeoutMs !== null && !init.signal
  let lastError: unknown
  for (let attempt = 0; attempt <= (shouldRetry ? LOCAL_GET_RETRY_DELAYS_MS.length : 0); attempt += 1) {
    // 每次重试都要新的 controller：AbortSignal 一旦 abort 就无法复用。
    const controller = shouldTimeout ? new AbortController() : null
    const timer = controller
      ? window.setTimeout(() => controller.abort(createRequestTimeoutError(method, requestUrl, budgetMs)), budgetMs)
      : null
    const finish = () => {
      if (timer !== null) window.clearTimeout(timer)
    }
    const normalizeBodyError = (error: unknown) => (
      controller?.signal.aborted && isAbortError(error)
        ? createRequestTimeoutError(method, requestUrl, budgetMs)
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
        const onAbort = () => settle(() => reject(createRequestTimeoutError(method, requestUrl, budgetMs)))
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
        '连接是通的，这一步还没完成。先继续看这张卡，软件会自己再试。',
        '不用重启软件。若多次都这样，用「复制给助手」把下面的内容发过来即可。',
      )
    } else {
      // A timeout means the request reached the server and the server is slow:
      // the TCP connection was established. A half-open link fails at connect or
      // hangs the whole page, not just one endpoint. Leading with Tailscale sent
      // users chasing the wrong fix during the pool-exhaustion incident, when the
      // server was simply holding the request for 30s+.
      lines.push(
        '连接是通的，但服务端在这段时间内没有处理完这条请求——通常是电脑端后端正忙（并发请求排队、数据库连接被占满）或正在重启。',
        '请先直接重试；连续多次都超时的话，看一眼电脑端是否卡住（后端日志 logs/pwa-api.log 里是否有大量耗时 30 秒左右的请求）。',
        '只有在重试毫无反应、且页面其他请求也一起卡住时，才考虑链路问题：关掉再打开手机 Tailscale 开关。',
      )
    }
  } else if (isLowInformationNetworkError(rawMessage)) {
    if (isLocalDesktopRuntime(runtime.currentUrl, runtime.userAgent)) {
      lines.push(
        '本机服务正在重新连上，软件会自己再试。',
        '先继续看题即可，不用重启。',
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
  const queued = await enqueueMutation(mutation).catch((error: unknown) => {
    // The request has already failed; a storage failure must not mask that
    // original, user-actionable error. It must not pass silently either: an
    // unqueueable write means there is nothing left to retry, so it is logged
    // where the app logs are read.
    logAppError({
      feature: 'API 请求',
      stage: 'mutation_queue_write_failed',
      error,
      requestSummary: `${input.method} ${input.url}`,
      meta: {
        method: input.method,
        url: input.url,
        replayMode: input.persistence.replayMode ?? 'manual',
        resourceKey: input.persistence.resourceKey,
      },
    })
    return null
  })
  if (queued && queued.replayMode === 'auto' && queued.status === 'pending') {
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
  ensureRequestId(headers)
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
  const startedAt = Date.now()
  const note = (ok: boolean, status: number | null, message: string, queuedRetry: boolean) => {
    noteApiStep({ method, url: requestUrl, ok, status, message, queuedRetry, startedAt })
  }
  const { persistence: rawPersistence, timeoutMs, ...fetchOptions } = options ?? {}
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
  ensureRequestId(headers)
  let timedResponse: TimedFetchResponse

  try {
    timedResponse = await fetchWithTransientRetry(requestUrl, {
      ...fetchOptions,
      headers,
    }, method, timeoutMs)
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
    note(false, null, networkMessage, Boolean(persistence))
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
      note(
        false,
        response.status,
        message,
        Boolean(persistence && (response.status >= 500 || isConflictResponse(response.status, message))),
      )
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
        const payload = await timedResponse.readBody(() => response.json())
        note(true, response.status, '', false)
        return payload
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
        note(false, response.status, error instanceof Error ? error.message || 'JSON 解析失败' : 'JSON 解析失败', false)
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
    const text = await timedResponse.readBody(() => response.text())
    note(true, response.status, '', false)
    return text as unknown as T
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
    note(false, null, networkMessage, false)
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
  const startedAt = Date.now()
  const requestUrl = `${API_BASE}${url}`
  const note = (ok: boolean, status: number | null, message: string, queuedRetry: boolean) => {
    noteApiStep({ method: 'POST', url: requestUrl, ok, status, message, queuedRetry, startedAt })
  }
  let response: Response
  try {
    response = await fetchWithMutationQueue(requestUrl, { method: 'POST', body: formData }, {
      ...persistence,
      replayMode: 'manual',
    })
  } catch (error) {
    note(false, null, error instanceof Error ? error.message : '上传没有成功', true)
    throw error
  }
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
    note(false, response.status, message, response.status >= 500)
    throw new Error(message)
  }
  note(true, response.status, '', false)
  return response.json() as Promise<T>
}
