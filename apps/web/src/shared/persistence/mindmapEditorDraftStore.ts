import type { MindMapEditorState } from '@/shared/api/contracts'

export interface MindMapEditorDraftRecord {
  resourceKey: string
  snapshot: MindMapEditorState
  /** Server fingerprint the draft was based on when first dirtied (optional). */
  baseEditorFingerprint: string
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
        db.createObjectStore(STORE_NAME, { keyPath: 'resourceKey' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open mindmap draft store'))
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
    request.onerror = () => reject(request.error ?? new Error('Mindmap draft store request failed'))
    transaction.oncomplete = () => db.close()
    transaction.onerror = () => {
      db.close()
      reject(transaction.error ?? new Error('Mindmap draft store transaction failed'))
    }
  }).catch(() => {
    db.close()
    return null
  })
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
  changeVersion: number
  contentFingerprint?: string
}): Promise<MindMapEditorDraftRecord> {
  const record: MindMapEditorDraftRecord = {
    resourceKey: input.resourceKey,
    snapshot: input.snapshot,
    baseEditorFingerprint: input.baseEditorFingerprint ?? '',
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
  const result = await withStore<MindMapEditorDraftRecord | undefined>('readonly', (store) =>
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

export async function resetMindMapEditorDraftStoreForTest(): Promise<void> {
  memoryStore.clear()
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).clear()
    transaction.oncomplete = () => {
      db.close()
      resolve()
    }
    transaction.onerror = () => {
      db.close()
      resolve()
    }
  })
}
