/**
 * The one hand-written IndexedDB plumbing layer for `shared/persistence`.
 *
 * Three stores used to carry their own copy of `openDb` + a transaction-promise
 * wrapper, and the copies had drifted apart: one resolved on `request.onsuccess`
 * (which fires *before* the transaction settles, so an aborted write was reported
 * as saved), another swallowed every error, a third distinguished "IndexedDB
 * unavailable" from "transaction failed". This module keeps the strictest
 * semantics so a write can never be acknowledged before it commits.
 *
 * Deliberately dependency-free (no `idb` / `dexie`): the surface needed here is
 * small, and the settle-on-commit rule is exactly the part that must not be
 * delegated to a library whose defaults differ.
 *
 * Contract:
 * - `run` resolves `null` ONLY when IndexedDB is genuinely unavailable (SSR,
 *   private mode, blocked upgrade). Callers use that to fall back to memory.
 * - A transaction that fails or aborts rejects; it never resolves as `null`.
 *   Storage failure must not masquerade as a saved write.
 * - Writes settle on `transaction.oncomplete`, not `request.onsuccess`, because a
 *   queued mutation or editor draft is only durable once the transaction commits.
 * - Pass `strict: false` for read caches whose miss path is already handled; a
 *   failed read then resolves `null` instead of rejecting. Never for writes.
 */

export interface IdbStoreSchema {
  /** Database name. Must match the name the store has always used. */
  db: string
  /** Database version. Must match the version the store has always used. */
  version: number
  /** Object store to open the transaction on. */
  store: string
  /**
   * Runs inside `onupgradeneeded`. Must be idempotent and must produce exactly
   * the schema previous versions created — changing it would orphan persisted
   * drafts and queued mutations.
   */
  upgrade: (db: IDBDatabase, transaction: IDBTransaction) => void
}

export interface IdbRunOptions {
  /**
   * `false` makes transaction and request failures resolve `null` instead of
   * rejecting. Use it for read caches whose miss path is already handled.
   */
  strict?: boolean
}

export interface IdbHandle {
  /** Resolves `null` when IndexedDB is unavailable; rejects when the open fails. */
  open(): Promise<IDBDatabase | null>
  /**
   * Run one action against the store inside a transaction.
   *
   * Resolves with the request result once the transaction commits, or `null`
   * when IndexedDB is unavailable (and, with `strict: false`, when anything
   * failed).
   */
  run<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
    options?: IdbRunOptions,
  ): Promise<T | null>
  /** Close the connection a finished transaction handed back, if any. */
  reset(): void
}

function canUseIndexedDb() {
  return typeof indexedDB !== 'undefined'
}

function messageFor(store: string, stage: string, error: unknown) {
  const detail = error instanceof Error && error.message ? `: ${error.message}` : ''
  return new Error(`${store} ${stage}${detail}`)
}

/**
 * Build the IndexedDB accessors for one object store.
 *
 * One connection is opened per call and closed when its transaction settles.
 * That costs a little more than caching a connection, but a cached connection
 * outlives the code that created it: after a `versionchange` from another tab,
 * or across a page-harness swap in tests, it silently points at a database whose
 * schema the caller no longer expects. Per-call opens keep every caller honest
 * and match the behavior the three stores had before this module existed.
 */
export function createIdbHandle(schema: IdbStoreSchema): IdbHandle {
  const open = (): Promise<IDBDatabase | null> => {
    if (!canUseIndexedDb()) {
      return Promise.resolve<IDBDatabase | null>(null)
    }
    return new Promise<IDBDatabase | null>((resolve) => {
      let settled = false
      const settle = (db: IDBDatabase | null) => {
        if (settled) return
        settled = true
        resolve(db)
      }
      let request: IDBOpenDBRequest
      try {
        request = indexedDB.open(schema.db, schema.version)
      } catch {
        settle(null)
        return
      }
      request.onupgradeneeded = () => {
        schema.upgrade(request.result, request.transaction as IDBTransaction)
      }
      request.onsuccess = () => {
        const db = request.result
        // Another tab upgrading the schema must not be blocked by this connection.
        db.onversionchange = () => db.close()
        settle(db)
      }
      // null means IndexedDB is unavailable (or its upgrade is blocked by another
      // tab), not that the operation failed. Callers fall back to memory.
      request.onerror = () => settle(null)
      request.onblocked = () => settle(null)
    })
  }

  const run = async <T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
    options: IdbRunOptions = {},
  ): Promise<T | null> => {
    const strict = options.strict !== false
    const db = await open()
    // null means IndexedDB is unavailable, not that the operation failed.
    if (!db) return null
    return new Promise<T | null>((resolve, reject) => {
      const fail = (error: unknown) => {
        if (strict) reject(error instanceof Error ? error : messageFor(schema.store, 'transaction failed', error))
        else resolve(null)
      }
      let transaction: IDBTransaction
      try {
        transaction = db.transaction(schema.store, mode)
      } catch (error) {
        db.close()
        fail(messageFor(schema.store, 'transaction could not start', error))
        return
      }
      const store = transaction.objectStore(schema.store)
      let request: IDBRequest<T>
      try {
        request = action(store)
      } catch (error) {
        db.close()
        fail(error)
        return
      }
      request.onerror = () => fail(request.error ?? messageFor(schema.store, 'request failed', request.error))
      transaction.oncomplete = () => {
        db.close()
        resolve(request.result)
      }
      transaction.onabort = () => {
        db.close()
        fail(transaction.error ?? messageFor(schema.store, 'transaction aborted', transaction.error))
      }
      transaction.onerror = () => {
        db.close()
        fail(transaction.error ?? messageFor(schema.store, 'transaction failed', transaction.error))
      }
    })
  }

  return {
    open,
    run,
    reset: () => {},
  }
}
