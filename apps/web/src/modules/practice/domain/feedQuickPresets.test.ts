import { describe, expect, it } from 'vitest'
import type { FreestylePalaceContext } from '@/shared/api/contracts'
import {
  applyFreestyleQuickPreset,
  DEFAULT_FREESTYLE_FEED_CONFIG,
} from './feedConfig'

const palaces: FreestylePalaceContext[] = [
  { id: 1, title: 'English', subject: { id: 1, name: '\u82f1\u8bed' } },
  { id: 2, title: 'Math', subject: { id: 2, name: '\u6570\u5b66' } },
]

describe('freestyle quick presets', () => {
  it('selects quiz content only', () => {
    const config = applyFreestyleQuickPreset(DEFAULT_FREESTYLE_FEED_CONFIG, 'quiz', palaces)
    expect(config.mix_mode).toBe('quiz_only')
    expect(config.content).toEqual({ mindmap_branch: false, anki_card: false, quiz_question: true })
  })

  it('limits English to the English subject and memory palace to non-English subjects', () => {
    const english = applyFreestyleQuickPreset(DEFAULT_FREESTYLE_FEED_CONFIG, 'english', palaces)
    expect(english.specific_palace_ids).toEqual([1])
    expect(english.subject_scope).toBe('english')
    expect(english.content.quiz_question).toBe(false)

    const memoryPalace = applyFreestyleQuickPreset(DEFAULT_FREESTYLE_FEED_CONFIG, 'memory_palace', palaces)
    expect(memoryPalace.specific_palace_ids).toEqual([2])
    expect(memoryPalace.subject_scope).toBe('non_english')
    expect(memoryPalace.content.quiz_question).toBe(false)
  })
})
