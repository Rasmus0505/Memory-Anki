import { useCallback, useEffect, useState } from 'react'
import { createPersistentPreferenceStore } from '@/shared/preferences/persistentPreferenceStore'
import {
  DEFAULT_FLIP_CARD_REVEAL_CONFIG,
  sanitizeFlipCardRevealConfig,
  type FlipCardRevealConfig,
} from '@/shared/preferences/flipCardRevealConfig'

export type { FlipCardRevealConfig }
export { DEFAULT_FLIP_CARD_REVEAL_CONFIG, sanitizeFlipCardRevealConfig }

export const FLIP_CARD_REVEAL_SETTINGS_STORAGE_KEY = 'memory-anki-flip-card-reveal-config'
export const FLIP_CARD_REVEAL_SETTINGS_UPDATED_EVENT = 'memory-anki-flip-card-reveal-config-change'

const store = createPersistentPreferenceStore<FlipCardRevealConfig>({
  cacheKey: 'flip_card_reveal_config',
  defaultValue: DEFAULT_FLIP_CARD_REVEAL_CONFIG,
  localStorageKey: FLIP_CARD_REVEAL_SETTINGS_STORAGE_KEY,
  sanitize: sanitizeFlipCardRevealConfig,
  updatedEvent: FLIP_CARD_REVEAL_SETTINGS_UPDATED_EVENT,
  isValidCache: (value): value is FlipCardRevealConfig => Boolean(value && typeof value === 'object'),
})

export const readFlipCardRevealSettings = store.read
export const writeFlipCardRevealSettings = store.write
export const resetFlipCardRevealSettings = store.reset

export function useFlipCardRevealSettings() {
  const [settings, setSettings] = useState<FlipCardRevealConfig>(() => readFlipCardRevealSettings())

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null
      setSettings(sanitizeFlipCardRevealConfig(detail ?? readFlipCardRevealSettings()))
    }
    window.addEventListener(FLIP_CARD_REVEAL_SETTINGS_UPDATED_EVENT, handleUpdate)
    window.addEventListener('storage', handleUpdate)
    return () => {
      window.removeEventListener(FLIP_CARD_REVEAL_SETTINGS_UPDATED_EVENT, handleUpdate)
      window.removeEventListener('storage', handleUpdate)
    }
  }, [])

  const updateSettings = useCallback((next: FlipCardRevealConfig) => {
    setSettings(writeFlipCardRevealSettings(next))
  }, [])

  const resetSettings = useCallback(() => {
    setSettings(resetFlipCardRevealSettings())
  }, [])

  return { settings, updateSettings, resetSettings }
}
