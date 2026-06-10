import type { ClientPreferences } from '@/shared/api/contracts'
import {
  getClientPreferencesApi,
  updateClientPreferencesApi,
} from '@/shared/api/modules/profile'

export const CLIENT_PREFERENCES_UPDATED_EVENT = 'memory-anki-client-preferences-updated'

type PreferenceKey = keyof ClientPreferences
type PreferenceValidator<T> = (value: unknown) => value is T
type PreferenceNormalizer<T> = PreferenceValidator<T> | ((value: unknown) => T)

const cache: Partial<ClientPreferences> = {}
let initialized = false
let initializePromise: Promise<void> | null = null

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
  const value = cache[key]
  return isValid(value) ? value : fallback
}

export async function initializeClientPreferences() {
  if (initialized) return
  if (initializePromise) return initializePromise
  initializePromise = (async () => {
    try {
      const response = await getClientPreferencesApi()
      Object.assign(cache, response.items || {})
      initialized = true
      emitUpdate()
    } catch {
      initialized = true
    } finally {
      initializePromise = null
    }
  })()
  return initializePromise
}

export async function setClientPreference<T>(key: PreferenceKey, value: T) {
  cache[key] = value as ClientPreferences[PreferenceKey]
  emitUpdate()
  try {
    const response = await updateClientPreferencesApi({ [key]: value })
    Object.assign(cache, response.items || {})
    emitUpdate()
  } catch {
    // Keep optimistic cache even if the network request fails.
  }
  return cache[key] as T
}

export function resetClientPreferenceCacheForTest() {
  for (const key of Object.keys(cache) as PreferenceKey[]) {
    delete cache[key]
  }
  initialized = false
  initializePromise = null
}

export async function migrateLocalPreferenceToBackend<T>(
  key: PreferenceKey,
  localStorageKey: string,
  fallback: T,
  normalizeValue: PreferenceNormalizer<T>,
) {
  await initializeClientPreferences()

  const normalizePreference = (value: unknown) => {
    const normalized = normalizeValue(value)
    if (typeof normalized === 'boolean') {
      return normalized ? (value as T) : null
    }
    return normalized
  }

  const existing = cache[key]
  const normalizedExisting = normalizePreference(existing)
  if (normalizedExisting) {
    try {
      window.localStorage.removeItem(localStorageKey)
    } catch {
      // Ignore storage cleanup failures.
    }
    return normalizedExisting
  }

  let nextValue = fallback
  try {
    const raw = window.localStorage.getItem(localStorageKey)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      const normalizedParsed = normalizePreference(parsed)
      if (normalizedParsed) {
        nextValue = normalizedParsed
      }
    }
  } catch {
    nextValue = fallback
  }

  const saved = await setClientPreference<T>(key, nextValue)
  try {
    window.localStorage.removeItem(localStorageKey)
  } catch {
    // Ignore storage cleanup failures.
  }
  return saved
}
