import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPersistentPreferenceStore } from '@/shared/preferences/persistentPreferenceStore'
import {
  initializeClientPreferences,
  resetClientPreferenceCacheForTest,
} from '@/shared/preferences/clientPreferences'
import {
  getClientPreferencesApi,
  updateClientPreferencesApi,
} from '@/entities/preferences/api/clientPreferencesApi'

vi.mock('@/entities/preferences/api/clientPreferencesApi', () => ({
  getClientPreferencesApi: vi.fn(),
  updateClientPreferencesApi: vi.fn(),
}))

const mockGetClientPreferencesApi = vi.mocked(getClientPreferencesApi)
const mockUpdateClientPreferencesApi = vi.mocked(updateClientPreferencesApi)

interface FlagPreference {
  enabled: boolean
}

function emptyPreferences() {
  return {
    memory_anki_shortcuts: null,
    review_feedback_settings: null,
    english_practice_settings: null,
    timer_automation_config: null,
    timer_focus_config: null,
    break_guard_config: null,
    dashboard_duration_filter: null,
    palace_list_view_settings: null,
    palace_shelf_view_settings: null,
    voice_coach_settings: null,
  }
}

function createFlagStore() {
  return createPersistentPreferenceStore<FlagPreference>({
    cacheKey: 'voice_coach_settings',
    defaultValue: { enabled: false },
    localStorageKey: 'legacy-flag',
    sanitize: (value) => ({
      enabled: Boolean((value as { enabled?: unknown } | null)?.enabled),
    }),
    updatedEvent: 'flag-updated',
    isValidCache: (value): value is FlagPreference => Boolean(value && typeof value === 'object'),
  })
}

describe('createPersistentPreferenceStore', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
    vi.clearAllMocks()
  })

  it('prefers loaded backend cache over stale localStorage', async () => {
    mockGetClientPreferencesApi.mockResolvedValue({
      items: {
        ...emptyPreferences(),
        voice_coach_settings: { enabled: true },
      },
    })
    window.localStorage.setItem('legacy-flag', JSON.stringify({ enabled: false }))

    await initializeClientPreferences()

    expect(createFlagStore().read()).toEqual({ enabled: true })
  })

  it('falls back to localStorage before the backend cache is loaded', () => {
    window.localStorage.setItem('legacy-flag', JSON.stringify({ enabled: true }))

    expect(createFlagStore().read()).toEqual({ enabled: true })
  })

  it('dispatches the feature event for optimistic writes before persistence succeeds', () => {
    mockUpdateClientPreferencesApi.mockRejectedValue(new Error('offline'))
    const updates: unknown[] = []
    window.addEventListener('flag-updated', (event) => {
      updates.push(event instanceof CustomEvent ? event.detail : null)
    })

    const saved = createFlagStore().write({ enabled: true })

    expect(saved).toEqual({ enabled: true })
    expect(updates).toEqual([{ enabled: true }])
    expect(window.localStorage.getItem('legacy-flag')).toBeNull()
  })
})
