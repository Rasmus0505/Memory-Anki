import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  enqueueMutation,
  readQueuedMutations,
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
  const fake: Fake = { transactions, lastPut: undefined }

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
        getAll: () => settleRequest([], transaction, manual),
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
