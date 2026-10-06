import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  discardQueuedMutationsByCoalesceKey,
  enqueueMutation,
  markQueuedMutationManual,
  readQueuedMutation,
  readQueuedMutations,
  readQueuedMutationsByCoalesceKey,
  resetMutationQueueForTest,
} from './mutationQueue'

/**
 * Durability contract for the offline mutation queue.
 *
 * A queued mutation is only durable once its IndexedDB transaction *commits*.
 * The queue previously resolved on `request.onsuccess`, which fires before the
 * transaction settles, so an aborted write was acknowledged as saved and the
 * user's offline edit was silently lost.
 *
 * These tests pin which callback the queue waits for, and pin that a storage
 * failure is reported rather than downgraded to an in-memory write.
 */

type Settled = 'pending' | 'committed' | 'aborted'

type FakeTransaction = {
  mode: IDBTransactionMode
  state: Settled
  error: Error | null
  oncomplete: (() => void) | null
  onabort: (() => void) | null
  onerror: (() => void) | null
  /** Commit, as IndexedDB does once every request has succeeded. */
  commit: (error?: Error) => void
  /** Abort, as IndexedDB does when a write cannot be applied. */
  abort: (error?: Error) => void
  /** True while the transaction is still open. */
  isOpen: () => boolean
}

type Fake = {
  transactions: FakeTransaction[]
  lastPut: unknown
  /** Rows the fake store returns; set per test to exercise indexed reads. */
  rows: Array<{ id: string; coalesceKey?: string | null; status?: string; updatedAt?: string; createdAt?: string }>
  /** Names passed to `store.index(...)`, so a test can prove which index was used. */
  indexNames: string[]
  /** Keys passed to `store.get(...)`. */
  getKeys: unknown[]
  /** How many times the whole store was scanned with `getAll()`. */
  getAllCalls: number
}

/**
 * A fake IndexedDB.
 *
 * Reads always settle on their own microtask, because a real IndexedDB always
 * settles them and a fake that never does would hang the queue's own cleanup.
 * Read-write transactions are held open under `manualCommit` so a test can sit
 * in the exact window between `request.onsuccess` and the transaction settling —
 * which is where the original bug lived.
 */
function stubIndexedDb(options: { manualCommit?: boolean } = {}): Fake {
  const transactions: FakeTransaction[] = []
  const fake: Fake = {
    transactions,
    lastPut: undefined,
    rows: [],
    indexNames: [],
    getKeys: [],
    getAllCalls: 0,
  }

  /** The store's requests resolve on a microtask, mirroring real IndexedDB. */
  const settleRequest = (result: unknown, transaction: FakeTransaction, manual: boolean) => {
    const request = {
      result,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
    }
    queueMicrotask(() => {
      if (transaction.state !== 'pending') return
      request.onsuccess?.()
      if (!manual) queueMicrotask(() => transaction.commit())
    })
    return request
  }

  const db = {
    close: vi.fn(),
    onversionchange: null as (() => void) | null,
    transaction: (_name: string, mode: IDBTransactionMode) => {
      // Manual commit applies only to writes; reads must settle or the queue's
      // own cleanup hooks hang.
      const manual = options.manualCommit === true && mode !== 'readonly'
      // One object identity, mutated in place: `withStore` assigns its handlers
      // directly onto this, so handing back a copy would silently drop them.
      const transaction: FakeTransaction = {
        mode,
        state: 'pending',
        error: null,
        oncomplete: null,
        onabort: null,
        onerror: null,
        isOpen: () => transaction.state === 'pending',
        commit: (error?: Error) => {
          if (transaction.state !== 'pending') return
          if (error) {
            transaction.error = error
            transaction.state = 'aborted'
            transaction.onerror?.()
            return
          }
          transaction.state = 'committed'
          transaction.oncomplete?.()
        },
        abort: (error?: Error) => {
          if (transaction.state !== 'pending') return
          transaction.error = error ?? new Error('aborted')
          transaction.state = 'aborted'
          transaction.onabort?.()
        },
      }
      transactions.push(transaction)

      const store = {
        put: (record: unknown) => {
          fake.lastPut = record
          return settleRequest(record, transaction, manual)
        },
        delete: () => settleRequest(undefined, transaction, manual),
        getAll: () => {
          fake.getAllCalls += 1
          return settleRequest([], transaction, manual)
        },
        get: (key: unknown) => {
          fake.getKeys.push(key)
          return settleRequest(fake.rows.find((row) => row.id === key), transaction, manual)
        },
        index: (name: string) => {
          fake.indexNames.push(name)
          return {
            getAll: () => settleRequest(fake.rows, transaction, manual),
          }
        },
      }

      return Object.assign(transaction, { objectStore: () => store })
    },
  }

  const openRequest = {
    result: db,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onblocked: null as (() => void) | null,
    onupgradeneeded: null as (() => void) | null,
  }

  vi.stubGlobal('indexedDB', {
    open: () => {
      queueMicrotask(() => openRequest.onsuccess?.())
      return openRequest
    },
  })

  return fake
}

function newMutation() {
  return {
    resourceKey: 'palace:1:editor',
    description: '保存宫殿脑图',
    url: '/api/v1/palaces/1/editor',
    method: 'PUT',
    bodyKind: 'json' as const,
    body: JSON.stringify({ version: 1 }),
    replayMode: 'auto' as const,
  }
}

describe('mutationQueue durability', () => {
  afterEach(async () => {
    vi.unstubAllGlobals()
    await resetMutationQueueForTest()
  })

  it('does not acknowledge a queued mutation before the transaction commits', async () => {
    const fake = stubIndexedDb({ manualCommit: true })

    let acknowledged = false
    const pending = enqueueMutation(newMutation()).then(() => {
      acknowledged = true
    })

    await vi.waitFor(() => expect(fake.lastPut).toBeDefined())
    // request.onsuccess has fired, but the transaction is still open.
    await vi.waitFor(() => expect(fake.transactions[0]?.isOpen()).toBe(true))
    expect(acknowledged).toBe(false)

    fake.transactions[0]?.commit()
    await pending
    expect(acknowledged).toBe(true)
  })

  it('rejects an aborted write instead of reporting an offline save as saved', async () => {
    const fake = stubIndexedDb({ manualCommit: true })
    const pending = enqueueMutation(newMutation())
    const rejected = expect(pending).rejects.toThrow('aborted')

    await vi.waitFor(() => expect(fake.lastPut).toBeDefined())
    fake.transactions[0]?.abort(new Error('aborted'))

    await rejected
  })

  it('does not park a failed write in the in-memory fallback', async () => {
    const fake = stubIndexedDb({ manualCommit: true })
    const pending = enqueueMutation(newMutation())
    const rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(fake.lastPut).toBeDefined())
    fake.transactions[0]?.abort()
    await rejected

    // The write never committed, so it must not be readable as a queued mutation.
    // IndexedDB stayed available, so the memory fallback must not be consulted —
    // that is the path that used to lose the edit silently.
    await expect(readQueuedMutations()).resolves.toEqual([])
  })

  it('still uses the in-memory fallback when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined)

    await expect(enqueueMutation(newMutation())).resolves.toMatchObject({
      resourceKey: 'palace:1:editor',
    })
    await expect(readQueuedMutations()).resolves.toHaveLength(1)
  })

  it('treats an unreadable queue as empty instead of throwing', async () => {
    const openRequest = {
      result: {
        close: vi.fn(),
        onversionchange: null as (() => void) | null,
        transaction: () => {
          const transaction = {
            error: new Error('read failed') as Error | null,
            oncomplete: null as (() => void) | null,
            onabort: null as (() => void) | null,
            onerror: null as (() => void) | null,
            objectStore: () => ({
              getAll: () => ({ result: [], onsuccess: null, onerror: null }),
            }),
          }
          queueMicrotask(() => transaction.onabort?.())
          return transaction
        },
      },
      onsuccess: null as (() => void) | null,
    }
    vi.stubGlobal('indexedDB', {
      open: () => {
        queueMicrotask(() => openRequest.onsuccess?.())
        return openRequest
      },
    })

    await expect(readQueuedMutations()).resolves.toEqual([])
  })
})

/**
 * The queue used to scan the whole store on every enqueue (coalescing), every
 * single-id helper and every coalesceKey cleanup. Those paths now use the
 * `coalesceKey` index and the primary key instead. `readQueuedMutations()` itself
 * is intentionally unchanged: the replay loop, the summary and the test reset
 * genuinely need every row, and for a single-user local queue that read is cheap.
 */
describe('mutationQueue indexed reads', () => {
  afterEach(async () => {
    vi.unstubAllGlobals()
    await resetMutationQueueForTest()
  })

  it('coalesces by the coalesceKey index instead of scanning the whole queue', async () => {
    const fake = stubIndexedDb()
    fake.rows = [
      {
        id: 'existing',
        coalesceKey: 'palace:1:editor',
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]

    const queued = await enqueueMutation({
      ...newMutation(),
      coalesceKey: 'palace:1:editor',
    })

    expect(fake.indexNames).toContain('coalesceKey')
    // The coalesced entry keeps the original identity so the server deduplicates.
    expect(queued.id).toBe('existing')
    expect(queued.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(fake.getAllCalls).toBe(0)
  })

  it('reads one entry by primary key rather than scanning the queue', async () => {
    const fake = stubIndexedDb()
    fake.rows = [
      {
        id: 'target',
        coalesceKey: null,
        status: 'conflict',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]

    await markQueuedMutationManual('target', '停止自动同步')

    expect(fake.getKeys).toContain('target')
    expect(fake.getAllCalls).toBe(0)
  })

  it('discards superseded entries through the coalesceKey index', async () => {
    const fake = stubIndexedDb()
    fake.rows = [
      {
        id: 'superseded',
        coalesceKey: 'palace:1:editor',
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]

    await discardQueuedMutationsByCoalesceKey('palace:1:editor')

    expect(fake.indexNames).toContain('coalesceKey')
    expect(fake.getAllCalls).toBe(0)
  })

  it('never mistakes a syncing entry for a coalesce base', async () => {
    const fake = stubIndexedDb()
    fake.rows = [
      {
        id: 'in-flight',
        coalesceKey: 'palace:1:editor',
        status: 'syncing',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]

    const queued = await enqueueMutation({
      ...newMutation(),
      coalesceKey: 'palace:1:editor',
    })

    // The in-flight entry's body was already sent; the new save must stand alone.
    expect(queued.id).not.toBe('in-flight')
  })

  it('still degrades to the memory fallback when IndexedDB is unavailable', async () => {
    // The new indexed readers must not become the only path that works.
    vi.stubGlobal('indexedDB', undefined)

    await expect(readQueuedMutationsByCoalesceKey('palace:1:editor')).resolves.toEqual([])
    await expect(readQueuedMutation('missing')).resolves.toBeNull()
  })
})
