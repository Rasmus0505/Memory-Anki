/**
 * Revision-checked read cache: memory first (synchronous, so a first render can use it
 * without flashing), IndexedDB behind it (survives reloads). An entry is only returned
 * when its stored revision equals the requested one, so content edited on the other
 * device and synced in by Syncthing is never served stale.
 */
import { createIdbHandle } from '@/shared/persistence/indexedDb'

export interface VersionedCacheRecord<T> {
  key: string
  namespace: string
  id: string
  revision: string
  value: T
  savedAt: number
}

export interface VersionedCache<T> {
  /** Memory only. Never touches IndexedDB, safe inside render. */
  getSync(id: string, revision: string | number): T | null
  get(id: string, revision: string | number): Promise<T | null>
  /** Copies every persisted entry of this namespace into memory (call once at warm-up). */
  hydrate(): Promise<void>
  put(id: string, revision: string | number, value: T): void
  delete(id: string): void
}

const DB_NAME = 'memory-anki-versioned-cache'
const STORE_NAME = 'entries'
const DB_VERSION = 1
const EVICT_EVERY_PUTS = 50

/**
 * This is a read cache, so every operation degrades instead of throwing: a miss
 * or a storage failure must not break the page that was going to fall back to
 * the network anyway. `put`/`delete` are fire-and-forget by design.
 */
const idb = createIdbHandle({
  db: DB_NAME,
  version: DB_VERSION,
  store: STORE_NAME,
  upgrade: (db) => {
    if (db.objectStoreNames.contains(STORE_NAME)) return
    const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
    store.createIndex('namespace', 'namespace')
  },
})

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return idb.run(mode, action, { strict: false })
}

export function createVersionedCache<T>(namespace: string, { maxEntries = 1500 } = {}): VersionedCache<T> {
  const memory = new Map<string, VersionedCacheRecord<T>>()
  let putsSinceEvict = 0
  const keyOf = (id: string) => `${namespace}:${id}`

  const evict = () => {
    void run<VersionedCacheRecord<T>[]>('readonly', (store) => store.index('namespace').getAll(namespace)).then((rows) => {
      if (!rows || rows.length <= maxEntries) return
      const stale = rows.sort((a, b) => a.savedAt - b.savedAt).slice(0, rows.length - maxEntries)
      stale.forEach((row) => {
        memory.delete(row.key)
        void run('readwrite', (store) => store.delete(row.key))
      })
    })
  }

  return {
    getSync(id, revision) {
      const record = memory.get(keyOf(id))
      return record && record.revision === String(revision) ? record.value : null
    },
    async get(id, revision) {
      const hit = this.getSync(id, revision)
      if (hit != null) return hit
      const record = await run<VersionedCacheRecord<T> | undefined>('readonly', (store) => store.get(keyOf(id)))
      if (!record) return null
      memory.set(record.key, record)
      return record.revision === String(revision) ? record.value : null
    },
    async hydrate() {
      const rows = await run<VersionedCacheRecord<T>[]>('readonly', (store) => store.index('namespace').getAll(namespace))
      rows?.forEach((row) => {
        const current = memory.get(row.key)
        if (!current || current.savedAt < row.savedAt) memory.set(row.key, row)
      })
    },
    put(id, revision, value) {
      const record: VersionedCacheRecord<T> = {
        key: keyOf(id),
        namespace,
        id,
        revision: String(revision),
        value,
        savedAt: Date.now(),
      }
      memory.set(record.key, record)
      void run('readwrite', (store) => store.put(record))
      putsSinceEvict += 1
      if (putsSinceEvict >= EVICT_EVERY_PUTS) {
        putsSinceEvict = 0
        evict()
      }
    },
    delete(id) {
      memory.delete(keyOf(id))
      void run('readwrite', (store) => store.delete(keyOf(id)))
    },
  }
}
