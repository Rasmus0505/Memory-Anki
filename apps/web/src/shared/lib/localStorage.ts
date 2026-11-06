import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientPreferences } from '@/shared/api/contracts'
import {
  CLIENT_PREFERENCES_UPDATED_EVENT,
  getClientPreferenceCacheStatus,
  saveClientPreference,
} from '@/shared/preferences/clientPreferences'
import { onAppEvent } from '@/shared/events/appEvents'

type PreferenceKey = keyof ClientPreferences

/** Validator for panel/flag states stored as a bare JSON boolean. */
export function isStoredBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function readLocalStorageValue<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
  preferenceKey?: PreferenceKey,
): T {
  if (preferenceKey) {
    const cached = getClientPreferenceCacheStatus(preferenceKey, isValid)
    if (cached.value) {
      return cached.value
    }
    if (cached.hasEntry) {
      return fallback
    }
  }
  // A plain key (no backend preference) still persists through the setter
  // below; reading must mirror that write or a reload forgets the choice.
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      return isValid(parsed) ? parsed : fallback
    }
    return fallback
  } catch {
    return fallback
  }
}

export function useLocalStorageState<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
  preferenceKey?: PreferenceKey,
) {
  const [value, setValue] = useState<T>(() =>
    readLocalStorageValue(key, fallback, isValid, preferenceKey),
  )
  const valueRef = useRef(value)

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    if (!preferenceKey || typeof window === 'undefined') return undefined

    const unsubscribe = onAppEvent(CLIENT_PREFERENCES_UPDATED_EVENT, (eventDetail) => {
      const detail = detailIsPreferencePatch(eventDetail)
        ? eventDetail
        : null
      if (!detail || !Object.prototype.hasOwnProperty.call(detail, preferenceKey)) return
      const nextValue = detail[preferenceKey]
      setValue(isValid(nextValue) ? nextValue : fallback)
    })
    return unsubscribe
  }, [fallback, isValid, preferenceKey])

  const setPersistentValue = useCallback(
    (nextValue: T | ((current: T) => T)) => {
      const resolved =
        typeof nextValue === 'function'
          ? (nextValue as (current: T) => T)(valueRef.current)
          : nextValue
      valueRef.current = resolved
      setValue(resolved)
      if (preferenceKey) {
        void saveClientPreference(preferenceKey, resolved)
      } else if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(resolved))
      }
    },
    [key, preferenceKey],
  )

  return [value, setPersistentValue] as const
}

function detailIsPreferencePatch(value: unknown): value is Partial<ClientPreferences> {
  return Boolean(value && typeof value === 'object')
}
