/**
 * Revision-checked read cache: memory first (synchronous, so a first render can use it
 * without flashing), IndexedDB behind it (survives reloads). An entry is only returned
 * when its stored revision equals the requested one, so content edited on the other
 * device and synced in by Syncthing is never served stale.
 */
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

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
      store.createIndex('namespace', 'namespace')
    }
    request.onsuccess = () => {
      const db = request.result
      // Another tab upgrading the schema must not be blocked by this connection.
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null
    return new Promise<T | null>((resolve) => {
      try {
        const request = action(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  })
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
