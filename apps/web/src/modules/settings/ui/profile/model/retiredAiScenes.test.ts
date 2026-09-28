import { describe, expect, it } from 'vitest'
import { isRetiredAiSettingsScene } from '@/modules/settings/ui/profile/model/retiredAiScenes'

describe('isRetiredAiSettingsScene', () => {
  it('keeps English listening course scenes', () => {
    expect(isRetiredAiSettingsScene('translation_course_batch')).toBe(false)
    expect(isRetiredAiSettingsScene('asr_course_transcription')).toBe(false)
  })

  it('keeps peg association and the generic translation scene', () => {
    expect(isRetiredAiSettingsScene('translation')).toBe(false)
    expect(isRetiredAiSettingsScene('peg_association_suggestions')).toBe(false)
  })

  it('hides scenes that only served removed features', () => {
    for (const key of [
      'ai_split',
      'reading_sentence_rewrite',
      'english_reading',
      'translation_reading_sentence',
      'vision_image_mindmap',
      'mindmap_ocr_formatter',
      'quiz_image_generation',
      'quiz_text_generation',
      'quiz_node_binding',
      'quiz_short_answer_feedback',
      'quiz_mini_palace_grouping',
      'quiz_source_pair_transcription',
      'batch_quiz_generation',
      'batch_palace_generation',
      'review_ai_learning',
    ]) {
      expect(isRetiredAiSettingsScene(key)).toBe(true)
    }
  })
})
