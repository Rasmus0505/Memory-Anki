import { API_BASE, fetchWithMutationQueue, request } from '@/shared/api/http'
import type {
  MindMapEditorState,
  PalaceQuizMiniPalaceClassificationResult,
  PalaceQuizStreamDeltaEvent,
  PalaceQuizGenerationPreview,
  PalaceQuizQuestion,
  PalaceQuizQuestionDraft,
  PalaceQuizQuestionType,
  PalaceQuizStreamStatusEvent,
  PalaceShortAnswerFeedback,
} from '@/shared/api/contracts'

async function readQuizJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data?.detail || data?.error || `HTTP ${response.status}`)
  }
  return data as T
}

function parseQuizSseEventBlock(block: string): { event: string; data: string } | null {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
  if (lines.length === 0) return null
  let event = 'message'
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }
  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}

async function readQuizStreamResponse<T>(
  response: Response,
  handlers?: {
    onStatus?: (event: PalaceQuizStreamStatusEvent) => void
    onDelta?: (event: PalaceQuizStreamDeltaEvent) => void
  },
): Promise<T> {
  if (!response.ok) {
    return readQuizJson<T>(response)
  }
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    return readQuizJson<T>(response)
  }
  if (!response.body) {
    throw new Error('浏览器不支持流式响应读取。')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResult: T | null = null
  let finalError = ''

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const parsed = parseQuizSseEventBlock(part)
      if (!parsed) continue
      const payload = JSON.parse(parsed.data)
      if (parsed.event === 'status') {
        handlers?.onStatus?.(payload as PalaceQuizStreamStatusEvent)
        continue
      }
      if (parsed.event === 'delta') {
        handlers?.onDelta?.(payload as PalaceQuizStreamDeltaEvent)
        continue
      }
      if (parsed.event === 'result') {
        finalResult = payload as T
        continue
      }
      if (parsed.event === 'error') {
        finalError = payload?.detail || payload?.error || '生成题目预览失败。'
      }
    }
    if (done) break
  }
  if (finalError) {
    throw new Error(finalError)
  }
  if (!finalResult) {
    throw new Error('流式生成结束但没有返回题目结果。')
  }
  return finalResult
}

export function getPalaceQuizQuestionsApi(palaceId: number) {
  return request<{ items: PalaceQuizQuestion[] }>(`/palaces/${palaceId}/quiz-questions`)
}

export function createPalaceQuizQuestionApi(
  palaceId: number,
  data: PalaceQuizQuestionDraft,
) {
  return request<{ item: PalaceQuizQuestion }>(`/palaces/${palaceId}/quiz-questions`, {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${palaceId}:quiz-question:create`,
      description: '新增宫殿题目',
      replayMode: 'manual',
    },
  })
}

export function batchCreatePalaceQuizQuestionsApi(
  palaceId: number,
  questions: PalaceQuizQuestionDraft[],
) {
  return request<{ items: PalaceQuizQuestion[] }>(`/palaces/${palaceId}/quiz-questions/batch`, {
    method: 'POST',
    body: JSON.stringify({ questions }),
    persistence: {
      resourceKey: `palace:${palaceId}:quiz-question:batch-create`,
      description: '批量保存宫殿题目',
      replayMode: 'manual',
    },
  })
}

export function updatePalaceQuizQuestionApi(
  questionId: number,
  data: PalaceQuizQuestionDraft,
) {
  return request<{ item: PalaceQuizQuestion }>(`/palace-quiz-questions/${questionId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace-quiz-question:${questionId}`,
      coalesceKey: `palace-quiz-question:${questionId}`,
      description: '保存宫殿题目',
      replayMode: 'auto',
    },
  })
}

export function deletePalaceQuizQuestionApi(questionId: number) {
  return request<{ ok: boolean }>(`/palace-quiz-questions/${questionId}`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `palace-quiz-question:${questionId}:delete`,
      description: '删除宫殿题目',
      replayMode: 'manual',
    },
  })
}

export function recordPalaceQuizChoiceAttemptApi(
  questionId: number,
  selectedOptionId: string,
) {
  return request<{
    question: PalaceQuizQuestion
    selected_option_id: string
    is_correct: boolean
  }>(`/palace-quiz-questions/${questionId}/choice-attempts`, {
    method: 'POST',
    body: JSON.stringify({ selected_option_id: selectedOptionId }),
    persistence: {
      resourceKey: `palace-quiz-question:${questionId}:attempt:${selectedOptionId}`,
      description: '累计选择题作答统计',
      replayMode: 'manual',
    },
  })
}

export function requestPalaceShortAnswerFeedbackApi(
  questionId: number,
  userAnswer: string,
  aiOptions?: import('@/shared/api/contracts').AiRuntimeOptions,
) {
  return request<PalaceShortAnswerFeedback>(
    `/palace-quiz-questions/${questionId}/short-answer-feedback`,
    {
      method: 'POST',
      body: JSON.stringify({ user_answer: userAnswer, ai_options: aiOptions }),
      persistence: {
        resourceKey: `palace-quiz-question:${questionId}:short-feedback`,
        description: '生成简答题 AI 点评',
        replayMode: 'manual',
      },
    },
  )
}

export async function previewPalaceQuizGenerationFromImagesApi(
  palaceId: number,
  files: File[],
  extraPrompt: string,
  classifyByMiniPalace = false,
  aiOptions?: import('@/shared/api/contracts').AiRuntimeOptions,
) {
  const form = new FormData()
  files.forEach((file) => form.append('files', file))
  form.append('extra_prompt', extraPrompt)
  form.append('classify_by_mini_palace', classifyByMiniPalace ? 'true' : 'false')
  if (aiOptions) {
    form.append('ai_options', JSON.stringify(aiOptions))
  }
  const response = await fetchWithMutationQueue(
    `${API_BASE}/palaces/${palaceId}/quiz-generation/images`,
    {
      method: 'POST',
      body: form,
    },
    {
      resourceKey: `palace:${palaceId}:quiz-generation:images:${files.map((file) => file.name).join(',')}`,
      description: 'AI 生成宫殿题目（图片）',
      replayMode: 'manual',
    },
  )
  return readQuizJson<PalaceQuizGenerationPreview>(response)
}

export function previewPalaceQuizGenerationFromPdfApi(
  palaceId: number,
  data: {
    subject_document_id?: number
    page_selection?: number[]
    pdf_sources?: Array<{
      subject_document_id: number
      page_selection: number[]
      role_hint?: string
    }>
    extra_prompt: string
    classify_by_mini_palace?: boolean
    ai_options?: import('@/shared/api/contracts').AiRuntimeOptions
  },
) {
  const resourceId =
    data.pdf_sources?.map((item) => item.subject_document_id).join(',') ||
    String(data.subject_document_id || 'unknown')
  return request<PalaceQuizGenerationPreview>(`/palaces/${palaceId}/quiz-generation/pdf`, {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${palaceId}:quiz-generation:pdf:${resourceId}`,
      description: 'AI 生成宫殿题目（PDF）',
      replayMode: 'manual',
    },
  })
}

export async function previewPalaceQuizGenerationFromPdfStreamApi(
  palaceId: number,
  data: {
    subject_document_id?: number
    page_selection?: number[]
    pdf_sources?: Array<{
      subject_document_id: number
      page_selection: number[]
      role_hint?: string
    }>
    extra_prompt: string
    classify_by_mini_palace?: boolean
    ai_options?: import('@/shared/api/contracts').AiRuntimeOptions
  },
  handlers?: {
    onStatus?: (event: PalaceQuizStreamStatusEvent) => void
    onDelta?: (event: PalaceQuizStreamDeltaEvent) => void
  },
) {
  const resourceId =
    data.pdf_sources?.map((item) => item.subject_document_id).join(',') ||
    String(data.subject_document_id || 'unknown')
  const response = await fetchWithMutationQueue(
    `${API_BASE}/palaces/${palaceId}/quiz-generation/pdf/stream`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
    {
      resourceKey: `palace:${palaceId}:quiz-generation:pdf-stream:${resourceId}`,
      description: 'AI 流式生成宫殿题目（PDF）',
      replayMode: 'manual',
    },
  )
  return readQuizStreamResponse<PalaceQuizGenerationPreview>(response, handlers)
}

export function classifyPalaceQuizQuestionsToMiniPalacesApi(
  palaceId: number,
  aiOptions?: import('@/shared/api/contracts').AiRuntimeOptions,
) {
  return request<PalaceQuizMiniPalaceClassificationResult>(
    `/palaces/${palaceId}/quiz-classification/mini-palaces`,
    {
      method: 'POST',
      body: JSON.stringify(aiOptions ? { ai_options: aiOptions } : {}),
      persistence: {
        resourceKey: `palace:${palaceId}:quiz-classification:mini-palaces`,
        description: '把大宫殿题库归类到小宫殿',
        replayMode: 'manual',
      },
    },
  )
}

export function previewPalaceQuizGenerationFromReviewMindmapApi(
  palaceId: number,
  data: {
    mode: 'chapter' | 'cross_palace'
    question_types: PalaceQuizQuestionType[]
    question_count: number
    review_editor_doc: MindMapEditorState['editor_doc']
    related_palace_ids?: number[]
    ai_options?: import('@/shared/api/contracts').AiRuntimeOptions
  },
) {
  return request<PalaceQuizGenerationPreview>(
    `/palaces/${palaceId}/quiz-generation/review-mindmap`,
    {
      method: 'POST',
      body: JSON.stringify(data),
      persistence: {
        resourceKey: `palace:${palaceId}:quiz-generation:review-mindmap:${data.mode}:${data.question_types.join(',')}:${data.question_count}`,
        description: 'AI 生成做题休息题目',
        replayMode: 'manual',
      },
    },
  )
}
