import { describe, expect, it } from 'vitest'
import { DEFAULT_TIMER_FOCUS_CONFIG, sanitizeTimerFocusConfig } from '@/shared/components/session/timer-focus-config'

describe('timer-focus-config compatibility', () => {
  it('uses balanced feedback as the low-distraction default', () => {
    expect(DEFAULT_TIMER_FOCUS_CONFIG.feedbackIntensity).toBe('balanced')
  })

  it('maps legacy timer intensities', () => {
    expect(sanitizeTimerFocusConfig({ feedbackIntensity: 'visual_only' }).feedbackIntensity).toBe('balanced')
    expect(sanitizeTimerFocusConfig({ feedbackIntensity: 'strong' }).feedbackIntensity).toBe('celebration')
    expect(sanitizeTimerFocusConfig({ feedbackIntensity: 'extreme' }).feedbackIntensity).toBe('balanced')
  })
})
