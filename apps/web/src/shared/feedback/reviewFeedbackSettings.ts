import {
  getClientPreferenceCacheStatus,
  hasLoadedClientPreferences,
  saveClientPreference,
} from '@/shared/preferences/clientPreferences'
export type { CelebrationPreset } from '@/shared/feedback/celebrationEngine'
import type { CelebrationPreset } from '@/shared/feedback/celebrationEngine'

export type FeedbackVisualStyle = 'warm_playful' | 'focus_light'
export type FeedbackPreset = 'focus' | 'balanced' | 'motivating'

/**
 * 反馈场景键。四个场景分别对应：
 * - review     普通复习 / 翻卡
 * - milestone  连击 / 里程碑
 * - completion 完成结算
 * - timer      计时器达标
 * - quiz       做题结果
 */
export type FeedbackSceneKey = 'review' | 'milestone' | 'completion' | 'timer' | 'quiz'

/**
 * 五种烟花类型（点击即预览）。顺序与中文标签一一对应：
 * 庆祝 · 爆发 · 写实 · 星爆 · 庆典。
 * 视觉强度由类型本身内置（庆典 > 爆发 > 星爆 > 写实 > 庆祝）。
 */
export const FEEDBACK_CONFETTI_PRESETS: CelebrationPreset[] = [
  'random_direction',
  'fireworks',
  'realistic_look',
  'stars',
  'school_pride',
]

export const FEEDBACK_CONFETTI_PRESET_LABELS: Record<CelebrationPreset, string> = {
  random_direction: '庆祝',
  fireworks: '爆发',
  realistic_look: '写实',
  stars: '星爆',
  school_pride: '庆典',
}

export interface ReviewCelebrationEventSettings {
  enabled: boolean
  cooldownMs: number
  confettiAmount: number
  soundEnabled: boolean
  animationEnabled: boolean
}

export interface ReviewMilestoneCelebrationSettings extends ReviewCelebrationEventSettings {
  steps: number[]
}

export interface ReviewSessionCompleteCelebrationSettings {
  enabled: boolean
  confettiAmount: number
  soundEnabled: boolean
  animationEnabled: boolean
}

export interface ReviewCelebrationSettings {
  globalCooldownMs: number
  milestone: ReviewMilestoneCelebrationSettings
  branchClear: ReviewCelebrationEventSettings
  allClearReady: ReviewCelebrationEventSettings
  sessionComplete: ReviewSessionCompleteCelebrationSettings
}

export interface ReviewFeedbackSceneSettings {
  enabled: boolean
  soundEnabled: boolean
  animationEnabled: boolean
  confettiAmount: number
  cooldownMs: number
  /**
   * 烟花效果的具体形式（庆祝 / 爆发 / 写实 / 星爆 / 庆典）。
   * 缺省时由 reviewConfetti 按场景 kind 推导，保持向后兼容。
   */
  confettiPreset?: CelebrationPreset
  /**
   * 该场景相对全局基础音量的增强系数（0~3，1.0 = 与全局一致）。
   * 最终音量 = 全局有效音量 × 场景 volumeBoost。
   */
  volumeBoost?: number
}

export interface ReviewMilestoneSceneSettings extends ReviewFeedbackSceneSettings {
  steps: number[]
}

export interface ReviewFeedbackScenesSettings {
  review: ReviewFeedbackSceneSettings
  milestone: ReviewMilestoneSceneSettings
  completion: ReviewFeedbackSceneSettings
  timer: ReviewFeedbackSceneSettings
  quiz: ReviewFeedbackSceneSettings
}

export interface ReviewFeedbackSettings {
  schemaVersion: 3
  preset: FeedbackPreset
  mode: 'immersive' | 'quiet'
  visualStyle: FeedbackVisualStyle
  soundEnabled: boolean
  volume: number
  baseVolumeMultiplier: number
  confettiAmount: number
  animationEnabled: boolean
  reducedCelebrationMotion: boolean
  surpriseEnabled: boolean
  soundTheme: 'classic'
  globalIntensity: 'quiet' | 'balanced' | 'immersive'
  desktopNotificationsEnabled: boolean
  learningSoundsEnabled: boolean
  milestoneEffectsEnabled: boolean
  completionEffectsEnabled: boolean
  scenes: ReviewFeedbackScenesSettings
  celebration: ReviewCelebrationSettings
}

export const REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY = 'memory-anki-review-feedback-settings-v2'
export const REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT = 'memory-anki-review-feedback-settings-change'

export const DEFAULT_REVIEW_MILESTONE_STEPS = [4, 8, 12, 20]
export const REVIEW_FEEDBACK_VOLUME_MAX = 2
export const REVIEW_FEEDBACK_BASE_VOLUME_MULTIPLIER_MIN = 1
export const REVIEW_FEEDBACK_BASE_VOLUME_MULTIPLIER_MAX = 8
export const REVIEW_FEEDBACK_EFFECTIVE_VOLUME_MAX =
  REVIEW_FEEDBACK_VOLUME_MAX * REVIEW_FEEDBACK_BASE_VOLUME_MULTIPLIER_MAX

const DEFAULT_REVIEW_SCENE: Omit<ReviewFeedbackSceneSettings, never> = {
  enabled: true,
  soundEnabled: true,
  animationEnabled: true,
  confettiAmount: 1,
  cooldownMs: 1500,
  confettiPreset: 'realistic_look',
  volumeBoost: 1,
}

const DEFAULT_SCENE_CONFETTI_PRESETS: Record<FeedbackSceneKey, CelebrationPreset> = {
  review: 'random_direction',
  milestone: 'fireworks',
  completion: 'stars',
  timer: 'school_pride',
  quiz: 'random_direction',
}

const DEFAULT_SCENE_VOLUME_BOOSTS: Record<FeedbackSceneKey, number> = {
  review: 1,
  milestone: 1.1,
  completion: 1.25,
  timer: 1.35,
  quiz: 1.05,
}

function buildLegacyCelebrationFromScenes(scenes: ReviewFeedbackScenesSettings): ReviewCelebrationSettings {
  return {
    globalCooldownMs: Math.max(scenes.milestone.cooldownMs, scenes.completion.cooldownMs),
    milestone: {
      enabled: scenes.milestone.enabled,
      steps: scenes.milestone.steps,
      cooldownMs: scenes.milestone.cooldownMs,
      confettiAmount: scenes.milestone.confettiAmount,
      soundEnabled: scenes.milestone.soundEnabled,
      animationEnabled: scenes.milestone.animationEnabled,
    },
    branchClear: {
      enabled: scenes.review.enabled,
      cooldownMs: scenes.review.cooldownMs,
      confettiAmount: Math.max(0.35, scenes.review.confettiAmount),
      soundEnabled: scenes.review.soundEnabled,
      animationEnabled: scenes.review.animationEnabled,
    },
    allClearReady: {
      enabled: scenes.completion.enabled,
      cooldownMs: scenes.completion.cooldownMs,
      confettiAmount: scenes.completion.confettiAmount,
      soundEnabled: scenes.completion.soundEnabled,
      animationEnabled: scenes.completion.animationEnabled,
    },
    sessionComplete: {
      enabled: scenes.completion.enabled,
      confettiAmount: scenes.completion.confettiAmount,
      soundEnabled: scenes.completion.soundEnabled,
      animationEnabled: scenes.completion.animationEnabled,
    },
  }
}

export const DEFAULT_REVIEW_FEEDBACK_SETTINGS: ReviewFeedbackSettings = {
  schemaVersion: 3,
  preset: 'balanced',
  mode: 'immersive',
  visualStyle: 'warm_playful',
  soundEnabled: true,
  volume: 1.15,
  baseVolumeMultiplier: 1,
  confettiAmount: 1.25,
  animationEnabled: true,
  reducedCelebrationMotion: false,
  surpriseEnabled: true,
  soundTheme: 'classic',
  globalIntensity: 'balanced',
  desktopNotificationsEnabled: false,
  learningSoundsEnabled: true,
  milestoneEffectsEnabled: true,
  completionEffectsEnabled: true,
  scenes: {
    review: {
      ...DEFAULT_REVIEW_SCENE,
      confettiAmount: 0.55,
      cooldownMs: 900,
    },
    milestone: {
      ...DEFAULT_REVIEW_SCENE,
      confettiAmount: 1.15,
      cooldownMs: 8000,
      steps: DEFAULT_REVIEW_MILESTONE_STEPS,
    },
    completion: {
      ...DEFAULT_REVIEW_SCENE,
      confettiAmount: 1.6,
      cooldownMs: 12000,
    },
    timer: {
      ...DEFAULT_REVIEW_SCENE,
      confettiAmount: 2.2,
      cooldownMs: 12000,
    },
    quiz: {
      ...DEFAULT_REVIEW_SCENE,
      confettiAmount: 0.8,
      cooldownMs: 900,
      confettiPreset: DEFAULT_SCENE_CONFETTI_PRESETS.quiz,
      volumeBoost: DEFAULT_SCENE_VOLUME_BOOSTS.quiz,
    },
  },
  celebration: undefined as never,
}

DEFAULT_REVIEW_FEEDBACK_SETTINGS.celebration = buildLegacyCelebrationFromScenes(
  DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes,
)

function sanitizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function sanitizeNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, parsed))
}

function sanitizeInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  return Math.round(sanitizeNumber(value, fallback, minimum, maximum))
}

function sanitizeSteps(value: unknown, fallback: number[]) {
  if (!Array.isArray(value)) return fallback
  const deduped = Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
        .map((item) => Math.round(item)),
    ),
  ).sort((a, b) => a - b)
  return deduped.length > 0 ? deduped : fallback
}

function sanitizeConfettiPreset(value: unknown, fallback?: CelebrationPreset): CelebrationPreset | undefined {
  if (value === 'random_direction' || value === 'realistic_look' || value === 'fireworks' || value === 'stars' || value === 'school_pride') {
    return value
  }
  return fallback
}

function sanitizeSceneSettings(
  value: unknown,
  fallback: ReviewFeedbackSceneSettings,
  inheritedSoundEnabled: boolean,
  inheritedAnimationEnabled: boolean,
): ReviewFeedbackSceneSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    enabled: sanitizeBoolean(raw.enabled, fallback.enabled),
    soundEnabled: sanitizeBoolean(raw.soundEnabled, inheritedSoundEnabled),
    animationEnabled: sanitizeBoolean(raw.animationEnabled, inheritedAnimationEnabled),
    confettiAmount: sanitizeNumber(raw.confettiAmount, fallback.confettiAmount, 0, 3),
    cooldownMs: sanitizeInteger(raw.cooldownMs, fallback.cooldownMs, 0, 120_000),
    confettiPreset: sanitizeConfettiPreset(raw.confettiPreset, fallback.confettiPreset),
    volumeBoost: sanitizeNumber(raw.volumeBoost, fallback.volumeBoost ?? 1, 0, 3),
  }
}

function sanitizeMilestoneSceneSettings(
  value: unknown,
  fallback: ReviewMilestoneSceneSettings,
  inheritedSoundEnabled: boolean,
  inheritedAnimationEnabled: boolean,
): ReviewMilestoneSceneSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const base = sanitizeSceneSettings(raw, fallback, inheritedSoundEnabled, inheritedAnimationEnabled)
  return {
    ...base,
    steps: sanitizeSteps(raw.steps, fallback.steps),
  }
}

function readLegacyCelebrationScenes(raw: Record<string, unknown>): ReviewFeedbackScenesSettings {
  const celebration = raw.celebration && typeof raw.celebration === 'object'
    ? (raw.celebration as Record<string, unknown>)
    : {}
  const milestone = celebration.milestone && typeof celebration.milestone === 'object'
    ? (celebration.milestone as Record<string, unknown>)
    : {}
  const branchClear = celebration.branchClear && typeof celebration.branchClear === 'object'
    ? (celebration.branchClear as Record<string, unknown>)
    : {}
  const allClearReady = celebration.allClearReady && typeof celebration.allClearReady === 'object'
    ? (celebration.allClearReady as Record<string, unknown>)
    : {}
  const sessionComplete = celebration.sessionComplete && typeof celebration.sessionComplete === 'object'
    ? (celebration.sessionComplete as Record<string, unknown>)
    : {}

  return {
    review: {
      enabled: sanitizeBoolean(branchClear.enabled, true),
      soundEnabled: sanitizeBoolean(branchClear.soundEnabled, sanitizeBoolean(raw.soundEnabled, true)),
      animationEnabled: sanitizeBoolean(branchClear.animationEnabled, sanitizeBoolean(raw.animationEnabled, true)),
      confettiAmount: sanitizeNumber(branchClear.confettiAmount, 0.55, 0, 3),
      cooldownMs: sanitizeInteger(branchClear.cooldownMs, 900, 0, 120_000),
      confettiPreset: DEFAULT_SCENE_CONFETTI_PRESETS.review,
      volumeBoost: DEFAULT_SCENE_VOLUME_BOOSTS.review,
    },
    milestone: {
      enabled: sanitizeBoolean(milestone.enabled, true),
      soundEnabled: sanitizeBoolean(milestone.soundEnabled, sanitizeBoolean(raw.soundEnabled, true)),
      animationEnabled: sanitizeBoolean(milestone.animationEnabled, sanitizeBoolean(raw.animationEnabled, true)),
      confettiAmount: sanitizeNumber(milestone.confettiAmount, sanitizeNumber(raw.confettiAmount, 1.15, 0, 3), 0, 3),
      cooldownMs: sanitizeInteger(milestone.cooldownMs, 8000, 0, 120_000),
      steps: sanitizeSteps(milestone.steps, DEFAULT_REVIEW_MILESTONE_STEPS),
      confettiPreset: DEFAULT_SCENE_CONFETTI_PRESETS.milestone,
      volumeBoost: DEFAULT_SCENE_VOLUME_BOOSTS.milestone,
    },
    completion: {
      enabled: sanitizeBoolean(sessionComplete.enabled, true),
      soundEnabled: sanitizeBoolean(sessionComplete.soundEnabled, sanitizeBoolean(raw.soundEnabled, true)),
      animationEnabled: sanitizeBoolean(sessionComplete.animationEnabled, sanitizeBoolean(raw.animationEnabled, true)),
      confettiAmount: sanitizeNumber(
        sessionComplete.confettiAmount,
        sanitizeNumber(allClearReady.confettiAmount, sanitizeNumber(raw.confettiAmount, 1.6, 0, 3), 0, 3),
        0,
        3,
      ),
      cooldownMs: sanitizeInteger(celebration.globalCooldownMs, 12000, 0, 120_000),
      confettiPreset: DEFAULT_SCENE_CONFETTI_PRESETS.completion,
      volumeBoost: DEFAULT_SCENE_VOLUME_BOOSTS.completion,
    },
    timer: {
      ...DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes.timer,
    },
    quiz: {
      ...DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes.quiz,
    },
  }
}

export function sanitizeReviewFeedbackSettings(value: unknown): ReviewFeedbackSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const preset: FeedbackPreset =
    raw.preset === 'focus' || raw.preset === 'motivating' || raw.preset === 'balanced'
      ? raw.preset
      : raw.globalIntensity === 'quiet'
        ? 'focus'
        : raw.globalIntensity === 'immersive'
          ? 'motivating'
          : 'balanced'
  const mode = raw.mode === 'quiet' ? 'quiet' : 'immersive'
  const globalIntensity =
    raw.globalIntensity === 'quiet' || raw.globalIntensity === 'balanced' || raw.globalIntensity === 'immersive'
      ? raw.globalIntensity
      : DEFAULT_REVIEW_FEEDBACK_SETTINGS.globalIntensity
  const visualStyle = raw.visualStyle === 'focus_light' ? 'focus_light' : DEFAULT_REVIEW_FEEDBACK_SETTINGS.visualStyle
  const soundEnabled = sanitizeBoolean(raw.soundEnabled, DEFAULT_REVIEW_FEEDBACK_SETTINGS.soundEnabled)
  const animationEnabled = sanitizeBoolean(raw.animationEnabled, DEFAULT_REVIEW_FEEDBACK_SETTINGS.animationEnabled)
  const fallbackScenes = readLegacyCelebrationScenes(raw)
  const scenesRaw = raw.scenes && typeof raw.scenes === 'object' ? (raw.scenes as Record<string, unknown>) : {}
  const scenes: ReviewFeedbackScenesSettings = {
    review: sanitizeSceneSettings(scenesRaw.review, fallbackScenes.review, soundEnabled, animationEnabled),
    milestone: sanitizeMilestoneSceneSettings(scenesRaw.milestone, fallbackScenes.milestone, soundEnabled, animationEnabled),
    completion: sanitizeSceneSettings(scenesRaw.completion, fallbackScenes.completion, soundEnabled, animationEnabled),
    timer: sanitizeSceneSettings(scenesRaw.timer, fallbackScenes.timer, soundEnabled, animationEnabled),
    quiz: sanitizeSceneSettings(scenesRaw.quiz, fallbackScenes.quiz, soundEnabled, animationEnabled),
  }

  return {
    schemaVersion: 3,
    preset,
    mode,
    visualStyle,
    soundEnabled,
    volume: sanitizeNumber(raw.volume, DEFAULT_REVIEW_FEEDBACK_SETTINGS.volume, 0, REVIEW_FEEDBACK_VOLUME_MAX),
    baseVolumeMultiplier: sanitizeNumber(
      raw.baseVolumeMultiplier,
      DEFAULT_REVIEW_FEEDBACK_SETTINGS.baseVolumeMultiplier,
      REVIEW_FEEDBACK_BASE_VOLUME_MULTIPLIER_MIN,
      REVIEW_FEEDBACK_BASE_VOLUME_MULTIPLIER_MAX,
    ),
    confettiAmount: sanitizeNumber(
      raw.confettiAmount,
      Math.max(scenes.review.confettiAmount, scenes.milestone.confettiAmount),
      0,
      3,
    ),
    animationEnabled,
    reducedCelebrationMotion: sanitizeBoolean(raw.reducedCelebrationMotion, false),
    surpriseEnabled: sanitizeBoolean(raw.surpriseEnabled, DEFAULT_REVIEW_FEEDBACK_SETTINGS.surpriseEnabled),
    soundTheme: 'classic',
    globalIntensity,
    desktopNotificationsEnabled: sanitizeBoolean(raw.desktopNotificationsEnabled, false),
    learningSoundsEnabled: sanitizeBoolean(raw.learningSoundsEnabled, true),
    milestoneEffectsEnabled: sanitizeBoolean(raw.milestoneEffectsEnabled, true),
    completionEffectsEnabled: sanitizeBoolean(raw.completionEffectsEnabled, true),
    scenes,
    celebration: buildLegacyCelebrationFromScenes(scenes),
  }
}

export function getReviewFeedbackEffectiveVolume(
  settings: Pick<ReviewFeedbackSettings, 'volume' | 'baseVolumeMultiplier'>,
) {
  const combined = settings.volume * settings.baseVolumeMultiplier
  if (!Number.isFinite(combined)) return DEFAULT_REVIEW_FEEDBACK_SETTINGS.volume
  return Math.max(0, Math.min(REVIEW_FEEDBACK_EFFECTIVE_VOLUME_MAX, combined))
}

export function applyFeedbackPreset(
  settings: ReviewFeedbackSettings,
  preset: FeedbackPreset,
): ReviewFeedbackSettings {
  const focus = preset === 'focus'
  const motivating = preset === 'motivating'
  const soundEnabled = settings.soundEnabled
  const animationEnabled = settings.animationEnabled
  const scenes: ReviewFeedbackScenesSettings = {
    ...settings.scenes,
    review: {
      ...settings.scenes.review,
      enabled: !focus,
      soundEnabled: soundEnabled && !focus,
      animationEnabled,
      confettiAmount: motivating ? 0.7 : 0.45,
    },
    milestone: {
      ...settings.scenes.milestone,
      enabled: !focus,
      soundEnabled: soundEnabled && !focus,
      animationEnabled: animationEnabled && !focus,
      confettiAmount: motivating ? 1.25 : 0.8,
    },
    completion: {
      ...settings.scenes.completion,
      enabled: true,
      soundEnabled,
      animationEnabled,
      confettiAmount: focus ? 0.65 : motivating ? 1.65 : 1.1,
    },
    quiz: {
      ...settings.scenes.quiz,
      enabled: true,
      soundEnabled: soundEnabled && !focus,
      animationEnabled,
      confettiAmount: 0,
    },
    // Timer event details remain authoritative in timer_focus_config. This
    // legacy scene is kept only so existing stored payloads still sanitize.
    timer: { ...settings.scenes.timer },
  }

  return {
    ...settings,
    schemaVersion: 3,
    preset,
    mode: 'immersive',
    globalIntensity: preset === 'focus' ? 'quiet' : preset === 'motivating' ? 'immersive' : 'balanced',
    learningSoundsEnabled: !focus,
    milestoneEffectsEnabled: !focus,
    completionEffectsEnabled: true,
    scenes,
    celebration: buildLegacyCelebrationFromScenes(scenes),
  }
}

/**
 * 某个反馈场景的最终有效音量 = 全局有效音量 × 该场景的 volumeBoost。
 * 用于"每个提示单独设置音量"——解决部分场景声音过小的问题。
 */
export function getSceneEffectiveVolume(
  settings: ReviewFeedbackSettings,
  sceneKey: FeedbackSceneKey,
) {
  const global = getReviewFeedbackEffectiveVolume(settings)
  const scene = settings.scenes[sceneKey]
  const boost = scene?.volumeBoost ?? 1
  const combined = global * boost
  if (!Number.isFinite(combined)) return global
  return Math.max(0, Math.min(REVIEW_FEEDBACK_EFFECTIVE_VOLUME_MAX, combined))
}

export function readReviewFeedbackSettings() {
  const cached = getClientPreferenceCacheStatus(
    'review_feedback_settings',
    (value): value is ReviewFeedbackSettings => Boolean(value && typeof value === 'object'),
  )
  if (cached.value) return sanitizeReviewFeedbackSettings(cached.value)
  if (cached.hasEntry || hasLoadedClientPreferences()) return DEFAULT_REVIEW_FEEDBACK_SETTINGS

  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY)
      if (raw) return sanitizeReviewFeedbackSettings(JSON.parse(raw))
      const legacy = window.localStorage.getItem('memory-anki-review-feedback-settings-v1')
      if (legacy) return sanitizeReviewFeedbackSettings(JSON.parse(legacy))
    } catch {
      return DEFAULT_REVIEW_FEEDBACK_SETTINGS
    }
  }

  return DEFAULT_REVIEW_FEEDBACK_SETTINGS
}

function dispatchReviewFeedbackSettingsChange(settings: ReviewFeedbackSettings) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT, {
      detail: settings,
    }),
  )
}

export function writeReviewFeedbackSettings(settings: ReviewFeedbackSettings) {
  const sanitized = sanitizeReviewFeedbackSettings(settings)
  dispatchReviewFeedbackSettingsChange(sanitized)
  void saveClientPreference('review_feedback_settings', sanitized).then((saved) => {
    dispatchReviewFeedbackSettingsChange(sanitizeReviewFeedbackSettings(saved.value))
  })
  return sanitized
}
