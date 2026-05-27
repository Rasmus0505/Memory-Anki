import { useEffect, useState } from 'react'

function readLocalStorageValue<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): T {
  if (typeof window === 'undefined') return fallback

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed: unknown = JSON.parse(raw)
    return isValid(parsed) ? parsed : fallback
  } catch {
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
    if (typeof window === 'undefined') return
    window.localStorage.setItem(key, JSON.stringify(value))
  }, [key, value])

  return [value, setValue] as const
}
