import type { PalaceQuizGenerationPreview } from '@/shared/api/contracts'
import type { QuizGenerationJob } from '@/shared/api/contracts'

export type QuizGenerationSourceKind = 'image-single' | 'image-batch' | 'text-files'

export const QUIZ_GENERATION_SOURCE_LABELS = {
  'image-single': '单图',
  'image-batch': '多图',
  'text-files': '文本',
} satisfies Record<QuizGenerationSourceKind, string>

const EMPTY_SOURCE_HISTORY_TITLES = {
  'image-single': '单图生成配置',
  'image-batch': '多图生成配置',
  'text-files': '文本导入配置',
} satisfies Record<QuizGenerationSourceKind, string>

export interface QuizGenerationHistoryItem {
  id: string
  createdAt: string
  sourceKind: QuizGenerationSourceKind
  title: string
  extraPrompt: string
  enableSecondaryReview: boolean
  classifyByMiniPalace: boolean
  selectedChapterId?: number | null
  selectedChapterPath?: string
  imageFileNames: string[]
  previewQuestionCount: number
  savableQuestionCount: number
  aiCallLogId: string | null
}

export const HISTORY_STORAGE_PREFIX = 'memory_anki_palace_quiz_generation_history_'

function historyKey(palaceId: number) {
  return `${HISTORY_STORAGE_PREFIX}${palaceId}`
}

export function clearLegacyQuizGenerationHistory(palaceId: number) {
  try {
    window.localStorage.removeItem(historyKey(palaceId))
  } catch {
    // Persistent server history remains authoritative when browser storage is unavailable.
  }
}

export function mapQuizGenerationJobToHistory(job: QuizGenerationJob): QuizGenerationHistoryItem {
  const options = job.options
  const sourceKind = (options.source_kind || 'text-files') as QuizGenerationSourceKind
  return {
    id: job.id,
    createdAt: job.created_at || job.updated_at || new Date(0).toISOString(),
    sourceKind,
    title: job.title,
    extraPrompt: job.extra_prompt,
    enableSecondaryReview: Boolean(options.enable_secondary_review),
    classifyByMiniPalace: Boolean(options.classify_by_mini_palace),
    selectedChapterId: job.selected_chapter_id,
    selectedChapterPath: String(options.selected_chapter_path || ''),
    imageFileNames: job.sources.map((source) => source.original_name || source.display_name).filter(Boolean),
    previewQuestionCount: Number(options.preview_question_count || job.preview?.questions.length || 0),
    savableQuestionCount: Number(options.savable_question_count || 0),
    aiCallLogId: job.preview?.ai_call_log_id || null,
  }
}

export function buildQuizGenerationHistoryTitle(
  sourceKind: QuizGenerationSourceKind,
  imageFileNames: string[],
) {
  if (imageFileNames.length === 0) {
    return EMPTY_SOURCE_HISTORY_TITLES[sourceKind]
  }
  return imageFileNames.join(' + ')
}

export function getPreviewQuestionCount(preview: PalaceQuizGenerationPreview) {
  if (!preview.grouped_questions) return preview.questions.length
  if (preview.grouped_questions.child_chapter_groups) {
    return (
      preview.grouped_questions.child_chapter_groups.reduce(
        (total, group) => total + group.questions.length,
        0,
      ) + preview.grouped_questions.unassigned_questions.length
    )
  }
  return (
    (preview.grouped_questions.segment_groups || []).reduce(
      (total, group) => total + group.questions.length,
      0,
    ) + preview.grouped_questions.unassigned_questions.length
  )
}
