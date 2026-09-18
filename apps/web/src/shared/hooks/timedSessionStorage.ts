import { SNAPSHOT_STORAGE_PREFIX } from './timedSessionModel'

const DWELL_LOCAL_SNAPSHOT_KEY = 'memory-anki-dwell-session'

export function buildTimedSessionStorageKey(persistKey: string) {
  return `${SNAPSHOT_STORAGE_PREFIX}${persistKey}`
}

export function clearPersistedTimedSessionSnapshot(storageKey: string | null) {
  if (!storageKey) return
  try {
    window.sessionStorage.removeItem(storageKey)
  } catch {
    // Ignore storage errors in private mode or restricted environments.
  }
}

export function clearCompetingTimedSessionSnapshots(storageKey: string | null) {
  if (!storageKey) return
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index)
      if (!key || !key.startsWith(SNAPSHOT_STORAGE_PREFIX) || key === storageKey) {
        continue
      }
      window.sessionStorage.removeItem(key)
    }
  } catch {
    // Ignore storage errors in private mode or restricted environments.
  }
}

export function readDwellLocalSnapshot(): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(DWELL_LOCAL_SNAPSHOT_KEY)
    if (!raw) return null
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

export function writeDwellLocalSnapshot(snapshot: unknown) {
  try {
    window.localStorage.setItem(DWELL_LOCAL_SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch {
    // Ignore storage errors in private mode or restricted environments.
  }
}

export function clearDwellLocalSnapshot() {
  try {
    window.localStorage.removeItem(DWELL_LOCAL_SNAPSHOT_KEY)
  } catch {
    // Ignore storage errors in private mode or restricted environments.
  }
}
