import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientPreferences } from '@/shared/api/contracts'
import { FREESTYLE_FEED_CONFIG_STORAGE_KEY } from '@/modules/practice/domain/feedConfig'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { bootstrapClientPreferences } from './useClientPreferenceBootstrap'
import * as clientPreferencesApi from '@/modules/settings/domain/preferences-entity/api/clientPreferencesApi'

vi.mock('@/shared/feedback/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}))


function emptyPreferences(): ClientPreferences {
  return {
    memory_anki_shortcuts: null,
    review_feedback_settings: null,
    english_practice_settings: null,
    study_goals: null,
    palace_list_view_settings: null,
    palace_shelf_view_settings: null,
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

  it('migrates legacy freestyle feed config into client preferences', async () => {
    const legacyConfig = {
      content: { mindmap_branch: true, quiz_question: false },
      weights: { mindmap_branch: 3, quiz_question: 0 },
      palace_order: 'interleave_palaces',
      due_policy: 'due_only',
      node_limit: 8,
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
          seed: 42,
          content: expect.objectContaining({ mindmap_branch: true, quiz_question: false }),
          mix_mode: 'mindmap_only',
        }),
      }),
    )
    const saved = vi.mocked(clientPreferencesApi.updateClientPreferencesApi).mock.calls
      .map(([payload]) => payload.freestyle_feed_config)
      .find(Boolean)
    expect(saved).not.toHaveProperty('node_limit')
    expect(window.localStorage.getItem(FREESTYLE_FEED_CONFIG_STORAGE_KEY)).toBeNull()
  })

})
