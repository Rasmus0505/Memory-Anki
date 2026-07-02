import { isConflictResponse } from '@/shared/api/conflict'

export type MutationQueueStatus = 'pending' | 'syncing' | 'failed' | 'conflict' | 'manual'

export type MutationBodyKind = 'json' | 'formData' | 'empty'

export interface StoredFormDataEntry {
  name: string
  value: string | Blob
  fileName?: string
}

export interface PersistedMutation {
  id: string
  mutationId: string
  resourceKey: string
  coalesceKey?: string | null
  description: string
  url: string
  method: string
  headers: Record<string, string>
  bodyKind: MutationBodyKind
  body: string | null
  formDataEntries?: StoredFormDataEntry[]
  replayMode: 'auto' | 'manual'
  status: MutationQueueStatus
  attemptCount: number
  createdAt: string
  updatedAt: string
  nextAttemptAt: number
  errorMessage?: string
  conflictMessage?: string
  lastResponseStatus?: number
}

export interface EnqueueMutationInput {
  id?: string
  mutationId?: string
  resourceKey: string
  coalesceKey?: string | null
  description?: string
  url: string
  method: string
  headers?: Record<string, string>
  bodyKind?: MutationBodyKind
  body?: string | null
  formDataEntries?: StoredFormDataEntry[]
  replayMode?: 'auto' | 'manual'
  initialStatus?: MutationQueueStatus
  errorMessage?: string
  conflictMessage?: string
  lastResponseStatus?: number
}

export interface MutationQueueSummary {
  total: number
  pending: number
  syncing: number
  failed: number
  conflict: number
  manual: number
  autoRunnable: number
}

const DB_NAME = 'memory-anki-mutation-queue'
const STORE_NAME = 'mutations'
const DB_VERSION = 1
const CHANGE_EVENT = 'memory-anki-mutation-queue:changed'
const REPLAY_HEADER = 'X-Memory-Anki-Queued-Replay'
const MUTATION_HEADER = 'X-Memory-Anki-Mutation-ID'

const memoryStore = new Map<string, PersistedMutation>()
let replayInFlight: Promise<void> | null = null

function nowIso() {
  return new Date().toISOString()
}

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function canUseIndexedDb() {
  return typeof indexedDB !== 'undefined'
}

function openDb() {
  if (!canUseIndexedDb()) {
    return Promise.resolve<IDBDatabase | null>(null)
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('status', 'status', { unique: false })
        store.createIndex('resourceKey', 'resourceKey', { unique: false })
        store.createIndex('coalesceKey', 'coalesceKey', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open mutation queue'))
  }).catch(() => null)
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await openDb()
  if (!db) return null
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)
    const request = action(store)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Mutation queue request failed'))
    transaction.oncomplete = () => db.close()
    transaction.onerror = () => {
      db.close()
      reject(transaction.error ?? new Error('Mutation queue transaction failed'))
    }
  }).catch(() => {
    db.close()
    return null
  })
}

async function putMutation(item: PersistedMutation) {
  const result = await withStore('readwrite', (store) => store.put(item))
  if (result === null) {
    memoryStore.set(item.id, item)
  }
}

async function deleteMutationFromStore(id: string) {
  const result = await withStore('readwrite', (store) => store.delete(id))
  if (result === null) {
    memoryStore.delete(id)
  }
}

export async function readQueuedMutations() {
  const result = await withStore<PersistedMutation[]>('readonly', (store) => store.getAll())
  const items = result ?? Array.from(memoryStore.values())
  return items.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
}

function notifyMutationQueueChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function subscribeMutationQueue(listener: () => void) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CHANGE_EVENT, listener)
  return () => window.removeEventListener(CHANGE_EVENT, listener)
}

export function buildMutationSummary(items: PersistedMutation[]): MutationQueueSummary {
  const summary: MutationQueueSummary = {
    total: items.length,
    pending: 0,
    syncing: 0,
    failed: 0,
    conflict: 0,
    manual: 0,
    autoRunnable: 0,
  }
  const now = Date.now()
  for (const item of items) {
    summary[item.status] += 1
    if (
      item.replayMode === 'auto' &&
      (item.status === 'pending' || item.status === 'failed') &&
      item.nextAttemptAt <= now
    ) {
      summary.autoRunnable += 1
    }
  }
  return summary
}

export async function getMutationQueueSummary() {
  return buildMutationSummary(await readQueuedMutations())
}

function normalizeHeaders(headers: Record<string, string> | undefined) {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (value == null) continue
    result[key] = String(value)
  }
  return result
}

export function isQueuedReplayRequest(headers?: HeadersInit) {
  if (!headers) return false
  if (headers instanceof Headers) return headers.get(REPLAY_HEADER) === 'true'
  if (Array.isArray(headers)) {
    return headers.some(([key, value]) => key.toLowerCase() === REPLAY_HEADER.toLowerCase() && value === 'true')
  }
  return Object.entries(headers).some(
    ([key, value]) => key.toLowerCase() === REPLAY_HEADER.toLowerCase() && value === 'true',
  )
}

export async function enqueueMutation(input: EnqueueMutationInput) {
  const queuedAt = nowIso()
  const id = input.id ?? generateId()
  const mutationId = input.mutationId ?? generateId()
  const nextItem: PersistedMutation = {
    id,
    mutationId,
    resourceKey: input.resourceKey,
    coalesceKey: input.coalesceKey ?? null,
    description: input.description || `${input.method.toUpperCase()} ${input.url}`,
    url: input.url,
    method: input.method.toUpperCase(),
    headers: normalizeHeaders(input.headers),
    bodyKind: input.bodyKind ?? (input.body ? 'json' : 'empty'),
    body: input.body ?? null,
    formDataEntries: input.formDataEntries,
    replayMode: input.replayMode ?? 'manual',
    status: input.initialStatus ?? (input.replayMode === 'auto' ? 'pending' : 'manual'),
    attemptCount: 0,
    createdAt: queuedAt,
    updatedAt: queuedAt,
    nextAttemptAt: Date.now(),
    errorMessage: input.errorMessage,
    conflictMessage: input.conflictMessage,
    lastResponseStatus: input.lastResponseStatus,
  }

  if (nextItem.coalesceKey) {
    const current = await readQueuedMutations()
    const existing = current
      .filter((item) => item.coalesceKey === nextItem.coalesceKey && item.status !== 'syncing')
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0]
    if (existing) {
      nextItem.id = existing.id
      nextItem.mutationId = existing.mutationId
      nextItem.createdAt = existing.createdAt
    }
  }

  await putMutation(nextItem)
  notifyMutationQueueChanged()
  return nextItem
}

async function updateMutation(item: PersistedMutation, patch: Partial<PersistedMutation>) {
  const nextItem = {
    ...item,
    ...patch,
    updatedAt: nowIso(),
  }
  await putMutation(nextItem)
  notifyMutationQueueChanged()
  return nextItem
}

function rebuildBody(item: PersistedMutation) {
  if (item.bodyKind === 'empty') return undefined
  if (item.bodyKind === 'formData') {
    const form = new FormData()
    for (const entry of item.formDataEntries ?? []) {
      if (typeof entry.value === 'string') {
        form.append(entry.name, entry.value)
      } else {
        form.append(entry.name, entry.value, entry.fileName)
      }
    }
    return form
  }
  return item.body ?? ''
}

function buildReplayHeaders(item: PersistedMutation) {
  const headers = new Headers(item.headers)
  headers.set(MUTATION_HEADER, item.mutationId)
  headers.set(REPLAY_HEADER, 'true')
  if (item.bodyKind === 'formData') {
    headers.delete('Content-Type')
  }
  return headers
}

function nextBackoffMs(attemptCount: number) {
  return Math.min(5 * 60_000, Math.max(1_000, 2 ** Math.min(attemptCount, 8) * 1_000))
}

async function replayOneMutation(item: PersistedMutation, force = false) {
  if (!force && item.replayMode !== 'auto') return
  if (!force && item.nextAttemptAt > Date.now()) return

  const current = await updateMutation(item, { status: 'syncing' })
  try {
    const response = await fetch(current.url, {
      method: current.method,
      headers: buildReplayHeaders(current),
      body: rebuildBody(current),
    })
    const bodyText = await response.text().catch(() => '')
    if (response.ok) {
      await deleteMutationFromStore(current.id)
      notifyMutationQueueChanged()
      return
    }
    const errorMessage = bodyText || `HTTP ${response.status}`
    if (isConflictResponse(response.status, errorMessage)) {
      await updateMutation(current, {
        status: 'conflict',
        conflictMessage: errorMessage,
        errorMessage,
        lastResponseStatus: response.status,
      })
      return
    }
    const attemptCount = current.attemptCount + 1
    await updateMutation(current, {
      status: response.status >= 500 ? 'failed' : 'manual',
      attemptCount,
      nextAttemptAt: Date.now() + nextBackoffMs(attemptCount),
      errorMessage,
      lastResponseStatus: response.status,
    })
  } catch (error) {
    const attemptCount = current.attemptCount + 1
    await updateMutation(current, {
      status: 'failed',
      attemptCount,
      nextAttemptAt: Date.now() + nextBackoffMs(attemptCount),
      errorMessage: error instanceof Error ? error.message : '同步失败',
    })
  }
}

export async function replayQueuedMutations(options: { forceIds?: string[] } = {}) {
  if (replayInFlight) return replayInFlight
  replayInFlight = (async () => {
    const forceIds = new Set(options.forceIds ?? [])
    const items = await readQueuedMutations()
    for (const item of items) {
      await replayOneMutation(item, forceIds.has(item.id))
    }
  })().finally(() => {
    replayInFlight = null
  })
  return replayInFlight
}

export async function discardQueuedMutation(id: string) {
  await deleteMutationFromStore(id)
  notifyMutationQueueChanged()
}

export async function discardQueuedMutationsByCoalesceKey(coalesceKey: string | null | undefined) {
  if (!coalesceKey) return
  const items = await readQueuedMutations()
  await Promise.all(
    items
      .filter((item) => item.coalesceKey === coalesceKey && item.status !== 'syncing')
      .map((item) => deleteMutationFromStore(item.id)),
  )
  notifyMutationQueueChanged()
}

export async function markQueuedMutationManual(id: string, message?: string) {
  const item = (await readQueuedMutations()).find((candidate) => candidate.id === id)
  if (!item) return null
  return updateMutation(item, {
    status: 'manual',
    errorMessage: message ?? item.errorMessage,
    nextAttemptAt: Number.POSITIVE_INFINITY,
  })
}

export async function confirmQueuedMutationOverwrite(id: string) {
  const item = (await readQueuedMutations()).find((candidate) => candidate.id === id)
  if (!item || item.bodyKind !== 'json' || !item.body) return null
  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(item.body) as unknown
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return null
  }
  delete body.expected_editor_fingerprint
  body.confirm_dangerous_change = true
  body.allow_stale_overwrite = true
  if (!body.editor_source || body.editor_source === 'palace_edit_autosave') {
    body.editor_source = 'palace_edit'
  }
  return updateMutation(item, {
    body: JSON.stringify(body),
    status: 'pending',
    replayMode: 'auto',
    nextAttemptAt: Date.now(),
    conflictMessage: undefined,
    errorMessage: undefined,
  })
}

export async function resetMutationQueueForTest() {
  const items = await readQueuedMutations()
  await Promise.all(items.map((item) => deleteMutationFromStore(item.id)))
  memoryStore.clear()
  notifyMutationQueueChanged()
}
