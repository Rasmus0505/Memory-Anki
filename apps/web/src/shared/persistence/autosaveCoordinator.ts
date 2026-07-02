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
    this.syncState('dirty', { lastReason: reason, errorMessage: null })
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
        const retryAttempt = Math.min(this.state.retryAttempt + 1, AUTO_SAVE_RETRY_DELAYS_MS.length)
        const errorMessage = error instanceof Error ? error.message : '自动保存失败'
        this.syncState('error', {
          lastReason: reason,
          errorMessage,
          retryAttempt,
        })
        this.schedule(AUTO_SAVE_RETRY_DELAYS_MS[retryAttempt - 1] ?? AUTO_SAVE_RETRY_DELAYS_MS[2])
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
