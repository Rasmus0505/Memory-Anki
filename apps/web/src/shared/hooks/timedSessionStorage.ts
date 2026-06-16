import { SNAPSHOT_STORAGE_PREFIX } from './timedSessionModel'

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
