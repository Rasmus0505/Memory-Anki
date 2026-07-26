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

/**
 * Lazily created: several preference models call createPersistentPreferenceStore
 * during module evaluation, and circular imports can reach this module before a
 * top-level `const` initializer has run (TDZ crash). A function-scoped getter is
 * immune to evaluation order.
 */
// eslint-disable-next-line no-var -- var is hoisted (no TDZ) unlike let/const
var bridgedPreferenceEventsSet: Set<string> | undefined
function bridgedPreferenceEvents(): Set<string> {
  if (!bridgedPreferenceEventsSet) bridgedPreferenceEventsSet = new Set<string>()
  return bridgedPreferenceEventsSet
}

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

  /**
   * Registered lazily on first store access instead of at module evaluation:
   * preference models create stores at module scope, and the import cycle
   * settings/public → model → this file → clientPreferences → settings/public
   * means sibling bindings (onAppEvent / CLIENT_PREFERENCES_UPDATED_EVENT) can
   * still be in their temporal dead zone during a circular first evaluation.
   */
  const ensureBridge = () => {
    if (typeof window === 'undefined') return
    const bridgeKey = `${String(cacheKey)}:${updatedEvent}`
    if (bridgedPreferenceEvents().has(bridgeKey)) return
    bridgedPreferenceEvents().add(bridgeKey)
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
    ensureBridge()
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
    ensureBridge()
    const sanitized = sanitize(value)
    syncBackend(sanitized)
    return sanitized
  }

  const reset = () => {
    ensureBridge()
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
