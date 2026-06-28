import type { PalaceQuizPdfSourceRole, PalaceQuizGenerationPreview } from '@/shared/api/contracts'

export type QuizGenerationSourceKind = 'subject-pdf' | 'image-single' | 'image-batch' | 'text-files'

export interface QuizGenerationHistoryPdfSource {
  subject_document_id: number
  document_name: string
  page_selection: number[]
  role_hint: PalaceQuizPdfSourceRole
}

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
  pdfSources: QuizGenerationHistoryPdfSource[]
  imageFileNames: string[]
  previewQuestionCount: number
  savableQuestionCount: number
  aiCallLogId: string | null
}

const HISTORY_STORAGE_PREFIX = 'memory_anki_palace_quiz_generation_history_'

function historyKey(palaceId: number) {
  return `${HISTORY_STORAGE_PREFIX}${palaceId}`
}

export function loadQuizGenerationHistory(palaceId: number): QuizGenerationHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(historyKey(palaceId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as QuizGenerationHistoryItem[]) : []
  } catch {
    return []
  }
}

export function saveQuizGenerationHistory(
  palaceId: number,
  item: Omit<QuizGenerationHistoryItem, 'id' | 'createdAt'>,
): QuizGenerationHistoryItem[] {
  const history = loadQuizGenerationHistory(palaceId)
  const nextItem: QuizGenerationHistoryItem = {
    ...item,
    id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  }
  const nextHistory = [nextItem, ...history].slice(0, 12)
  window.localStorage.setItem(historyKey(palaceId), JSON.stringify(nextHistory))
  return nextHistory
}

export function deleteQuizGenerationHistory(
  palaceId: number,
  historyId: string,
): QuizGenerationHistoryItem[] {
  const nextHistory = loadQuizGenerationHistory(palaceId).filter((item) => item.id !== historyId)
  window.localStorage.setItem(historyKey(palaceId), JSON.stringify(nextHistory))
  return nextHistory
}

export function buildQuizGenerationHistoryTitle(
  sourceKind: QuizGenerationSourceKind,
  pdfSources: QuizGenerationHistoryPdfSource[],
  imageFileNames: string[],
) {
  if (sourceKind === 'subject-pdf') {
    if (pdfSources.length === 0) return 'PDF 生成配置'
    return pdfSources.map((item) => item.document_name).join(' + ')
  }
  if (imageFileNames.length === 0) {
    if (sourceKind === 'image-single') return '单图生成配置'
    if (sourceKind === 'text-files') return '文本导入配置'
    return '多图生成配置'
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
    (preview.grouped_questions.mini_palace_groups || []).reduce(
      (total, group) => total + group.questions.length,
      0,
    ) + preview.grouped_questions.unassigned_questions.length
  )
}
