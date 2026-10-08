export type AutoSaveStatus = 'idle' | 'dirty' | 'saving' | 'error'

export interface AutoSaveState {
  status: AutoSaveStatus
  dirtyKeys: string[]
  lastReason: string | null
  errorMessage: string | null
  retryAttempt: number
}

interface AutoSaveTarget {
  flush: (reason: string) => Promise<void> | void
}

type AutoSaveListener = (state: AutoSaveState) => void

const AUTO_SAVE_DELAY_MS = 30_000
const AUTO_SAVE_RETRY_DELAYS_MS = [5_000, 15_000, 30_000] as const

/**
 * How many consecutive failed attempts before automatic retrying stops.
 *
 * Without a terminal state this coordinator retried **forever**: a failed flush
 * rescheduled itself, the key stayed in `dirtyKeys` (only a success removes it),
 * and the retry count was capped for *backoff* purposes only — the delay simply
 * settled at 30s and kept firing. On the owner's machine that produced a
 * `PUT /palaces/40/editor -> 409` every 30–60s for 47 hours straight (3,020
 * failures), each one taking a connection and a write attempt.
 *
 * Stopping is the correct behaviour, not a degradation: the local draft is
 * already persisted for recovery, so the user's edit is not at risk, and a
 * save that has failed this many times will not start succeeding on its own.
 * The next real edit, or an explicit flush, starts a fresh attempt budget.
 */
const AUTO_SAVE_MAX_ATTEMPTS = AUTO_SAVE_RETRY_DELAYS_MS.length

class AutoSaveCoordinator {
  private listeners = new Set<AutoSaveListener>()
  private targets = new Map<string, AutoSaveTarget>()
  private dirtyKeys = new Set<string>()
  private timerId: number | null = null
  private flushPromise: Promise<void> | null = null
  private state: AutoSaveState = {
    status: 'idle',
    dirtyKeys: [],
    lastReason: null,
    errorMessage: null,
    retryAttempt: 0,
  }

  registerTarget(key: string, target: AutoSaveTarget) {
    this.targets.set(key, target)
    return () => {
      this.targets.delete(key)
      this.dirtyKeys.delete(key)
      this.syncState(this.dirtyKeys.size > 0 ? 'dirty' : 'idle')
      if (this.dirtyKeys.size === 0) {
        this.clearTimer()
      }
    }
  }

  markDirty(key: string, reason: string) {
    if (!this.targets.has(key)) return
    this.dirtyKeys.add(key)
    // A fresh edit restores the retry budget. Once the previous attempt series
    // was exhausted the timer is intentionally stopped (see the catch block in
    // flushNow); without this reset, a later genuine edit would never be saved
    // automatically, which would be a worse bug than the livelock being fixed.
    this.syncState('dirty', { lastReason: reason, errorMessage: null, retryAttempt: 0 })
    if (!this.flushPromise && this.timerId == null) {
      this.schedule(AUTO_SAVE_DELAY_MS)
    }
  }

  async flushNow(reason: string, keys?: Iterable<string>) {
    const requestedKeys = keys ? new Set(keys) : null
    if (this.flushPromise) {
      return this.flushPromise
    }
    const dirtyKeys = Array.from(this.dirtyKeys).filter((key) => requestedKeys == null || requestedKeys.has(key))
    if (dirtyKeys.length === 0) {
      this.syncState(this.dirtyKeys.size > 0 ? 'dirty' : 'idle', { lastReason: reason })
      return
    }

    this.clearTimer()
    this.syncState('saving', { lastReason: reason })
    this.flushPromise = (async () => {
      try {
        for (const key of dirtyKeys) {
          const target = this.targets.get(key)
          if (!target) {
            this.dirtyKeys.delete(key)
            continue
          }
          await target.flush(reason)
          this.dirtyKeys.delete(key)
        }
        this.syncState(this.dirtyKeys.size > 0 ? 'dirty' : 'idle', {
          lastReason: reason,
          errorMessage: null,
          retryAttempt: 0,
        })
        if (this.dirtyKeys.size > 0) {
          this.schedule(AUTO_SAVE_DELAY_MS)
        }
      } catch (error) {
        const retryAttempt = Math.min(this.state.retryAttempt + 1, AUTO_SAVE_MAX_ATTEMPTS)
        const errorMessage = error instanceof Error ? error.message : '自动保存失败'
        this.syncState('error', {
          lastReason: reason,
          errorMessage,
          retryAttempt,
        })
        // Stop once the budget is spent. Retrying past this point is a livelock:
        // the key stays dirty, so every tick re-attempts the same doomed save.
        // The local draft keeps the user's work recoverable, and the next edit
        // (or an explicit flushNow) resets the budget and tries again.
        if (retryAttempt < AUTO_SAVE_MAX_ATTEMPTS) {
          this.schedule(AUTO_SAVE_RETRY_DELAYS_MS[retryAttempt - 1] ?? AUTO_SAVE_RETRY_DELAYS_MS[2])
        } else {
          this.clearTimer()
        }
        throw error
      } finally {
        this.flushPromise = null
      }
    })()

    return this.flushPromise
  }

  subscribe(listener: AutoSaveListener) {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState() {
    return this.state
  }

  resetForTest() {
    this.clearTimer()
    this.listeners.clear()
    this.targets.clear()
    this.dirtyKeys.clear()
    this.flushPromise = null
    this.state = {
      status: 'idle',
      dirtyKeys: [],
      lastReason: null,
      errorMessage: null,
      retryAttempt: 0,
    }
  }

  private schedule(delayMs: number) {
    this.clearTimer()
    if (typeof window === 'undefined') return
    this.timerId = window.setTimeout(() => {
      this.timerId = null
      void this.flushNow('scheduled').catch(() => {})
    }, delayMs)
  }

  private clearTimer() {
    if (this.timerId != null && typeof window !== 'undefined') {
      window.clearTimeout(this.timerId)
    }
    this.timerId = null
  }

  private syncState(
    status: AutoSaveStatus,
    patch?: Partial<Omit<AutoSaveState, 'status' | 'dirtyKeys'>>,
  ) {
    this.state = {
      ...this.state,
      ...patch,
      status,
      dirtyKeys: Array.from(this.dirtyKeys),
    }
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }
}

const autosaveCoordinator = new AutoSaveCoordinator()

export function registerAutoSaveTarget(key: string, target: AutoSaveTarget) {
  return autosaveCoordinator.registerTarget(key, target)
}

export function markDirty(key: string, reason: string) {
  autosaveCoordinator.markDirty(key, reason)
}

export function flushNow(reason: string, keys?: Iterable<string>) {
  return autosaveCoordinator.flushNow(reason, keys)
}

export function subscribeSaveState(listener: AutoSaveListener) {
  return autosaveCoordinator.subscribe(listener)
}

export function getAutoSaveState() {
  return autosaveCoordinator.getState()
}

export function resetAutoSaveCoordinatorForTest() {
  autosaveCoordinator.resetForTest()
}
