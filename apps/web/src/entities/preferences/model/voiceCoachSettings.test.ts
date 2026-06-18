import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_VOICE_COACH_SETTINGS,
  readVoiceCoachSettings,
  sanitizeVoiceCoachSettings,
  VOICE_COACH_SETTINGS_STORAGE_KEY,
  writeVoiceCoachSettings,
} from '@/entities/preferences/model/voiceCoachSettings'

describe('voiceCoachSettings', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns defaults when storage is empty', () => {
    expect(readVoiceCoachSettings()).toEqual(DEFAULT_VOICE_COACH_SETTINGS)
  })

  it('writes sanitized settings without keeping localStorage as a second authority', () => {
    const saved = writeVoiceCoachSettings({
      ...DEFAULT_VOICE_COACH_SETTINGS,
      enabled: true,
      volume: 2,
      scenes: {
        review: true,
        practice: false,
        edit: true,
      },
    })

    expect(saved.enabled).toBe(true)
    expect(saved.volume).toBe(1)
    expect(saved.scenes.practice).toBe(false)
    expect(window.localStorage.getItem(VOICE_COACH_SETTINGS_STORAGE_KEY)).toBeNull()
  })

  it('falls back to defaults and clamps invalid numeric values', () => {
    const sanitized = sanitizeVoiceCoachSettings({
      enabled: 'yes',
      volume: -1,
      scenes: {
        review: 'true',
        practice: false,
      },
      idleNudgeSeconds: 5,
      editIdleNudgeSeconds: 9999,
      cooldownSeconds: Number.NaN,
      milestoneEnabled: false,
      completionEnabled: 'no',
    })

    expect(sanitized.enabled).toBe(false)
    expect(sanitized.volume).toBe(0)
    expect(sanitized.scenes.review).toBe(true)
    expect(sanitized.scenes.practice).toBe(false)
    expect(sanitized.scenes.edit).toBe(true)
    expect(sanitized.idleNudgeSeconds).toBe(15)
    expect(sanitized.editIdleNudgeSeconds).toBe(900)
    expect(sanitized.cooldownSeconds).toBe(DEFAULT_VOICE_COACH_SETTINGS.cooldownSeconds)
    expect(sanitized.milestoneEnabled).toBe(false)
    expect(sanitized.completionEnabled).toBe(true)
  })
})
