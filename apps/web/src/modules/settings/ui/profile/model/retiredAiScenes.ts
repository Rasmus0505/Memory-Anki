/**
 * Scene keys that only served removed product surfaces.
 * English listening course scenes stay visible even if another token matches.
 */
export function isRetiredAiSettingsScene(sceneKey: string): boolean {
  const key = sceneKey.trim()
  if (!key) return false
  if (key.includes('translation_course') || key.includes('asr_course')) return false
  return (
    key === 'ai_split' ||
    key.startsWith('ai_split_') ||
    key === 'english_reading' ||
    key.startsWith('english_reading_') ||
    key.startsWith('reading_') ||
    key.startsWith('translation_reading') ||
    key.startsWith('vision_') ||
    key === 'mindmap_ocr_formatter' ||
    key.startsWith('mindmap_ocr_') ||
    key.includes('ai_learning') ||
    key.includes('generation') ||
    key.startsWith('quiz_source_pair') ||
    key.startsWith('quiz_mini_palace') ||
    key === 'quiz_node_binding' ||
    key === 'quiz_short_answer_feedback'
  )
}
