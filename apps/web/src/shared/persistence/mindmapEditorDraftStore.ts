import type { MindMapEditorState } from '@/shared/api/contracts'
import { createIdbHandle } from '@/shared/persistence/indexedDb'

export interface MindMapEditorDraftRecord {
  resourceKey: string
  snapshot: MindMapEditorState
  /** Server fingerprint the draft was based on when first dirtied (optional). */
  baseEditorFingerprint: string
  baseSnapshot?: MindMapEditorState
  /** Stable content serialization used to detect equality with server state. */
  contentFingerprint: string
  changeVersion: number
  updatedAt: string
}

const DB_NAME = 'memory-anki-mindmap-editor-drafts'
const STORE_NAME = 'drafts'
const DB_VERSION = 1

const memoryStore = new Map<string, MindMapEditorDraftRecord>()

function nowIso() {
  return new Date().toISOString()
}

/**
 * Draft writes are strict (they settle on transaction commit and reject on
 * abort) so an offline editor save is never acknowledged before it is durable.
 * Reads degrade to `null` instead of throwing: a draft that cannot be read is
 * simply absent, and the editor falls back to server state.
 */
const idb = createIdbHandle({
  db: DB_NAME,
  version: DB_VERSION,
  store: STORE_NAME,
  upgrade: (db) => {
    if (db.objectStoreNames.contains(STORE_NAME)) return
    db.createObjectStore(STORE_NAME, { keyPath: 'resourceKey' })
  },
})

/** Writes must reject on failure: a draft acknowledged but not committed is lost work. */
function withStore<T>(mode: 'readwrite', action: (store: IDBObjectStore) => IDBRequest<T>) {
  return idb.run(mode, action)
}

/** Reads degrade gracefully; the caller already has a "no draft" branch. */
function readStore<T>(action: (store: IDBObjectStore) => IDBRequest<T>) {
  return idb.run('readonly', action, { strict: false })
}

export function buildMindMapEditorDraftKey(loadCacheKey: string, entityId: number) {
  return `${loadCacheKey}:${entityId}`
}

export function stableMindMapEditorContentFingerprint(state: MindMapEditorState | null | undefined) {
  if (!state) return ''
  try {
    return JSON.stringify({
      editor_doc: state.editor_doc,
      editor_config: state.editor_config,
      editor_local_config: state.editor_local_config,
      lang: state.lang,
    }) ?? ''
  } catch {
    return ''
  }
}

export async function writeMindMapEditorDraft(input: {
  resourceKey: string
  snapshot: MindMapEditorState
  baseEditorFingerprint?: string
  baseSnapshot?: MindMapEditorState
  changeVersion: number
  contentFingerprint?: string
}): Promise<MindMapEditorDraftRecord> {
  const record: MindMapEditorDraftRecord = {
    resourceKey: input.resourceKey,
    snapshot: input.snapshot,
    baseEditorFingerprint: input.baseEditorFingerprint ?? '',
    baseSnapshot: input.baseSnapshot,
    contentFingerprint:
      input.contentFingerprint ?? stableMindMapEditorContentFingerprint(input.snapshot),
    changeVersion: input.changeVersion,
    updatedAt: nowIso(),
  }
  const putResult = await withStore('readwrite', (store) => store.put(record))
  if (putResult === null) {
    memoryStore.set(record.resourceKey, record)
  }
  return record
}

export async function readMindMapEditorDraft(
  resourceKey: string,
): Promise<MindMapEditorDraftRecord | null> {
  const result = await readStore<MindMapEditorDraftRecord | undefined>((store) =>
    store.get(resourceKey),
  )
  if (result === null) {
    return memoryStore.get(resourceKey) ?? null
  }
  return result ?? memoryStore.get(resourceKey) ?? null
}

export async function clearMindMapEditorDraft(resourceKey: string): Promise<void> {
  const result = await withStore('readwrite', (store) => store.delete(resourceKey))
  if (result === null) {
    memoryStore.delete(resourceKey)
  } else {
    memoryStore.delete(resourceKey)
  }
}

export interface MindMapEditorConflict {
  ownerId: number
  operationId: number
  localSnapshot: MindMapEditorState
  remoteSnapshot: MindMapEditorState | null
  baselineSnapshot?: MindMapEditorState
  baseEditorFingerprint: string
  remoteEditorFingerprint: string
  reason: 'draft-base-mismatch' | 'save-conflict'
}

/** An independent recovery record: clearing the active draft never removes either version. */
export async function archiveMindMapEditorConflict(
  resourceKey: string,
  conflict: MindMapEditorConflict,
): Promise<void> {
  const record = {
    resourceKey: `${resourceKey}:conflict:${conflict.operationId}:${nowIso()}`,
    ...JSON.parse(JSON.stringify(conflict)) as MindMapEditorConflict,
    updatedAt: nowIso(),
  }
  // The conflict archive keeps its own user-facing failure contract: both
  // "IndexedDB is unavailable" and "the write did not commit" mean the recovery
  // snapshot is not durable, and the caller must not proceed as if it were.
  // Collapsing the two would either leak a raw DOMException into the UI or
  // acknowledge a snapshot that was rolled back.
  const result = await withStore('readwrite', (store) => store.put(record)).catch(() => null)
  if (result === null) throw new Error('无法持久保存冲突双方快照，请恢复浏览器本地存储后重试。')
}

export async function resetMindMapEditorDraftStoreForTest(): Promise<void> {
  memoryStore.clear()
  // Test-only: clearing the store must never reject, or a failing assertion in
  // one test would surface as an unrelated rejection from teardown.
  await idb.run('readwrite', (store) => store.clear(), { strict: false })
}
