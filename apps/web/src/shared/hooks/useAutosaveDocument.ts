import { useEffect, useRef, useState } from 'react'
import { useLatestRef } from './useLatestRef'

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

const DEFAULT_DEBOUNCE_MS = 800
const DEFAULT_RETRY_DELAYS_MS = [500, 1000, 1500] as const

export function useAutosaveDocument<T>(options: {
  value: T
  persist: (value: T) => unknown
  debounceMs?: number
  retryDelaysMs?: readonly number[]
}): { status: AutosaveStatus } {
  const {
    value,
    persist,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  } = options
  const serialized = JSON.stringify(value)
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const valueRef = useLatestRef(value)
  const persistRef = useLatestRef(persist)
  const retryDelaysRef = useLatestRef(retryDelaysMs)
  const savedKeyRef = useRef(serialized)

  useEffect(() => {
    if (serialized === savedKeyRef.current) {
      setStatus((current) => (current === 'idle' ? current : 'saved'))
      return undefined
    }

    let disposed = false
    const timers: number[] = []

    const attempt = async (retryIndex: number): Promise<void> => {
      if (disposed) return
      const snapshot = valueRef.current
      const key = JSON.stringify(snapshot)
      setStatus('saving')
      try {
        await persistRef.current(snapshot)
        savedKeyRef.current = key
        setStatus(JSON.stringify(valueRef.current) === key ? 'saved' : 'pending')
      } catch {
        if (disposed) return
        const retryDelays = retryDelaysRef.current
        if (retryIndex < retryDelays.length) {
          timers.push(window.setTimeout(() => void attempt(retryIndex + 1), retryDelays[retryIndex]))
        } else {
          setStatus('error')
        }
      }
    }

    setStatus('pending')
    timers.push(window.setTimeout(() => void attempt(0), debounceMs))
    return () => {
      disposed = true
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [serialized, debounceMs, valueRef, persistRef, retryDelaysRef])

  return { status }
}
