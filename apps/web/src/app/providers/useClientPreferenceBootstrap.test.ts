import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientPreferences } from '@/shared/api/contracts'
import {
  getClientPreferencesApi,
  updateClientPreferencesApi,
} from '@/entities/preferences/api'
import { toast } from '@/shared/feedback/toast'
import {
  BREAK_GUARD_STORAGE_KEY,
  BREAK_GUARD_UPDATED_EVENT,
  DEFAULT_BREAK_GUARD_CONFIG,
  sanitizeBreakGuardConfig,
} from '@/shared/components/session/break-guard-config'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { bootstrapClientPreferences } from './useClientPreferenceBootstrap'

vi.mock('@/entities/preferences/api', () => ({
  getClientPreferencesApi: vi.fn(),
  updateClientPreferencesApi: vi.fn(),
}))

vi.mock('@/shared/feedback/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}))

const mockGetClientPreferencesApi = vi.mocked(getClientPreferencesApi)
const mockUpdateClientPreferencesApi = vi.mocked(updateClientPreferencesApi)
const mockToast = vi.mocked(toast)

function emptyPreferences(): ClientPreferences {
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

describe('bootstrapClientPreferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
    vi.clearAllMocks()
  })

  it('migrates legacy break guard localStorage without replacing it with defaults', async () => {
    const legacyConfig = {
      enabled: false,
      promptDelaySeconds: 17,
      presetMinutes: [25, 5, 25],
      allowCustomMinutes: false,
      autoFinishOnStudyReturn: false,
      resumeInterruptedStudyOnReturn: false,
      targetPath: '/review',
      alertStrength: 'gentle',
      snoozeMinutes: [9, 1],
      recordBreakLogs: false,
    }
    const expectedConfig = sanitizeBreakGuardConfig(legacyConfig)
    const events: unknown[] = []

    mockGetClientPreferencesApi.mockResolvedValue({ items: emptyPreferences() })
    mockUpdateClientPreferencesApi.mockImplementation(async (data) => ({
      items: {
        ...emptyPreferences(),
        ...data,
      },
    }))
    window.localStorage.setItem(BREAK_GUARD_STORAGE_KEY, JSON.stringify(legacyConfig))
    window.addEventListener(BREAK_GUARD_UPDATED_EVENT, (event) => {
      events.push(event instanceof CustomEvent ? event.detail : null)
    })

    await bootstrapClientPreferences()

    expect(expectedConfig).not.toEqual(DEFAULT_BREAK_GUARD_CONFIG)
    expect(mockUpdateClientPreferencesApi).toHaveBeenCalledWith(
      expect.objectContaining({
        break_guard_config: expectedConfig,
      }),
    )
    expect(events).toContainEqual(expectedConfig)
    expect(window.localStorage.getItem(BREAK_GUARD_STORAGE_KEY)).toBeNull()
    expect(mockToast.success).toHaveBeenCalledWith('关键个人设置已迁移到后端保存，改代码和切版本时会更稳。')
  })
})
