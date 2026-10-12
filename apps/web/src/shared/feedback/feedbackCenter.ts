import { toast as sonnerToast, type ExternalToast } from 'sonner'
import type {
  MindMapFeedbackEvent,
  MindMapFeedbackOrigin,
} from '@/shared/feedback/feedbackEvents'
import {
  playWebAudioComboMilestone,
  playWebAudioFeedbackEvent,
  playWebAudioFireworkAccent,
} from '@/shared/feedback/mindmap-audio/webAudioFeedback'
import {
  REVIEW_FEEDBACK_EFFECTIVE_VOLUME_MAX,
  getReviewFeedbackEffectiveVolume,
  readReviewFeedbackSettings,
  resolveFeedbackChannels,
} from '@/shared/feedback/reviewFeedbackSettings'
import { dispatchGlobalFeedback } from './globalFeedbackModel'
import { playUiSound } from './uiSounds'

export type CelebrationScenario = 'milestone' | 'review' | 'completion' | 'quiz'

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
  audioCue?: CelebrationAudioCue
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

function clampVolume(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.min(REVIEW_FEEDBACK_EFFECTIVE_VOLUME_MAX, value))
}

function getFeedbackSettings() {
  if (typeof window === 'undefined') {
    return {
      animationEnabled: true,
      soundEnabled: true,
      learningSoundsEnabled: true,
      milestoneEffectsEnabled: true,
      completionEffectsEnabled: true,
      volume: 1,
    }
  }
  const settings = readReviewFeedbackSettings()
  // The three channels are tri-state: resolve preset defaults here so callers
  // keep working with plain booleans.
  const channels = resolveFeedbackChannels(settings)
  return {
    animationEnabled: settings.animationEnabled,
    soundEnabled: settings.soundEnabled,
    learningSoundsEnabled: channels.learningSounds,
    milestoneEffectsEnabled: channels.milestoneEffects,
    completionEffectsEnabled: channels.completionEffects,
    volume: getReviewFeedbackEffectiveVolume(settings),
  }
}

export function showToast(
  kind: FeedbackToastKind,
  message: string,
  options?: ExternalToast,
) {
  if (kind === 'success') {
    playUiSound('chime')
    return sonnerToast.success(message, options)
  }
  if (kind === 'error') {
    playUiSound('thud')
    return sonnerToast.error(message, options)
  }
  if (kind === 'info') return sonnerToast.info(message, options)
  if (kind === 'warning') return sonnerToast.warning(message, options)
  return sonnerToast.message(message, options)
}

export function playFeedbackAudio(request: FeedbackAudioRequest) {
  const settings = getFeedbackSettings()
  const soundEnabled = settings.soundEnabled
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

/** 庆祝动效（果冻 CSS）是否应当播放；声音与动效各自独立开关。 */
export function isCelebrationAnimationEnabled(scenario?: CelebrationScenario) {
  const settings = getFeedbackSettings()
  const milestoneScenario = scenario === 'milestone' || scenario === 'review'
  const completionScenario = scenario === 'completion'
  return (
    settings.animationEnabled &&
    (!milestoneScenario || settings.milestoneEffectsEnabled) &&
    (!completionScenario || settings.completionEffectsEnabled)
  )
}

export function triggerCelebration(request: TriggerCelebrationRequest) {
  const settings = getFeedbackSettings()
  const soundEnabled = request.soundEnabled ?? settings.soundEnabled
  const volume = clampVolume(request.volume ?? settings.volume)

  if (!soundEnabled || volume <= 0 || !request.audioCue) return
  playWebAudioFireworkAccent({
    kind: request.audioCue.kind,
    milestoneStep: request.audioCue.milestoneStep ?? 0,
    volume,
  })
}
