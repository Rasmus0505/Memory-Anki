import { useEffect, useState } from 'react'
import type { ClientPreferences } from '@/shared/api/contracts'
import {
  getCachedClientPreference,
  setClientPreference,
} from '@/shared/preferences/clientPreferences'

const LOCAL_STORAGE_PREFERENCE_MAP: Record<string, keyof ClientPreferences> = {
  memory_anki_dashboard_total_duration_filter: 'dashboard_duration_filter',
  palace_list_view_settings: 'palace_list_view_settings',
  palace_shelf_view_settings: 'palace_shelf_view_settings',
}

function readLocalStorageValue<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): T {
  const preferenceKey = LOCAL_STORAGE_PREFERENCE_MAP[key]
  if (!preferenceKey) return fallback
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      return isValid(parsed) ? parsed : fallback
    }
    const cached = getCachedClientPreference(preferenceKey, fallback, isValid)
    if (cached !== fallback) {
      return cached
    }
    return fallback
  } catch {
    const cached = getCachedClientPreference(preferenceKey, fallback, isValid)
    if (cached !== fallback) {
      return cached
    }
    return fallback
  }
}

export function useLocalStorageState<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
) {
  const [value, setValue] = useState<T>(() => readLocalStorageValue(key, fallback, isValid))

  useEffect(() => {
    const preferenceKey = LOCAL_STORAGE_PREFERENCE_MAP[key]
    if (!preferenceKey) return
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, JSON.stringify(value))
    }
    void setClientPreference(preferenceKey, value)
  }, [key, value])

  return [value, setValue] as const
}
