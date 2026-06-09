import {
  getCachedClientPreference,
  setClientPreference,
} from '@/shared/preferences/clientPreferences'

export interface VoiceCoachSettings {
  enabled: boolean
  volume: number
  scenes: {
    review: boolean
    practice: boolean
    edit: boolean
  }
  idleNudgeSeconds: number
  editIdleNudgeSeconds: number
  cooldownSeconds: number
  milestoneEnabled: boolean
  completionEnabled: boolean
}

export const VOICE_COACH_SETTINGS_STORAGE_KEY = 'memory-anki-voice-coach-settings-v1'
export const VOICE_COACH_SETTINGS_UPDATED_EVENT = 'memory-anki-voice-coach-settings-change'

export const DEFAULT_VOICE_COACH_SETTINGS: VoiceCoachSettings = {
  enabled: false,
  volume: 0.75,
  scenes: {
    review: true,
    practice: true,
    edit: true,
  },
  idleNudgeSeconds: 75,
  editIdleNudgeSeconds: 120,
  cooldownSeconds: 180,
  milestoneEnabled: true,
  completionEnabled: true,
}

function sanitizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function sanitizeNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, parsed))
}

export function sanitizeVoiceCoachSettings(value: unknown): VoiceCoachSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const rawScenes =
    raw.scenes && typeof raw.scenes === 'object'
      ? (raw.scenes as Record<string, unknown>)
      : {}
  return {
    enabled: sanitizeBoolean(raw.enabled, DEFAULT_VOICE_COACH_SETTINGS.enabled),
    volume: sanitizeNumber(raw.volume, DEFAULT_VOICE_COACH_SETTINGS.volume, 0, 1),
    scenes: {
      review: sanitizeBoolean(rawScenes.review, DEFAULT_VOICE_COACH_SETTINGS.scenes.review),
      practice: sanitizeBoolean(rawScenes.practice, DEFAULT_VOICE_COACH_SETTINGS.scenes.practice),
      edit: sanitizeBoolean(rawScenes.edit, DEFAULT_VOICE_COACH_SETTINGS.scenes.edit),
    },
    idleNudgeSeconds: Math.round(
      sanitizeNumber(
        raw.idleNudgeSeconds,
        DEFAULT_VOICE_COACH_SETTINGS.idleNudgeSeconds,
        15,
        600,
      ),
    ),
    editIdleNudgeSeconds: Math.round(
      sanitizeNumber(
        raw.editIdleNudgeSeconds,
        DEFAULT_VOICE_COACH_SETTINGS.editIdleNudgeSeconds,
        15,
        900,
      ),
    ),
    cooldownSeconds: Math.round(
      sanitizeNumber(
        raw.cooldownSeconds,
        DEFAULT_VOICE_COACH_SETTINGS.cooldownSeconds,
        30,
        1800,
      ),
    ),
    milestoneEnabled: sanitizeBoolean(
      raw.milestoneEnabled,
      DEFAULT_VOICE_COACH_SETTINGS.milestoneEnabled,
    ),
    completionEnabled: sanitizeBoolean(
      raw.completionEnabled,
      DEFAULT_VOICE_COACH_SETTINGS.completionEnabled,
    ),
  }
}

export function readVoiceCoachSettings() {
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(VOICE_COACH_SETTINGS_STORAGE_KEY)
      if (raw) return sanitizeVoiceCoachSettings(JSON.parse(raw))
    } catch {
      return DEFAULT_VOICE_COACH_SETTINGS
    }
  }

  const cached = getCachedClientPreference(
    'voice_coach_settings',
    DEFAULT_VOICE_COACH_SETTINGS,
    (value): value is VoiceCoachSettings => Boolean(value && typeof value === 'object'),
  )
  return cached !== DEFAULT_VOICE_COACH_SETTINGS
    ? sanitizeVoiceCoachSettings(cached)
    : DEFAULT_VOICE_COACH_SETTINGS
}

export function writeVoiceCoachSettings(settings: VoiceCoachSettings) {
  const sanitized = sanitizeVoiceCoachSettings(settings)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(VOICE_COACH_SETTINGS_STORAGE_KEY, JSON.stringify(sanitized))
    void setClientPreference('voice_coach_settings', sanitized).then((saved) => {
      window.dispatchEvent(
        new CustomEvent(VOICE_COACH_SETTINGS_UPDATED_EVENT, {
          detail: saved,
        }),
      )
    })
  }
  return sanitized
}
