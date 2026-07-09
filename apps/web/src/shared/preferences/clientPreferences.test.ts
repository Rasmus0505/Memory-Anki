import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLIENT_PREFERENCES_UPDATED_EVENT,
  getCachedClientPreference,
  migrateLocalPreferenceToBackend,
  resetClientPreferenceCacheForTest,
  saveClientPreference,
} from '@/shared/preferences/clientPreferences'
import {
  getClientPreferencesApi,
  updateClientPreferencesApi,
} from '@/entities/preferences/api'

vi.mock('@/entities/preferences/api', () => ({
  getClientPreferencesApi: vi.fn(),
  updateClientPreferencesApi: vi.fn(),
}))

const mockGetClientPreferencesApi = vi.mocked(getClientPreferencesApi)
const mockUpdateClientPreferencesApi = vi.mocked(updateClientPreferencesApi)

function emptyPreferences() {
  return {
    memory_anki_shortcuts: null,
    review_feedback_settings: null,
    english_practice_settings: null,
    timer_automation_config: null,
    timer_focus_config: null,
    break_guard_config: null,
    dashboard_duration_filter: null,
    study_goals: null,
    palace_list_view_settings: null,
    palace_shelf_view_settings: null,
  }
}

describe('clientPreferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
    vi.clearAllMocks()
  })

  it('migrates a local value when the backend has no preference entry', async () => {
    mockGetClientPreferencesApi.mockResolvedValue({ items: emptyPreferences() })
    mockUpdateClientPreferencesApi.mockImplementation(async (data) => ({
      items: {
        ...emptyPreferences(),
        english_practice_settings: data.english_practice_settings as Record<string, unknown>,
      },
    }))
    window.localStorage.setItem(
      'legacy-english',
      JSON.stringify({ sound: { enabled: false, masterVolume: 0.25 } }),
    )

    const migrated = await migrateLocalPreferenceToBackend(
      'english_practice_settings',
      'legacy-english',
      { sound: { enabled: true, masterVolume: 0.5 } },
      (value) => {
        const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
        const sound = raw.sound && typeof raw.sound === 'object' ? (raw.sound as Record<string, unknown>) : {}
        return {
          sound: {
            enabled: typeof sound.enabled === 'boolean' ? sound.enabled : true,
            masterVolume: typeof sound.masterVolume === 'number' ? sound.masterVolume : 0.5,
          },
        }
      },
    )

    expect(migrated.sound.enabled).toBe(false)
    expect(mockUpdateClientPreferencesApi).toHaveBeenCalledWith({
      english_practice_settings: { sound: { enabled: false, masterVolume: 0.25 } },
    })
    expect(window.localStorage.getItem('legacy-english')).toBeNull()
  })

  it('keeps local migration data when backend loading fails', async () => {
    mockGetClientPreferencesApi.mockRejectedValue(new Error('offline'))
    window.localStorage.setItem('legacy-focus', JSON.stringify({ enabled: true }))

    const migrated = await migrateLocalPreferenceToBackend(
      'timer_focus_config',
      'legacy-focus',
      { enabled: false },
      (value) => ({
        enabled: Boolean((value as { enabled?: unknown } | null)?.enabled),
      }),
    )

    expect(migrated.enabled).toBe(true)
    expect(mockUpdateClientPreferencesApi).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('legacy-focus')).toBe(JSON.stringify({ enabled: true }))
  })

  it('publishes optimistic cache updates even when persistence fails', async () => {
    mockUpdateClientPreferencesApi.mockRejectedValue(new Error('offline'))
    const events: unknown[] = []
    window.addEventListener(CLIENT_PREFERENCES_UPDATED_EVENT, (event) => {
      events.push(event instanceof CustomEvent ? event.detail : null)
    })

    const saved = await saveClientPreference('timer_focus_config', { enabled: true })

    expect(saved.persisted).toBe(false)
    expect(
      getCachedClientPreference(
        'timer_focus_config',
        null,
        (value): value is { enabled: boolean } => Boolean(value && typeof value === 'object'),
      ),
    ).toEqual({ enabled: true })
    expect(events).toHaveLength(1)
  })

  it('keeps the latest value when rapid saves resolve out of order', async () => {
    let resolveFirst: ((value: { items: ReturnType<typeof emptyPreferences> }) => void) | null = null
    let resolveSecond: ((value: { items: ReturnType<typeof emptyPreferences> }) => void) | null = null

    mockUpdateClientPreferencesApi
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          }),
      )

    const firstSave = saveClientPreference('timer_focus_config', { enabled: true })
    const secondSave = saveClientPreference('timer_focus_config', { enabled: false })

    resolveSecond?.({
      items: {
        ...emptyPreferences(),
        timer_focus_config: { enabled: false },
      },
    })
    await secondSave

    resolveFirst?.({
      items: {
        ...emptyPreferences(),
        timer_focus_config: { enabled: true },
      },
    })
    await firstSave

    expect(
      getCachedClientPreference(
        'timer_focus_config',
        null,
        (value): value is { enabled: boolean } => Boolean(value && typeof value === 'object'),
      ),
    ).toEqual({ enabled: false })
  })
})
