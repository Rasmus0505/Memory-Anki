import { isConflictResponse } from '@/shared/api/conflict'
import { getApiToken } from '@/shared/api/apiToken'
import { generateLocalId } from '@/shared/lib/ids'
import { createIdbHandle } from '@/shared/persistence/indexedDb'

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
const REPLAY_HEADER = 'X-Memory-Anki-Queued-Replay'
const MUTATION_HEADER = 'X-Memory-Anki-Mutation-ID'

const memoryStore = new Map<string, PersistedMutation>()
let replayInFlight: Promise<void> | null = null

function nowIso() {
  return new Date().toISOString()
}

function generateId() {
  return generateLocalId()
}

/**
 * IndexedDB access for the queue.
 *
 * The durability rule — a write settles on `transaction.oncomplete`, not
 * `request.onsuccess` — lives in the shared handle so it cannot drift again.
 * `null` means IndexedDB is unavailable (fall back to `memoryStore`); a failed
 * or aborted transaction rejects, because storage failure must never masquerade
 * as a saved queued mutation.
 */
const idb = createIdbHandle({
  db: DB_NAME,
  version: DB_VERSION,
  store: STORE_NAME,
  upgrade: (db) => {
    if (db.objectStoreNames.contains(STORE_NAME)) return
    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
    store.createIndex('status', 'status', { unique: false })
    store.createIndex('resourceKey', 'resourceKey', { unique: false })
    store.createIndex('coalesceKey', 'coalesceKey', { unique: false })
  },
})

function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  return idb.run(mode, action)
}

async function putMutation(item: PersistedMutation) {
  const result = await withStore('readwrite', (store) => store.put(item))
  // null means IndexedDB is unavailable, not that the write failed.
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

/**
 * Read the whole queue.
 *
 * The queue is bounded in practice: it holds only writes that have not reached
 * the server, and the durability contract keeps it small (successful replays
 * remove their entry, and replays carry the original mutation id so the server
 * deduplicates). On a single-user local app an unbounded `getAll()` is therefore
 * the right primitive for the callers that genuinely need every row — the replay
 * loop, the summary projection, and the test reset helper.
 *
 * Callers that need one row, or the rows under one coalesceKey, should use the
 * indexed readers below instead: those avoid materializing the whole queue on a
 * path that runs on every enqueue.
 */
export async function readQueuedMutations() {
  // Reads degrade gracefully: a failed read must not crash the UI or the replay
  // loop. Writes are the opposite (see withStore) because a write that reports
  // success without committing loses the user's work.
  const result = await withStore<PersistedMutation[]>('readonly', (store) => store.getAll())
    .catch(() => null)
  const items = result ?? Array.from(memoryStore.values())
  return items.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
}

/**
 * Read the entries sharing one coalesceKey, newest first.
 *
 * `coalesceKey` is an index on the store, so this reads only the few rows a save
 * is allowed to supersede instead of the whole queue on every enqueue. Entries
 * in `syncing` are excluded: the in-flight entry's body has already been sent and
 * must not be reused as the base for a superseding save.
 */
export async function readQueuedMutationsByCoalesceKey(coalesceKey: string) {
  const result = await idb
    .run<PersistedMutation[]>('readonly', (store) => {
      const index = store.index('coalesceKey')
      // `IDBKeyRange` is a global the stub/SSR environments may not provide; an
      // index lookup without a range still reads far less than the whole queue.
      return typeof IDBKeyRange === 'undefined'
        ? index.getAll(coalesceKey)
        : index.getAll(IDBKeyRange.only(coalesceKey))
    })
    .catch(() => null)
  const items =
    result ?? Array.from(memoryStore.values()).filter((item) => item.coalesceKey === coalesceKey)
  return items
    .filter((item) => item.status !== 'syncing')
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

/** Read one entry by its primary key, without touching the rest of the queue. */
export async function readQueuedMutation(id: string) {
  const result = await idb
    .run<PersistedMutation | undefined>('readonly', (store) => store.get(id))
    .catch(() => null)
  return result ?? memoryStore.get(id) ?? null
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
    const existing = (await readQueuedMutationsByCoalesceKey(nextItem.coalesceKey))[0]
    if (existing) {
      // Reuse the queue row so coalescing stays bounded, but issue a fresh
      // mutation id for the new body. The previous id may already have been
      // applied by the server even if its response was lost.
      nextItem.id = existing.id
      nextItem.createdAt = existing.createdAt
    }
  }

  await putMutation(nextItem)
  return nextItem
}

async function updateMutation(item: PersistedMutation, patch: Partial<PersistedMutation>) {
  const nextItem = {
    ...item,
    ...patch,
    updatedAt: nowIso(),
  }
  await putMutation(nextItem)
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
  const apiToken = getApiToken()
  if (apiToken) {
    headers.set('X-Memory-Anki-Token', apiToken)
  }
  if (item.bodyKind === 'formData') {
    headers.delete('Content-Type')
  }
  return headers
}

function nextBackoffMs(attemptCount: number) {
  return Math.min(5 * 60_000, Math.max(1_000, 2 ** Math.min(attemptCount, 8) * 1_000))
}

/** How many 503 retries before a busy server becomes a visible manual failure. */
const MAX_BUSY_ATTEMPTS = 8
const MAX_NETWORK_ATTEMPTS = 8

/** Retry-After is seconds or an HTTP date; ignore anything unparseable. */
function parseRetryAfterMs(response: Response): number | null {
  const raw = response.headers.get('Retry-After')
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(30_000, Math.max(500, seconds * 1000))
  }
  const at = Date.parse(raw)
  if (Number.isFinite(at)) {
    return Math.min(30_000, Math.max(500, at - Date.now()))
  }
  return null
}

async function replayOneMutation(item: PersistedMutation, force = false) {
  // Conflict/manual entries stay visible in the queue, but ordinary scans must
  // not send them again. `force` is reserved for an explicit user retry (or the
  // overwrite-confirmation flow), so it intentionally bypasses this status
  // guard and the replay-mode/backoff gates below.
  if (!force && item.replayMode !== 'auto') return
  if (!force && item.nextAttemptAt > Date.now()) return
  if (!force && (item.status === 'conflict' || item.status === 'manual')) return

  const current = await updateMutation(item, { status: 'syncing' })
  try {
    const response = await fetch(current.url, {
      method: current.method,
      headers: buildReplayHeaders(current),
      body: rebuildBody(current),
    })
    const bodyText = await response.text().catch(() => '')
    if (response.ok) {
      // The server has already applied this mutation. A storage failure while
      // removing the entry must not fall through to the failure branch below,
      // which would mark applied work as failed. Leaving the entry queued only
      // costs one redundant replay, and replays carry the original mutation id,
      // so the server deduplicates them.
      await deleteMutationFromStore(current.id).catch((error: unknown) => {
        console.error('[mutation-queue] replay succeeded but entry was not removed', current.id, error)
      })
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
    // 503 is the server's "storage is busy, retry shortly" signal, not a
    // permanent failure. Treating it as `failed` is what made a locked backend
    // look like a dead button: the entry stopped retrying and nothing surfaced.
    // Honour Retry-After so the client backs off in step with the server instead
    // of hammering the very lock it is waiting on.
    const busyRetryMs = response.status === 503 ? parseRetryAfterMs(response) : null
    // A busy server must not be retried forever: past this budget the entry
    // becomes a visible, user-retryable failure instead of an endless spinner.
    const busyExhausted = response.status === 503 && attemptCount >= MAX_BUSY_ATTEMPTS
    await updateMutation(current, {
      status: busyExhausted ? 'manual' : response.status >= 500 ? 'failed' : 'manual',
      attemptCount,
      nextAttemptAt: Date.now() + (busyRetryMs ?? nextBackoffMs(attemptCount)),
      errorMessage: busyExhausted
        ? '服务器持续繁忙，已停止自动重试。请稍后手动重试。'
        : errorMessage,
      lastResponseStatus: response.status,
    })
  } catch (error) {
    const attemptCount = current.attemptCount + 1
    const exhausted = attemptCount >= MAX_NETWORK_ATTEMPTS
    await updateMutation(current, {
      status: exhausted ? 'manual' : 'failed',
      attemptCount,
      nextAttemptAt: exhausted ? Number.MAX_SAFE_INTEGER : Date.now() + nextBackoffMs(attemptCount),
      errorMessage: exhausted ? '网络持续不可用，已停止自动重试。请恢复网络后手动重试。' : error instanceof Error ? error.message : '同步失败',
    })
  }
}

const NEVER_AUTO_REPLAY_URL = new RegExp(
  [
    '/review/session/[^/]+/units/[^/]+/ratings',
    '/review/session/[^/]+/units/[^/]+/encounters/[^/]+/close',
    '/review/palaces/[^/]+/due-units/ratings',
    '/freestyle/rounds/[^/]+/ratings',
  ].join('|'),
)
const NEVER_AUTO_REPLAY_MESSAGE = '这一次没有保存成功，不会在后台补发，请回到卡片重新点评分。'

/** Entries queued by an older build: a rating or close is never sent in the background. */
export function isNeverAutoReplayMutation(item: Pick<PersistedMutation, 'url' | 'method'>) {
  return item.method.toUpperCase() === 'POST' && NEVER_AUTO_REPLAY_URL.test(item.url)
}

export async function replayQueuedMutations(options: { forceIds?: string[] } = {}) {
  if (replayInFlight) return replayInFlight
  replayInFlight = (async () => {
    const forceIds = new Set(options.forceIds ?? [])
    const items = await readQueuedMutations()
    for (const item of items) {
      // Storage failures are isolated per item: one unwritable entry must not
      // abort the rest of the replay or become an unhandled rejection, because
      // every caller invokes this as a background `void` sync.
      try {
        if (
          !forceIds.has(item.id)
          && item.status !== 'manual'
          && isNeverAutoReplayMutation(item)
        ) {
          await updateMutation(item, {
            status: 'manual',
            replayMode: 'manual',
            errorMessage: NEVER_AUTO_REPLAY_MESSAGE,
            nextAttemptAt: Number.MAX_SAFE_INTEGER,
          })
          continue
        }
        await replayOneMutation(item, forceIds.has(item.id))
      } catch (error) {
        console.error('[mutation-queue] replay failed for entry', item.id, error)
      }
    }
  })().finally(() => {
    replayInFlight = null
  })
  return replayInFlight
}

export async function discardQueuedMutation(id: string) {
  await deleteMutationFromStore(id)
}

/**
 * Retry one parked mindmap save with the fingerprint the server reports *now*.
 *
 * A 409 on `palace:<id>:editor` leaves an entry in `conflict`. Ordinary scans
 * skip those entries on purpose (replaying the rejected fingerprint is exactly
 * the repeating-409 loop), which means nothing would ever send it again. This is
 * the only path that releases such an entry, so it must use the current
 * fingerprint rather than the stored one.
 */
export async function retryQueuedConflictWithCurrentFingerprint(id: string): Promise<boolean> {
  const item = await readQueuedMutation(id)
  if (!item || item.status !== 'conflict') return false
  const resigned = await confirmQueuedMutationOverwrite(id)
  if (!resigned) return false
  await replayQueuedMutations({ forceIds: [id] })
  const after = await readQueuedMutation(id)
  return after == null || after.status === 'pending' || after.status === 'syncing'
}

/** Drop parked conflicts for a resource the session has already superseded. */
export async function discardQueuedConflictsByCoalesceKey(coalesceKey: string | null | undefined) {
  if (!coalesceKey) return
  const items = await readQueuedMutationsByCoalesceKey(coalesceKey)
  await Promise.all(
    items
      .filter((item) => item.status === 'conflict' || item.status === 'manual')
      .map((item) => deleteMutationFromStore(item.id).catch((error: unknown) => {
        console.error('[mutation-queue] failed to discard superseded conflict', item.id, error)
      })),
  )
}

export async function discardQueuedMutationsByCoalesceKey(
  coalesceKey: string | null | undefined,
  acknowledgedMutationId?: string | null,
  acknowledgedBefore?: string,
) {
  if (!coalesceKey) return
  const items = await readQueuedMutationsByCoalesceKey(coalesceKey)
  // Best-effort cleanup: this runs *after* a successful save, so a storage
  // failure here must not reject. Callers treat a rejection as a failed request,
  // which would report a save that actually succeeded as a network error. The
  // worst case of a leftover entry is a redundant replay, and replays carry the
  // original mutation id, so the server deduplicates them.
  await Promise.all(
    items
      .filter((item) =>
        item.mutationId !== acknowledgedMutationId &&
        (!acknowledgedBefore || item.createdAt < acknowledgedBefore),
      )
      .map((item) => deleteMutationFromStore(item.id).catch((error: unknown) => {
        console.error('[mutation-queue] failed to discard superseded entry', item.id, error)
      })),
  )
}

export async function markQueuedMutationManual(id: string, message?: string) {
  const item = await readQueuedMutation(id)
  if (!item) return null
  return updateMutation(item, {
    status: 'manual',
    errorMessage: message ?? item.errorMessage,
    nextAttemptAt: Number.POSITIVE_INFINITY,
  })
}

export async function confirmQueuedMutationOverwrite(id: string) {
  const item = await readQueuedMutation(id)
  if (!item || item.bodyKind !== 'json' || !item.body) return null
  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(item.body) as unknown
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return null
  }
  const expectedFingerprint = body.expected_editor_fingerprint
  if (typeof expectedFingerprint !== 'string' || !expectedFingerprint.trim()) {
    return updateMutation(item, {
      status: 'manual',
      errorMessage: '这条脑图保存没有版本指纹，已停止自动覆盖；请重新打开宫殿后保存。',
      nextAttemptAt: Number.POSITIVE_INFINITY,
    })
  }
  // The stored fingerprint is the revision the client edited *from*, which is
  // exactly what the server already rejected. Replaying it verbatim produced the
  // repeating-409 loop this flow exists to end. The user has now seen the server
  // state, so the overwrite must be signed with the fingerprint the server
  // currently reports; anything else cannot be accepted as "overwrite current".
  const currentFingerprint = await fetchCurrentEditorFingerprint(item)
  if (!currentFingerprint) {
    return updateMutation(item, {
      status: 'manual',
      errorMessage: '无法读取服务端当前脑图版本，已停止覆盖；请重新打开宫殿后保存。',
      nextAttemptAt: Number.POSITIVE_INFINITY,
    })
  }
  body.expected_editor_fingerprint = currentFingerprint
  body.confirm_dangerous_change = true
  delete body.allow_stale_overwrite
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

// Only the palace editor documents a resource key the server can re-read, and
// only its conflicts are fingerprint conflicts. Every other queued write keeps
// the previous behaviour rather than inventing a version to claim.
const EDITOR_RESOURCE_KEY = /^palace:(\d+):editor$/

async function fetchCurrentEditorFingerprint(item: PersistedMutation): Promise<string | null> {
  const match = EDITOR_RESOURCE_KEY.exec(item.resourceKey)
  if (!match) return null
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = getApiToken()
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const response = await fetch(`/api/v1/palaces/${match[1]}/editor`, { headers })
    if (!response.ok) return null
    const payload = (await response.json()) as unknown
    if (!payload || typeof payload !== 'object') return null
    const state = payload as Record<string, unknown>
    const direct = state.editor_fingerprint
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
    const snapshot = state.snapshot
    if (snapshot && typeof snapshot === 'object') {
      const revision = (snapshot as Record<string, unknown>).revision
      if (typeof revision === 'string' && revision.trim()) return revision.trim()
    }
    return null
  } catch {
    return null
  }
}

export async function resetMutationQueueForTest() {
  const items = await readQueuedMutations()
  await Promise.all(items.map((item) => deleteMutationFromStore(item.id)))
  memoryStore.clear()
}
