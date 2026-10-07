import { readReviewFeedbackSettings } from '@/shared/feedback/reviewFeedbackSettings'
import { prefersReducedMotion } from '@/shared/lib/prefersReducedMotion'

export type HapticPattern = 'tap' | 'select' | 'success' | 'soft-fail' | 'milestone' | 'long-press' | 'celebrate'

const HAPTIC_PATTERNS: Record<HapticPattern, number | number[]> = {
  tap: 8,
  select: 12,
  success: [14, 40, 18],
  'soft-fail': 22,
  milestone: [16, 50, 16, 50, 28],
  'long-press': 35,
  celebrate: [20, 60, 20, 60, 40, 80, 60],
}

// iOS Safari/PWA has no Vibration API; the call is a silent no-op there.
export function triggerHaptic(pattern: HapticPattern) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  if (prefersReducedMotion()) return
  if (!readReviewFeedbackSettings().hapticsEnabled) return
  try {
    navigator.vibrate(HAPTIC_PATTERNS[pattern])
  } catch {
    // Some embedders throw when vibration is blocked by permissions policy.
  }
}
