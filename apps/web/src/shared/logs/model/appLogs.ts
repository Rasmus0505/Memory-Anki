export type AppLogKind = 'ai_call' | 'app_error'

export interface AppLogEntry {
  id: string
  kind: AppLogKind
  createdAt: string
  feature: string
  route: string
  stage: string
  requestSummary: string
  responseSummary: string
  errorMessage: string
  jobId: string
  requestId: string
  meta: Record<string, unknown>
}

type AppLogListener = () => void

const STORAGE_KEY = 'memory_anki_app_logs'
const CHANGE_EVENT = 'memory-anki-app-logs:changed'
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

const listeners = new Set<AppLogListener>()

function nowIso() {
  return new Date().toISOString()
}

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function getRoute() {
  if (typeof window === 'undefined') return ''
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function normalizeDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return nowIso()
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : nowIso()
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function normalizeMeta(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizeEntry(value: unknown): AppLogEntry | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<AppLogEntry>
  const kind = raw.kind === 'ai_call' || raw.kind === 'app_error' ? raw.kind : null
  if (!kind) return null
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : generateId(),
    kind,
    createdAt: normalizeDate(raw.createdAt),
    feature: normalizeString(raw.feature),
    route: normalizeString(raw.route),
    stage: normalizeString(raw.stage),
    requestSummary: normalizeString(raw.requestSummary),
    responseSummary: normalizeString(raw.responseSummary),
    errorMessage: normalizeString(raw.errorMessage),
    jobId: normalizeString(raw.jobId),
    requestId: normalizeString(raw.requestId),
    meta: normalizeMeta(raw.meta),
  }
}

function pruneEntries(entries: AppLogEntry[]) {
  const cutoff = Date.now() - RETENTION_MS
  return entries.filter((entry) => {
    const timestamp = Date.parse(entry.createdAt)
    return Number.isFinite(timestamp) && timestamp >= cutoff
  })
}

function sortEntries(entries: AppLogEntry[]) {
  return [...entries].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
}

function persistEntries(entries: AppLogEntry[]) {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Ignore quota and serialization failures.
  }
}

function notifyListeners() {
  listeners.forEach((listener) => listener())
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }
}

export function summarizeUnknownError(error: unknown) {
  if (error instanceof Error) return error.message || error.name || '未知错误'
  if (typeof error === 'string') return error
  if (error == null) return ''
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function readAppLogs() {
  const storage = getStorage()
  if (!storage) return [] as AppLogEntry[]
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown[]
    const entries = Array.isArray(parsed)
      ? parsed.map((item) => normalizeEntry(item)).filter((item): item is AppLogEntry => Boolean(item))
      : []
    const pruned = sortEntries(pruneEntries(entries))
    if (pruned.length !== entries.length) {
      persistEntries(pruned)
    }
    return pruned
  } catch {
    return []
  }
}

export function cleanupExpiredAppLogs() {
  const entries = readAppLogs()
  persistEntries(entries)
  notifyListeners()
  return entries
}

export function addAppLog(
  entry: Partial<AppLogEntry> & Pick<AppLogEntry, 'kind' | 'feature'>,
) {
  const nextEntry: AppLogEntry = {
    id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : generateId(),
    kind: entry.kind,
    createdAt: normalizeDate(entry.createdAt),
    feature: normalizeString(entry.feature),
    route: normalizeString(entry.route) || getRoute(),
    stage: normalizeString(entry.stage),
    requestSummary: normalizeString(entry.requestSummary),
    responseSummary: normalizeString(entry.responseSummary),
    errorMessage: normalizeString(entry.errorMessage),
    jobId: normalizeString(entry.jobId),
    requestId: normalizeString(entry.requestId),
    meta: normalizeMeta(entry.meta),
  }
  const entries = sortEntries(pruneEntries([nextEntry, ...readAppLogs()]))
  persistEntries(entries)
  notifyListeners()
  return nextEntry
}

export function removeAppLog(id: string) {
  const entries = readAppLogs().filter((entry) => entry.id !== id)
  persistEntries(entries)
  notifyListeners()
  return entries
}

export function clearAppLogs() {
  persistEntries([])
  notifyListeners()
}

export function subscribeAppLogs(listener: AppLogListener) {
  listeners.add(listener)
  if (typeof window !== 'undefined') {
    window.addEventListener(CHANGE_EVENT, listener)
  }
  return () => {
    listeners.delete(listener)
    if (typeof window !== 'undefined') {
      window.removeEventListener(CHANGE_EVENT, listener)
    }
  }
}

function formatMeta(meta: Record<string, unknown>) {
  const keys = Object.keys(meta)
  if (keys.length === 0) return ''
  try {
    return JSON.stringify(meta, null, 2)
  } catch {
    return keys.map((key) => `${key}: ${String(meta[key])}`).join('\n')
  }
}

export function formatAppLogEntry(entry: AppLogEntry) {
  const parts = [
    `[${entry.kind}] ${entry.feature || '未命名事件'}`,
    `时间: ${entry.createdAt}`,
    `页面: ${entry.route || '未知页面'}`,
  ]
  if (entry.stage) parts.push(`阶段: ${entry.stage}`)
  if (entry.jobId) parts.push(`任务: ${entry.jobId}`)
  if (entry.requestId) parts.push(`请求ID: ${entry.requestId}`)
  if (entry.requestSummary) parts.push(`请求摘要: ${entry.requestSummary}`)
  if (entry.responseSummary) parts.push(`返回摘要: ${entry.responseSummary}`)
  if (entry.errorMessage) parts.push(`错误信息: ${entry.errorMessage}`)
  const metaText = formatMeta(entry.meta)
  if (metaText) parts.push(`附加信息:\n${metaText}`)
  return parts.join('\n')
}

export function formatAppLogs(entries: AppLogEntry[]) {
  return entries.map((entry) => formatAppLogEntry(entry)).join('\n\n---\n\n')
}

export function logAppError(input: {
  feature: string
  stage?: string
  error: unknown
  requestSummary?: string
  responseSummary?: string
  meta?: Record<string, unknown>
  jobId?: string
  requestId?: string
  route?: string
}) {
  return addAppLog({
    kind: 'app_error',
    feature: input.feature,
    stage: input.stage || 'error',
    route: input.route,
    requestSummary: input.requestSummary,
    responseSummary: input.responseSummary,
    errorMessage: summarizeUnknownError(input.error),
    jobId: input.jobId,
    requestId: input.requestId,
    meta: input.meta,
  })
}

export function logAiCall(input: {
  feature: string
  stage: string
  requestSummary?: string
  responseSummary?: string
  errorMessage?: string
  meta?: Record<string, unknown>
  jobId?: string
  requestId?: string
  route?: string
}) {
  return addAppLog({
    kind: 'ai_call',
    feature: input.feature,
    stage: input.stage,
    route: input.route,
    requestSummary: input.requestSummary,
    responseSummary: input.responseSummary,
    errorMessage: input.errorMessage,
    jobId: input.jobId,
    requestId: input.requestId,
    meta: input.meta,
  })
}
