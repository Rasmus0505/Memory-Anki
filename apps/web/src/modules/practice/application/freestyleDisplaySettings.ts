import { createPersistentPreferenceStore } from '@/shared/preferences/persistentPreferenceStore'

export const FREESTYLE_DISPLAY_SETTINGS_STORAGE_KEY = 'memory-anki.freestyle.display-settings.v1'
export const FREESTYLE_DISPLAY_SETTINGS_UPDATED_EVENT = 'memory-anki-freestyle-display-settings-change'

export type FreestyleFlipMode = 'free' | 'focused'
export type FreestyleRatingScope = 'unit' | 'palace'

export interface FreestyleDisplaySettings {
  rating_mode: boolean
  flip_mode: FreestyleFlipMode
  /**
   * Opt-in: advance to the next card after a passing rate. Off by default so the
   * learner keeps control of pace; a weak rate never auto-advances because the
   * card is what they still need to look at.
   */
  auto_advance: boolean
  /** Section vs whole-palace due rating. Defaults to the current unit only. */
  rating_scope: FreestyleRatingScope
}

export const DEFAULT_FREESTYLE_DISPLAY_SETTINGS: FreestyleDisplaySettings = {
  rating_mode: true,
  flip_mode: 'free',
  auto_advance: false,
  rating_scope: 'unit',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isFreestyleDisplaySettings(value: unknown): value is FreestyleDisplaySettings {
  return isRecord(value) && typeof value.rating_mode === 'boolean'
}

export function sanitizeFreestyleDisplaySettings(value: unknown): FreestyleDisplaySettings {
  const raw = isRecord(value) ? value : {}
  return {
    // Keep the legacy field readable, but migrate both true and false to the
    // new always-visible rating behavior.
    rating_mode: true,
    flip_mode: raw.flip_mode === 'focused' || raw.flip_mode === 'free'
      ? raw.flip_mode
      : DEFAULT_FREESTYLE_DISPLAY_SETTINGS.flip_mode,
    auto_advance: typeof raw.auto_advance === 'boolean'
      ? raw.auto_advance
      : DEFAULT_FREESTYLE_DISPLAY_SETTINGS.auto_advance,
    rating_scope: raw.rating_scope === 'palace' ? 'palace' : 'unit',
  }
}

const displaySettingsStore = createPersistentPreferenceStore<FreestyleDisplaySettings>({
  cacheKey: 'freestyle_display_settings',
  defaultValue: DEFAULT_FREESTYLE_DISPLAY_SETTINGS,
  localStorageKey: FREESTYLE_DISPLAY_SETTINGS_STORAGE_KEY,
  sanitize: sanitizeFreestyleDisplaySettings,
  updatedEvent: FREESTYLE_DISPLAY_SETTINGS_UPDATED_EVENT,
  isValidCache: isFreestyleDisplaySettings,
})

export function readFreestyleDisplaySettings() {
  return displaySettingsStore.read()
}

export function saveFreestyleDisplaySettings(
  settings: Partial<FreestyleDisplaySettings>,
) {
  return displaySettingsStore.write({
    ...readFreestyleDisplaySettings(),
    ...settings,
  })
}
