import { toast as sonnerToast, type ExternalToast } from 'sonner'
import type {
  MindMapFeedbackEvent,
  MindMapFeedbackOrigin,
} from '@/shared/components/mindmap-host/hostBridgeUtils'
import {
  playWebAudioComboMilestone,
  playWebAudioFeedbackEvent,
  playWebAudioFireworkAccent,
} from '@/shared/components/mindmap-host/webAudioFeedback'
import {
  REVIEW_FEEDBACK_EFFECTIVE_VOLUME_MAX,
  getReviewFeedbackEffectiveVolume,
  readReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'
import { dispatchGlobalFeedback } from './globalFeedbackModel'
import {
  launchCelebrationPreset,
  type CelebrationScenario,
  type CelebrationPreset,
} from './celebrationEngine'

export type FeedbackScenario =
  | MindMapFeedbackEvent
  | 'timer_secondary_complete'
  | 'timer_primary_complete'
  | 'review_milestone'
  | 'review_branch_clear'
  | 'review_all_clear_ready'
  | 'review_complete'

export type FeedbackToastKind = 'success' | 'error' | 'info' | 'warning' | 'message'

interface FeedbackAudioRequest {
  audioScope?: 'local' | 'global'
  event?: MindMapFeedbackEvent
  milestoneStep?: number | null
  origin?: MindMapFeedbackOrigin
  surprise?: boolean
  volume?: number
}

interface CelebrationAudioCue {
  kind: 'milestone' | 'branch_clear' | 'all_clear_ready' | 'session_complete'
  milestoneStep?: number | null
}

export interface TriggerCelebrationRequest {
  amount?: number
  animationEnabled?: boolean
  audioCue?: CelebrationAudioCue
  durationMs?: number
  preset: CelebrationPreset
  reducedMotion: boolean
  scenario?: CelebrationScenario
  soundEnabled?: boolean
  volume?: number
}

interface FeedbackVisualRequest {
  event: MindMapFeedbackEvent
  label?: string
  level?: 'micro' | 'action' | 'milestone'
  origin?: MindMapFeedbackOrigin
  point?: {
    x: number
    y: number
  }
  screenPulse?: 'soft' | 'navigation' | 'celebration' | null
}

export interface FeedbackRequest {
  scenario: FeedbackScenario
  celebration?: TriggerCelebrationRequest | boolean
  celebrationPreset?: CelebrationPreset | null
  description?: string
  message?: string
  reducedMotion?: boolean
  soundEnabled?: boolean
  toastKind?: FeedbackToastKind | null
  toastOptions?: ExternalToast
  audio?: FeedbackAudioRequest | boolean
  visual?: FeedbackVisualRequest | boolean
  volume?: number
}

function clampVolume(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.min(REVIEW_FEEDBACK_EFFECTIVE_VOLUME_MAX, value))
}

function getFeedbackSettings() {
  if (typeof window === 'undefined') {
    return {
      animationEnabled: true,
      mode: 'immersive' as const,
      soundEnabled: true,
      learningSoundsEnabled: true,
      milestoneEffectsEnabled: true,
      completionEffectsEnabled: true,
      volume: 1,
    }
  }
  const settings = readReviewFeedbackSettings()
  return {
    animationEnabled: settings.animationEnabled,
    mode: settings.mode,
    soundEnabled: settings.soundEnabled,
    learningSoundsEnabled: settings.learningSoundsEnabled !== false,
    milestoneEffectsEnabled: settings.milestoneEffectsEnabled !== false,
    completionEffectsEnabled: settings.completionEffectsEnabled !== false,
    volume: getReviewFeedbackEffectiveVolume(settings),
  }
}

export function showToast(
  kind: FeedbackToastKind,
  message: string,
  options?: ExternalToast,
) {
  if (kind === 'success') return sonnerToast.success(message, options)
  if (kind === 'error') return sonnerToast.error(message, options)
  if (kind === 'info') return sonnerToast.info(message, options)
  if (kind === 'warning') return sonnerToast.warning(message, options)
  return sonnerToast.message(message, options)
}

export function playFeedbackAudio(request: FeedbackAudioRequest) {
  const settings = getFeedbackSettings()
  const soundEnabled = settings.soundEnabled && settings.mode === 'immersive'
  const volume = clampVolume(request.volume ?? settings.volume)
  if (!soundEnabled || volume <= 0) return
  if (
    request.event &&
    (request.event === 'quiz_result_correct' ||
      request.event === 'quiz_result_incorrect' ||
      request.event === 'card_reveal') &&
    !settings.learningSoundsEnabled
  ) {
    return
  }

  if (typeof request.milestoneStep === 'number') {
    playWebAudioComboMilestone({
      milestoneStep: request.milestoneStep,
      volume,
    })
    return
  }

  if (!request.event) return
  playWebAudioFeedbackEvent({
    event: request.event,
    surprise: request.surprise,
    origin: request.origin,
    audioScope: request.audioScope,
    volume,
  })
}

export function emitVisualFeedback(request: FeedbackVisualRequest) {
  dispatchGlobalFeedback(request.event, {
    label: request.label,
    level: request.level,
    origin: request.origin,
    point: request.point,
    screenPulse: request.screenPulse,
  })
}

export function triggerCelebration(request: TriggerCelebrationRequest) {
  const settings = getFeedbackSettings()
  const milestoneScenario = request.scenario === 'milestone' || request.scenario === 'review'
  const completionScenario = request.scenario === 'completion'
  const animationEnabled =
    (request.animationEnabled ?? true) &&
    settings.animationEnabled &&
    settings.mode === 'immersive' &&
    (!milestoneScenario || settings.milestoneEffectsEnabled) &&
    (!completionScenario || settings.completionEffectsEnabled)
  const soundEnabled =
    (request.soundEnabled ?? settings.soundEnabled) && settings.mode === 'immersive'
  const volume = clampVolume(request.volume ?? settings.volume)

  if (animationEnabled) {
    launchCelebrationPreset({
      preset: request.preset,
      reducedMotion: request.reducedMotion,
      amount: request.amount,
      durationMs: request.durationMs,
      scenario: request.scenario,
    })
  }

  if (!soundEnabled || volume <= 0 || !request.audioCue) return
  playWebAudioFireworkAccent({
    kind: request.audioCue.kind,
    milestoneStep: request.audioCue.milestoneStep ?? 0,
    volume,
  })
}

export function notifyFeedback(request: FeedbackRequest) {
  if (request.toastKind && request.message) {
    showToast(request.toastKind, request.message, {
      ...request.toastOptions,
      description: request.description ?? request.toastOptions?.description,
    })
  }

  if (request.audio && request.audio !== true) {
    playFeedbackAudio({
      ...request.audio,
      volume: request.volume ?? request.audio.volume,
    })
  }

  if (request.visual && request.visual !== true) {
    emitVisualFeedback(request.visual)
  }

  const preset =
    request.celebration !== false
      ? typeof request.celebration === 'object'
        ? request.celebration.preset
        : request.celebrationPreset
      : null
  if (!preset) return

  const celebrationRequest =
    typeof request.celebration === 'object'
      ? request.celebration
      : {
          preset,
          reducedMotion: request.reducedMotion ?? false,
          soundEnabled: request.soundEnabled,
          volume: request.volume,
        }

  triggerCelebration(celebrationRequest)
}
