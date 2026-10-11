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
// Conflicts must not create an endless autosave loop. The durable draft belongs
// to each target; a new edit or an explicit flush can resume its retry budget.
const AUTO_SAVE_MAX_ATTEMPTS = AUTO_SAVE_RETRY_DELAYS_MS.length

class AutoSaveCoordinator {
  private listeners = new Set<AutoSaveListener>()
  private targets = new Map<string, AutoSaveTarget>()
  private dirtyKeys = new Map<string, number>()
  private generation = 0
  private inFlight = new Map<string, Promise<void>>()
  private attempts = new Map<string, number>()
  private errors = new Map<string, string>()
  private dueAt = new Map<string, number>()
  private timerId: number | null = null
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
      // An old component's cleanup must not unregister its replacement.
      if (this.targets.get(key) !== target) return
      this.targets.delete(key)
      this.clearDirty(key)
      this.syncState()
      this.scheduleNext()
    }
  }

  markDirty(key: string, reason: string) {
    if (!this.targets.has(key)) return
    const hadFailure = this.attempts.has(key)
    this.dirtyKeys.set(key, ++this.generation)
    this.attempts.delete(key)
    this.errors.delete(key)
    if (!this.dueAt.has(key) || hadFailure) {
      this.dueAt.set(key, Date.now() + AUTO_SAVE_DELAY_MS)
    }
    this.syncState(reason)
    this.scheduleNext()
  }

  async flushNow(reason: string, keys?: Iterable<string>) {
    const requestedKeys = keys ? new Set(keys) : null
    const dirtyKeys = Array.from(this.dirtyKeys.keys())
      .filter((key) => requestedKeys == null || requestedKeys.has(key))
    if (dirtyKeys.length === 0) {
      this.syncState(reason)
      return
    }

    // Targets are independent. A slow or failed palace must not hold up a timer
    // checkpoint or a different palace. Each individual target remains serial.
    const results = await Promise.allSettled(dirtyKeys.map((key) => this.flushTarget(key, reason)))
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }

  private flushTarget(key: string, reason: string): Promise<void> {
    const existing = this.inFlight.get(key)
    if (existing) return existing
    const target = this.targets.get(key)
    const generation = this.dirtyKeys.get(key)
    if (!target || generation == null) return Promise.resolve()
    this.dueAt.delete(key)

    // Defer invoking a target until the in-flight identity is installed. A
    // synchronously throwing/re-entrant target obeys the same owner boundary.
    const operation = Promise.resolve().then(async () => {
      try {
        await target.flush(reason)
        if (this.targets.get(key) !== target) return
        if (this.dirtyKeys.get(key) === generation) {
          this.clearDirty(key)
        } else if (this.dirtyKeys.has(key) && !this.dueAt.has(key)) {
          this.dueAt.set(key, Date.now() + AUTO_SAVE_DELAY_MS)
        }
      } catch (error) {
        // A previous generation's failure cannot spend a newer edit's budget
        // or put a replacement component into an error state.
        if (this.targets.get(key) !== target || this.dirtyKeys.get(key) !== generation) return
        const attempt = Math.min((this.attempts.get(key) ?? 0) + 1, AUTO_SAVE_MAX_ATTEMPTS)
        this.attempts.set(key, attempt)
        this.errors.set(key, error instanceof Error ? error.message : '自动保存失败')
        if (attempt < AUTO_SAVE_MAX_ATTEMPTS) {
          this.dueAt.set(key, Date.now() + AUTO_SAVE_RETRY_DELAYS_MS[attempt - 1])
        }
        throw error
      } finally {
        if (this.inFlight.get(key) === operation) this.inFlight.delete(key)
        this.syncState(reason)
        this.scheduleNext()
      }
    })
    this.inFlight.set(key, operation)
    this.syncState(reason)
    this.scheduleNext()
    return operation
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
    this.inFlight.clear()
    this.attempts.clear()
    this.errors.clear()
    this.dueAt.clear()
    this.state = {
      status: 'idle',
      dirtyKeys: [],
      lastReason: null,
      errorMessage: null,
      retryAttempt: 0,
    }
  }

  private clearDirty(key: string) {
    this.dirtyKeys.delete(key)
    this.dueAt.delete(key)
    this.attempts.delete(key)
    this.errors.delete(key)
  }

  private scheduleNext() {
    this.clearTimer()
    if (typeof window === 'undefined') return
    const dueTimes = Array.from(this.dueAt.entries())
      .filter(([key]) => this.dirtyKeys.has(key) && !this.inFlight.has(key))
      .map(([, due]) => due)
    if (dueTimes.length === 0) return
    this.timerId = window.setTimeout(() => {
      this.timerId = null
      const keys = Array.from(this.dueAt.entries())
        .filter(([, due]) => due <= Date.now())
        .map(([key]) => key)
      void this.flushNow('scheduled', keys).catch(() => {})
    }, Math.max(0, Math.min(...dueTimes) - Date.now()))
  }

  private clearTimer() {
    if (this.timerId != null && typeof window !== 'undefined') {
      window.clearTimeout(this.timerId)
    }
    this.timerId = null
  }

  private syncState(reason?: string) {
    const status: AutoSaveStatus = this.inFlight.size > 0 ? 'saving'
      : this.errors.size > 0 ? 'error' : this.dirtyKeys.size > 0 ? 'dirty' : 'idle'
    this.state = {
      status,
      dirtyKeys: Array.from(this.dirtyKeys.keys()),
      lastReason: reason ?? this.state.lastReason,
      errorMessage: this.errors.values().next().value ?? null,
      retryAttempt: Math.max(0, ...this.attempts.values()),
    }
    for (const listener of this.listeners) listener(this.state)
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
