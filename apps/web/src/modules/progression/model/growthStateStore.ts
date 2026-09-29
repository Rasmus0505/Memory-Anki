import { useEffect, useState } from 'react'
import { createPersistentPreferenceStore } from '@/shared/preferences/persistentPreferenceStore'
import { DEFAULT_GROWTH_STATE, isGrowthState, sanitizeGrowthState, type GrowthState } from '../domain/growthState'

export const GROWTH_STATE_STORAGE_KEY = 'memory-anki.growth-state.v1'
export const GROWTH_STATE_UPDATED_EVENT = 'memory-anki-growth-state-change'

const store = createPersistentPreferenceStore<GrowthState>({
  cacheKey: 'growth_state',
  defaultValue: DEFAULT_GROWTH_STATE,
  localStorageKey: GROWTH_STATE_STORAGE_KEY,
  sanitize: sanitizeGrowthState,
  updatedEvent: GROWTH_STATE_UPDATED_EVENT,
  isValidCache: isGrowthState,
})

export function readGrowthState() {
  return store.read()
}

export function writeGrowthState(next: GrowthState) {
  return store.write(sanitizeGrowthState(next))
}

export function updateGrowthState(patch: Partial<GrowthState>) {
  return writeGrowthState({ ...store.read(), ...patch })
}

export function useGrowthState() {
  const [state, setState] = useState<GrowthState>(() => store.read())
  useEffect(() => {
    const sync = () => setState(store.read())
    window.addEventListener(GROWTH_STATE_UPDATED_EVENT, sync)
    return () => window.removeEventListener(GROWTH_STATE_UPDATED_EVENT, sync)
  }, [])
  return state
}
