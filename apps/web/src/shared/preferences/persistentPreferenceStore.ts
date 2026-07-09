import type { ClientPreferences } from '@/shared/api/contracts'
import {
  CLIENT_PREFERENCES_UPDATED_EVENT,
  getClientPreferenceCacheStatus,
  hasLoadedClientPreferences,
  saveClientPreference,
} from '@/shared/preferences/clientPreferences'
import { emitAppEvent, onAppEvent } from '@/shared/events/appEvents'

type PreferenceKey = keyof ClientPreferences
type PreferenceValidator<T> = (value: unknown) => value is T
const bridgedPreferenceEvents = new Set<string>()

export interface PersistentPreferenceStore<T> {
  read(): T
  write(value: T): T
  reset(): T
}

export interface PersistentPreferenceStoreOptions<T> {
  cacheKey: PreferenceKey
  defaultValue: T
  localStorageKey: string
  sanitize: (value: unknown) => T
  updatedEvent: string
  isValidCache: PreferenceValidator<T>
}

export function createPersistentPreferenceStore<T>({
  cacheKey,
  defaultValue,
  localStorageKey,
  sanitize,
  updatedEvent,
  isValidCache,
}: PersistentPreferenceStoreOptions<T>): PersistentPreferenceStore<T> {
  const dispatchUpdate = (value: T) => {
    emitAppEvent(updatedEvent, value)
  }

  const bridgeKey = `${String(cacheKey)}:${updatedEvent}`
  if (typeof window !== 'undefined' && !bridgedPreferenceEvents.has(bridgeKey)) {
    bridgedPreferenceEvents.add(bridgeKey)
    onAppEvent(CLIENT_PREFERENCES_UPDATED_EVENT, (eventDetail) => {
      const detail = detailIsClientPreferencePatch(eventDetail) ? eventDetail : null
      if (!detail || !Object.prototype.hasOwnProperty.call(detail, cacheKey)) return
      const value = detail[cacheKey]
      dispatchUpdate(isValidCache(value) ? sanitize(value) : defaultValue)
    })
  }

  const syncBackend = (value: T) => {
    void saveClientPreference(cacheKey, value)
  }

  const read = () => {
    const cached = getClientPreferenceCacheStatus(cacheKey, isValidCache)
    if (cached.value) {
      return sanitize(cached.value)
    }
    if (cached.hasEntry || hasLoadedClientPreferences()) {
      return defaultValue
    }

    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(localStorageKey)
        if (raw) {
          return sanitize(JSON.parse(raw))
        }
      } catch {
        return defaultValue
      }
    }

    return defaultValue
  }

  const write = (value: T) => {
    const sanitized = sanitize(value)
    syncBackend(sanitized)
    return sanitized
  }

  const reset = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(localStorageKey)
    }
    syncBackend(defaultValue)
    return defaultValue
  }

  return {
    read,
    write,
    reset,
  }
}

function detailIsClientPreferencePatch(value: unknown): value is Partial<ClientPreferences> {
  return Boolean(value && typeof value === 'object')
}
