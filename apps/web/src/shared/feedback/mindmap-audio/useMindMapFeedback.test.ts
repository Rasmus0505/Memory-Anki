import { describe, expect, it } from 'vitest'
import { tuneToneSpec } from '@/shared/feedback/mindmap-audio/useMindMapFeedback'

describe('tuneToneSpec', () => {
  it('compresses local quiz sounds and expands global quiz sounds', () => {
    const baseTone = {
      frequency: 440,
      durationMs: 100,
      gain: 0.02,
      type: 'triangle' as const,
      offsetMs: 0,
      pan: 0.4,
    }

    const localTone = tuneToneSpec('quiz_answer_submit', baseTone, 'review', 'local')
    const globalTone = tuneToneSpec('quiz_generate_save', baseTone, 'system', 'global')

    expect(localTone.pan).toBeLessThan(baseTone.pan)
    expect(localTone.durationMs).toBeLessThan(baseTone.durationMs)
    expect(globalTone.pan).toBeGreaterThan(baseTone.pan)
    expect(globalTone.durationMs).toBeGreaterThan(localTone.durationMs)
    expect(globalTone.gain).toBeGreaterThan(localTone.gain)
  })
})
