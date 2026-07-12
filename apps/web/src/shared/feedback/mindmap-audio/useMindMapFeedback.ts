import * as React from 'react'
import type { MindMapFeedbackEvent, MindMapFeedbackOrigin } from '@/shared/feedback/feedbackEvents'
import {
  REVIEW_FEEDBACK_EFFECTIVE_VOLUME_MAX,
  REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT,
  getReviewFeedbackEffectiveVolume,
  readReviewFeedbackSettings,
  type ReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'
import {
  playWebAudioComboMilestone,
  playWebAudioFeedbackEvent,
  tuneToneSpec,
} from './webAudioFeedback'

interface MindMapFeedbackAudioController {
  playEvent: (
    event: MindMapFeedbackEvent,
    options?: {
      surprise?: boolean
      origin?: MindMapFeedbackOrigin
      audioScope?: 'local' | 'global'
      volume?: number
    },
  ) => void
  playComboMilestone: (milestoneStep: number, options?: { volume?: number }) => void
}

function clampFeedbackVolume(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.min(REVIEW_FEEDBACK_EFFECTIVE_VOLUME_MAX, value))
}

export function useMindMapFeedbackAudio(
  enabled: boolean,
  volume = 1,
): MindMapFeedbackAudioController {
  const feedbackVolume = clampFeedbackVolume(volume)

  const playEvent = React.useCallback(
    (
      event: MindMapFeedbackEvent,
      options?: {
        surprise?: boolean
        origin?: MindMapFeedbackOrigin
        audioScope?: 'local' | 'global'
        volume?: number
      },
    ) => {
      const eventVolume = clampFeedbackVolume(options?.volume ?? feedbackVolume)
      if (!enabled || eventVolume <= 0) return
      playWebAudioFeedbackEvent({
        event,
        surprise: options?.surprise,
        origin: options?.origin,
        audioScope: options?.audioScope,
        volume: eventVolume,
      })
    },
    [enabled, feedbackVolume],
  )

  const playComboMilestone = React.useCallback(
    (milestoneStep: number, options?: { volume?: number }) => {
      const eventVolume = clampFeedbackVolume(options?.volume ?? feedbackVolume)
      if (!enabled || eventVolume <= 0) return
      playWebAudioComboMilestone({
        milestoneStep,
        volume: eventVolume,
      })
    },
    [enabled, feedbackVolume],
  )

  return { playEvent, playComboMilestone }
}

export function useMindMapFeedbackSettings() {
  const [settings, setSettings] = React.useState<ReviewFeedbackSettings>(() =>
    readReviewFeedbackSettings(),
  )

  React.useEffect(() => {
    const sync = () => setSettings(readReviewFeedbackSettings())
    window.addEventListener(REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT, sync)
    return () => window.removeEventListener(REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT, sync)
  }, [])

  return settings
}

export function useMindMapFeedbackAudioFromSettings() {
  const settings = useMindMapFeedbackSettings()
  return useMindMapFeedbackAudio(
    settings.soundEnabled && settings.mode === 'immersive',
    getReviewFeedbackEffectiveVolume(settings),
  )
}

export { tuneToneSpec }
