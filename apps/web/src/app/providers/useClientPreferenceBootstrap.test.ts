import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientPreferences } from '@/shared/api/contracts'
import { toast } from '@/shared/feedback/toast'
import {
  BREAK_GUARD_STORAGE_KEY,
  BREAK_GUARD_UPDATED_EVENT,
  DEFAULT_BREAK_GUARD_CONFIG,
  sanitizeBreakGuardConfig,
} from '@/shared/components/session/break-guard-config'
import { FREESTYLE_FEED_CONFIG_STORAGE_KEY } from '@/modules/practice/domain/feedConfig'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { bootstrapClientPreferences } from './useClientPreferenceBootstrap'
import * as clientPreferencesApi from '@/modules/settings/domain/preferences-entity/api/clientPreferencesApi'

vi.mock('@/shared/feedback/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}))

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
    review_queue_view_settings: null,
    time_record_tags: null,
    freestyle_feed_config: null,
  }
}

describe('bootstrapClientPreferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
    vi.restoreAllMocks()
    vi.spyOn(clientPreferencesApi, 'getClientPreferencesApi').mockResolvedValue({
      items: emptyPreferences(),
    })
    vi.spyOn(clientPreferencesApi, 'updateClientPreferencesApi').mockImplementation(async (data) => ({
      items: {
        ...emptyPreferences(),
        ...data,
      },
    }))
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

    window.localStorage.setItem(BREAK_GUARD_STORAGE_KEY, JSON.stringify(legacyConfig))
    window.addEventListener(BREAK_GUARD_UPDATED_EVENT, (event) => {
      events.push(event instanceof CustomEvent ? event.detail : null)
    })

    await bootstrapClientPreferences()

    expect(expectedConfig).not.toEqual(DEFAULT_BREAK_GUARD_CONFIG)
    expect(clientPreferencesApi.updateClientPreferencesApi).toHaveBeenCalledWith(
      expect.objectContaining({
        break_guard_config: expectedConfig,
      }),
    )
    expect(events).toContainEqual(expectedConfig)
    expect(window.localStorage.getItem(BREAK_GUARD_STORAGE_KEY)).toBeNull()
    expect(mockToast.success).toHaveBeenCalledWith('关键个人设置已迁移到后端保存，改代码和切版本时会更稳。')
  })

  it('migrates legacy freestyle feed config into client preferences', async () => {
    const legacyConfig = {
      content: { mindmap_branch: true, quiz_question: false },
      weights: { mindmap_branch: 3, quiz_question: 0 },
      palace_order: 'interleave_palaces',
      within_palace_order: 'tree_order',
      due_policy: 'due_only',
      node_limit: 8,
      queue_length: 15,
      specific_palace_ids: [3],
      question_type: 'all',
      weak_quiz_priority: false,
      seed: 42,
    }
    window.localStorage.setItem(FREESTYLE_FEED_CONFIG_STORAGE_KEY, JSON.stringify(legacyConfig))

    await bootstrapClientPreferences()

    expect(clientPreferencesApi.updateClientPreferencesApi).toHaveBeenCalledWith(
      expect.objectContaining({
        freestyle_feed_config: expect.objectContaining({
          node_limit: 8,
          queue_length: 15,
          seed: 42,
          content: { mindmap_branch: true, quiz_question: false },
        }),
      }),
    )
    expect(window.localStorage.getItem(FREESTYLE_FEED_CONFIG_STORAGE_KEY)).toBeNull()
  })
})
