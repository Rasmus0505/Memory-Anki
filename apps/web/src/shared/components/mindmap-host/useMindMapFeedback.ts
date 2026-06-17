import * as React from 'react'
import type { MindMapFeedbackEvent, MindMapFeedbackOrigin } from '@/shared/components/mindmap-host/hostBridgeUtils'
import {
  REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT,
  readReviewFeedbackSettings,
  type ReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'
import {
  playLegacyComboMilestone,
  playLegacyFeedbackEvent,
  tuneToneSpec,
} from './legacyWebAudio'

interface MindMapFeedbackAudioController {
  playEvent: (
    event: MindMapFeedbackEvent,
    options?: {
      surprise?: boolean
      origin?: MindMapFeedbackOrigin
      audioScope?: 'local' | 'global'
    },
  ) => void
  playComboMilestone: (milestoneStep: number) => void
}

function clampFeedbackVolume(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.min(2, value))
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
      },
    ) => {
      if (!enabled || feedbackVolume <= 0) return
      playLegacyFeedbackEvent({
        event,
        surprise: options?.surprise,
        origin: options?.origin,
        audioScope: options?.audioScope,
        volume: feedbackVolume,
      })
    },
    [enabled, feedbackVolume],
  )

  const playComboMilestone = React.useCallback(
    (milestoneStep: number) => {
      if (!enabled || feedbackVolume <= 0) return
      playLegacyComboMilestone({
        milestoneStep,
        volume: feedbackVolume,
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
    settings.volume,
  )
}

export { tuneToneSpec }
