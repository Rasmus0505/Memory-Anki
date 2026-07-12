import type { CSSProperties } from 'react'
import type {
  MindMapFeedbackEvent,
  MindMapFeedbackLevel,
  MindMapFeedbackOrigin,
} from '@/shared/feedback/feedbackEvents'
import type { FeedbackBurst, FeedbackDescriptor } from './feedbackTypes'
import { getMindMapFeedbackProfile } from './globalFeedbackProfiles'

export type {
  FeedbackBurst,
  FeedbackDescriptor,
  FeedbackVisualKind,
} from './feedbackTypes'
export { getMindMapFeedbackProfile } from './globalFeedbackProfiles'

export interface GlobalFeedbackRequestDetail {
  event: MindMapFeedbackEvent
  point?: { x: number; y: number }
  label?: string
  level?: MindMapFeedbackLevel
  origin?: MindMapFeedbackOrigin
  audioScope?: 'local' | 'global'
  screenPulse?: FeedbackDescriptor['screenPulse'] | null
}

export const GLOBAL_FEEDBACK_REQUEST_EVENT = 'memory-anki-global-feedback-request'

export function createMindMapFeedbackDescriptor(
  event: MindMapFeedbackEvent,
  overrides: Omit<GlobalFeedbackRequestDetail, 'event' | 'point'> = {},
) {
  const profile = getMindMapFeedbackProfile(event)
  return {
    audioEvent: event,
    visualKind: profile.visualKind,
    level: overrides.level ?? profile.level,
    origin: overrides.origin ?? profile.origin,
    audioScope: overrides.audioScope ?? profile.audioScope,
    hue: profile.hue,
    size: profile.size,
    label: overrides.label ?? profile.label,
    screenPulse:
      overrides.screenPulse === null
        ? undefined
        : overrides.screenPulse ?? profile.screenPulse,
  } satisfies FeedbackDescriptor
}

/** Dispatches an intentional semantic event; ordinary DOM events never call this automatically. */
export function dispatchGlobalFeedback(
  event: MindMapFeedbackEvent,
  options: Omit<GlobalFeedbackRequestDetail, 'event'> = {},
) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<GlobalFeedbackRequestDetail>(GLOBAL_FEEDBACK_REQUEST_EVENT, {
      detail: { event, ...options },
    }),
  )
}

export function buildFeedbackStyle(burst: FeedbackBurst) {
  return {
    left: `${burst.x}px`,
    top: `${burst.y}px`,
    '--feedback-hue': `${burst.descriptor.hue}`,
    '--feedback-size': `${burst.descriptor.size}px`,
  } as CSSProperties
}
