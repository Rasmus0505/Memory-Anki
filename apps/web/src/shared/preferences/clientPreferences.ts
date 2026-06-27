import type { ClientPreferences } from '@/shared/api/contracts'
import {
  getClientPreferencesApi,
  updateClientPreferencesApi,
} from '@/entities/preferences/api/clientPreferencesApi'

export const CLIENT_PREFERENCES_UPDATED_EVENT = 'memory-anki-client-preferences-updated'

type PreferenceKey = keyof ClientPreferences
type PreferenceValidator<T> = (value: unknown) => value is T
type PreferenceNormalizer<T> = PreferenceValidator<T> | ((value: unknown) => T)

const cache: Partial<ClientPreferences> = {}
const latestSaveVersion: Partial<Record<PreferenceKey, number>> = {}
let initialized = false
let initializationSucceeded = false
let initializePromise: Promise<boolean> | null = null

function emitUpdate() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(CLIENT_PREFERENCES_UPDATED_EVENT, {
      detail: { ...cache },
    }),
  )
}

export function getCachedClientPreference<T>(
  key: PreferenceKey,
  fallback: T,
  isValid: PreferenceValidator<T>,
): T {
  const cached = getClientPreferenceCacheStatus(key, isValid)
  return cached.value ?? fallback
}

export function hasLoadedClientPreferences() {
  return initialized && initializationSucceeded
}

export function getClientPreferenceCacheStatus<T>(
  key: PreferenceKey,
  isValid: PreferenceValidator<T>,
): { hasEntry: boolean; value: T | null } {
  const hasEntry = Object.prototype.hasOwnProperty.call(cache, key)
  const value = cache[key]
  return {
    hasEntry,
    value: isValid(value) ? value : null,
  }
}

export async function initializeClientPreferences() {
  if (initialized) return initializationSucceeded
  if (initializePromise) return initializePromise
  initializePromise = (async () => {
    try {
      const response = await getClientPreferencesApi()
      Object.assign(cache, response.items || {})
      initialized = true
      initializationSucceeded = true
      emitUpdate()
      return true
    } catch {
      initialized = true
      initializationSucceeded = false
      return false
    } finally {
      initializePromise = null
    }
  })()
  return initializePromise
}

export async function saveClientPreference<T>(key: PreferenceKey, value: T) {
  const requestVersion = (latestSaveVersion[key] ?? 0) + 1
  latestSaveVersion[key] = requestVersion
  cache[key] = value as ClientPreferences[PreferenceKey]
  emitUpdate()
  try {
    const response = await updateClientPreferencesApi({ [key]: value })
    if (latestSaveVersion[key] !== requestVersion) {
      return {
        value: cache[key] as T,
        persisted: true,
      }
    }
    Object.assign(cache, response.items || {})
    emitUpdate()
    return {
      value: cache[key] as T,
      persisted: true,
    }
  } catch {
    // Keep optimistic cache even if the network request fails.
    return {
      value: cache[key] as T,
      persisted: false,
    }
  }
}

export async function setClientPreference<T>(key: PreferenceKey, value: T) {
  const result = await saveClientPreference(key, value)
  return result.value
}

export function resetClientPreferenceCacheForTest() {
  for (const key of Object.keys(cache) as PreferenceKey[]) {
    delete cache[key]
  }
  for (const key of Object.keys(latestSaveVersion) as PreferenceKey[]) {
    delete latestSaveVersion[key]
  }
  initialized = false
  initializationSucceeded = false
  initializePromise = null
}

export async function migrateLocalPreferenceToBackend<T>(
  key: PreferenceKey,
  localStorageKey: string,
  fallback: T,
  normalizeValue: PreferenceNormalizer<T>,
) {
  if (typeof window === 'undefined') return fallback

  const loadedBackend = await initializeClientPreferences()
  if (!loadedBackend) {
    return readLocalPreference(localStorageKey, fallback, normalizeValue)
  }

  const normalizePreference = (value: unknown) => {
    const normalized = normalizeValue(value)
    if (typeof normalized === 'boolean') {
      return normalized ? (value as T) : null
    }
    return normalized
  }

  const hasExisting = Object.prototype.hasOwnProperty.call(cache, key) && cache[key] != null
  if (hasExisting) {
    const normalizedExisting = normalizePreference(cache[key])
    try {
      window.localStorage.removeItem(localStorageKey)
    } catch {
      // Ignore storage cleanup failures.
    }
    return normalizedExisting ?? fallback
  }

  const nextValue = readLocalPreference(localStorageKey, fallback, normalizeValue)

  const saved = await saveClientPreference<T>(key, nextValue)
  if (saved.persisted) {
    try {
      window.localStorage.removeItem(localStorageKey)
    } catch {
      // Ignore storage cleanup failures.
    }
  }
  return saved.value
}

function readLocalPreference<T>(
  localStorageKey: string,
  fallback: T,
  normalizeValue: PreferenceNormalizer<T>,
) {
  if (typeof window === 'undefined') return fallback

  const normalizePreference = (value: unknown) => {
    const normalized = normalizeValue(value)
    if (typeof normalized === 'boolean') {
      return normalized ? (value as T) : null
    }
    return normalized
  }

  try {
    const raw = window.localStorage.getItem(localStorageKey)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as unknown
    return normalizePreference(parsed) ?? fallback
  } catch {
    return fallback
  }
}
