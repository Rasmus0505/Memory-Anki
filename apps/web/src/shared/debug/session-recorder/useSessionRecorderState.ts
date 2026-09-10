import { useSyncExternalStore } from 'react'
import { getSessionRecorderState, subscribeSessionRecorder } from './sessionRecorderStore'
import type { SessionRecorderState } from './sessionRecorderTypes'

export function useSessionRecorderState(): SessionRecorderState {
  return useSyncExternalStore(subscribeSessionRecorder, getSessionRecorderState, getSessionRecorderState)
}
