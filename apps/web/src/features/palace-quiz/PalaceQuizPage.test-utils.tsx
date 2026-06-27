import { render } from '@testing-library/react'
import { Route, Routes, MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import PalaceQuizPage from '@/features/palace-quiz/PalaceQuizPage'

export const getPalaceApiMock = vi.fn()
export const getPalaceQuizQuestionsApiMock = vi.fn()
export const batchCreateChapterQuizQuestionsApiMock = vi.fn()
export const batchCreatePalaceQuizQuestionsApiMock = vi.fn()
export const batchDeletePalaceQuizQuestionsApiMock = vi.fn()
export const previewPalaceQuizGenerationFromPdfStreamApiMock = vi.fn()
export const recoverAndSavePalaceQuizGenerationFromAiLogApiMock = vi.fn()
export const classifyPalaceQuizQuestionsToMiniPalacesApiMock = vi.fn()
export const recordPalaceQuizChoiceAttemptApiMock = vi.fn()
export const requestPalaceShortAnswerFeedbackApiMock = vi.fn()
export const deletePalaceQuizQuestionApiMock = vi.fn()
export const dispatchGlobalFeedbackMock = vi.fn()
export const getSubjectsApiMock = vi.fn()
export const getSubjectTreeApiMock = vi.fn()
export const uploadSubjectDocumentApiMock = vi.fn()
export const useTimedSessionMock = vi.fn()
export const promptForAiOptionsMock = vi.fn()
export const promptForScenarioAiOptionsMock = vi.fn()
export const refreshSubjectDocumentsMock = vi.fn()

export const pdfControllerMock = {
  subjectDocuments: [
    {
      id: 9,
      subject_id: 2,
      filename: 'subjects/2/questions.pdf',
      original_name: 'questions.pdf',
      mime_type: 'application/pdf',
      file_size: 123,
      page_count: 10,
      created_at: '2026-06-12T00:00:00',
    },
    {
      id: 10,
      subject_id: 2,
      filename: 'subjects/2/answers.pdf',
      original_name: 'answers.pdf',
      mime_type: 'application/pdf',
      file_size: 123,
      page_count: 10,
      created_at: '2026-06-12T00:00:00',
    },
  ],
  subjectDocumentsLoading: false,
  selectedSubjectId: 2,
  setSelectedSubjectId: vi.fn(),
  selectedSubjectDocumentId: 9,
  setSelectedSubjectDocumentId: vi.fn(),
  pdfPageMeta: [],
  pdfPagesLoading: false,
  selectedPdfPages: [3],
  setSelectedPdfPages: vi.fn(),
  pdfPageInput: '3',
  setPdfPageInput: vi.fn(),
  pdfSelectionError: '',
  pdfImportMode: 'direct_generation',
  setPdfImportMode: vi.fn(),
  setPdfImportModeState: vi.fn(),
  structurePage: null,
  setStructurePage: vi.fn(),
  pdfPreviewPage: null,
  setPdfPreviewPage: vi.fn(),
  analyzedPdfPages: [],
  setAnalyzedPdfPages: vi.fn(),
  persistAnalyzedPdfPages: vi.fn(),
  rangePrompt: '',
  setRangePrompt: vi.fn(),
  pdfImportOptions: {
    quote_original_text_only: true,
    mount_on_original_leaf_only: true,
    preserve_emphasis_marks: true,
    semantic_split_long_paragraphs: true,
    preserve_line_breaks: true,
  },
  setImportPdfOption: vi.fn(),
  refreshSubjectDocuments: (...args: unknown[]) => refreshSubjectDocumentsMock(...args),
  togglePdfPage: vi.fn(),
  handleSubjectDocumentUpload: vi.fn(),
  handleSubjectDocumentDelete: vi.fn(),
}

vi.mock('@/entities/palace/api/catalogApi', () => ({
  getPalaceApi: (...args: unknown[]) => getPalaceApiMock(...args),
}))

vi.mock('@/features/ai-config/useAiRunConfigDialog', () => ({
  useAiRunConfigDialog: () => ({
    promptForAiOptions: (...args: unknown[]) => promptForAiOptionsMock(...args),
    promptForScenarioAiOptions: (...args: unknown[]) => promptForScenarioAiOptionsMock(...args),
    aiRunConfigDialog: null,
  }),
}))

vi.mock('@/entities/quiz/api/quizApi', () => ({
  getPalaceQuizQuestionsApi: (...args: unknown[]) => getPalaceQuizQuestionsApiMock(...args),
  createPalaceQuizQuestionApi: vi.fn(),
  batchCreateChapterQuizQuestionsApi: (...args: unknown[]) =>
    batchCreateChapterQuizQuestionsApiMock(...args),
  batchCreatePalaceQuizQuestionsApi: (...args: unknown[]) =>
    batchCreatePalaceQuizQuestionsApiMock(...args),
  batchDeletePalaceQuizQuestionsApi: (...args: unknown[]) =>
    batchDeletePalaceQuizQuestionsApiMock(...args),
  updatePalaceQuizQuestionApi: vi.fn(),
  deletePalaceQuizQuestionApi: (...args: unknown[]) => deletePalaceQuizQuestionApiMock(...args),
  previewPalaceQuizGenerationFromImagesApi: vi.fn(),
  previewPalaceQuizGenerationFromPdfStreamApi: (...args: unknown[]) =>
    previewPalaceQuizGenerationFromPdfStreamApiMock(...args),
  recoverAndSavePalaceQuizGenerationFromAiLogApi: (...args: unknown[]) =>
    recoverAndSavePalaceQuizGenerationFromAiLogApiMock(...args),
  classifyPalaceQuizQuestionsToMiniPalacesApi: (...args: unknown[]) =>
    classifyPalaceQuizQuestionsToMiniPalacesApiMock(...args),
  recordPalaceQuizChoiceAttemptApi: (...args: unknown[]) =>
    recordPalaceQuizChoiceAttemptApiMock(...args),
  requestPalaceShortAnswerFeedbackApi: (...args: unknown[]) =>
    requestPalaceShortAnswerFeedbackApiMock(...args),
}))

vi.mock('@/entities/knowledge/api/knowledgeApi', () => ({
  getSubjectsApi: (...args: unknown[]) => getSubjectsApiMock(...args),
  getSubjectTreeApi: (...args: unknown[]) => getSubjectTreeApiMock(...args),
  uploadSubjectDocumentApi: (...args: unknown[]) => uploadSubjectDocumentApiMock(...args),
}))

vi.mock('@/shared/hooks/useTimedSession', () => ({
  useTimedSession: (...args: unknown[]) => useTimedSessionMock(...args),
  shouldAutoStartOnPageEnter: vi.fn(() => true),
}))

vi.mock('@/shared/feedback/globalFeedbackModel', () => ({
  dispatchGlobalFeedback: (...args: unknown[]) => dispatchGlobalFeedbackMock(...args),
}))

vi.mock('@/entities/knowledge-import/model', () => ({
  usePdfImportController: () => pdfControllerMock,
}))

export const palaceResponse = {
  id: 1,
  title: '细胞生物学宫殿',
  primary_chapter_id: 1,
  primary_chapter: { id: 1, name: '第三章', subject_id: 2, parent_id: null },
  mini_palaces: [
    { id: 21, palace_id: 1, name: '细胞核小宫殿', node_uids: [], node_count: 1, sort_order: 0 },
  ],
  chapters: [
    {
      id: 1,
      name: '第三章',
      subject_id: 2,
      parent_id: null,
      is_explicit: true,
      subject: { id: 2, name: '生物' },
    },
  ],
}

export const baseQuestions = [
  {
    id: 11,
    palace_id: 1,
    question_type: 'multiple_choice' as const,
    stem: '细胞的控制中心是？',
    options: [
      { id: 'A', text: '细胞膜' },
      { id: 'B', text: '细胞核' },
    ],
    answer_payload: { correct_option_id: 'B' },
    analysis: '细胞核控制细胞活动。',
    mini_palace_id: null,
    origin_question_id: null,
    mini_palace: null,
    source_meta: {
      source_kind: 'subject_pdf',
      subject_document_id: 9,
      page_numbers: [3],
      image_names: ['page-3.png'],
      pdf_sources: [
        {
          subject_document_id: 9,
          document_name: 'questions.pdf',
          page_numbers: [3],
          role_hint: 'question',
        },
        {
          subject_document_id: 10,
          document_name: 'answers.pdf',
          page_numbers: [3],
          role_hint: 'answer',
        },
      ],
      extra_prompt: '只要本节的',
      secondary_review_enabled: false,
      ai_call_log_id: 'log-pdf-source',
      generated_at: '2026-06-12T00:00:00',
      generation_mode: 'subject_pdf_multi',
    },
    sort_order: 1,
    correct_count: 2,
    incorrect_count: 1,
    attempt_count: 3,
    created_at: '2026-06-12T00:00:00',
    updated_at: '2026-06-12T00:00:00',
  },
  {
    id: 12,
    palace_id: 1,
    question_type: 'short_answer' as const,
    stem: '简述有丝分裂的意义。',
    options: [],
    answer_payload: { reference_answer: '保证遗传信息稳定传递。' },
    analysis: '核心在于遗传物质平均分配。',
    mini_palace_id: null,
    origin_question_id: null,
    mini_palace: null,
    source_meta: {
      source_kind: 'manual',
      subject_document_id: null,
      page_numbers: null,
      image_names: null,
      extra_prompt: '',
      ai_call_log_id: null,
      generated_at: '2026-06-12T00:00:00',
      generation_mode: 'manual',
    },
    sort_order: 2,
    correct_count: 0,
    incorrect_count: 0,
    attempt_count: 0,
    created_at: '2026-06-12T00:00:00',
    updated_at: '2026-06-12T00:00:00',
  },
  {
    id: 13,
    palace_id: 1,
    question_type: 'multiple_choice' as const,
    stem: '细胞核的主要作用是什么？',
    options: [
      { id: 'A', text: '控制细胞活动' },
      { id: 'B', text: '提供能量' },
    ],
    answer_payload: { correct_option_id: 'A' },
    analysis: '细胞核储存遗传物质并控制细胞活动。',
    mini_palace_id: 21,
    origin_question_id: 11,
    mini_palace: { id: 21, name: '细胞核小宫殿' },
    source_meta: {
      source_kind: 'manual',
      subject_document_id: null,
      page_numbers: null,
      image_names: null,
      extra_prompt: '',
      ai_call_log_id: null,
      generated_at: '2026-06-12T00:00:00',
      generation_mode: 'manual',
    },
    sort_order: 3,
    correct_count: 0,
    incorrect_count: 0,
    attempt_count: 0,
    created_at: '2026-06-12T00:00:00',
    updated_at: '2026-06-12T00:00:00',
  },
]

export function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/palaces/1/quiz']}>
      <Routes>
        <Route path="/palaces/:id/quiz" element={<PalaceQuizPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

export function setupPalaceQuizPageTest() {
  vi.clearAllMocks()
  vi.stubGlobal('confirm', vi.fn(() => true))
  window.localStorage.clear()
  pdfControllerMock.rangePrompt = ''
  pdfControllerMock.setSelectedSubjectId.mockClear()
  pdfControllerMock.setSelectedSubjectDocumentId.mockClear()
  pdfControllerMock.setSelectedPdfPages.mockClear()
  pdfControllerMock.setPdfPageInput.mockClear()
  pdfControllerMock.setRangePrompt.mockClear()
  pdfControllerMock.persistAnalyzedPdfPages.mockClear()
  useTimedSessionMock.mockReturnValue({
    sessionId: 'quiz-timer-1',
    effectiveSeconds: 0,
    idleSeconds: 0,
    pauseCount: 0,
    status: 'idle',
    startedAt: null,
    durationEdited: false,
    glowState: 'idle',
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    setSceneActive: vi.fn(),
    leaveScene: vi.fn().mockResolvedValue(null),
    registerActivity: vi.fn(),
    logEvent: vi.fn(),
    adjustDuration: vi.fn(),
    complete: vi.fn().mockResolvedValue(null),
    reset: vi.fn(),
  })
  getPalaceApiMock.mockResolvedValue(palaceResponse)
  getPalaceQuizQuestionsApiMock.mockResolvedValue({ items: baseQuestions })
  batchCreateChapterQuizQuestionsApiMock.mockResolvedValue({ items: [] })
  batchCreatePalaceQuizQuestionsApiMock.mockResolvedValue({ items: [] })
  batchDeletePalaceQuizQuestionsApiMock.mockResolvedValue({ ok: true, deleted_count: 0 })
  deletePalaceQuizQuestionApiMock.mockResolvedValue({ ok: true })
  recoverAndSavePalaceQuizGenerationFromAiLogApiMock.mockResolvedValue({
    items: [],
    recovered_count: 1,
    saved_count: 1,
    deduped_count: 0,
    ai_call_log_id: 'log-12',
    grouped_summary: [],
  })
  previewPalaceQuizGenerationFromPdfStreamApiMock.mockImplementation(
    async (_palaceId, _data, handlers) => {
      handlers?.onStatus?.({ phase: 'generating', message: '正在调用模型生成题目', step: 2, total: 3 })
      handlers?.onDelta?.({ text: '{"questions":[' })
      return {
        palace_id: 1,
        questions: [
          {
            question_type: 'multiple_choice',
            stem: '细胞的控制中心是？',
            options: [
              { id: 'A', text: '细胞膜' },
              { id: 'B', text: '细胞核' },
            ],
            answer_payload: { correct_option_id: 'B' },
            analysis: '细胞核控制细胞活动。',
            source_meta: {
              ...baseQuestions[0].source_meta,
              generation_mode: 'subject_pdf_multi',
              pdf_sources: [
                {
                  subject_document_id: 9,
                  document_name: 'questions.pdf',
                  page_numbers: [3],
                  role_hint: 'question',
                },
              ],
            },
          },
        ],
        source_meta: {
          ...baseQuestions[0].source_meta,
          generation_mode: 'subject_pdf_multi',
          pdf_sources: [
            {
              subject_document_id: 9,
              document_name: 'questions.pdf',
              page_numbers: [3],
              role_hint: 'question',
            },
          ],
        },
        ai_call_log_id: 'log-preview',
        warnings: ['第 2 题正确答案不在选项列表中，已跳过；请重试或补充提示词要求选项完整。'],
        generation_stats: {
          returned_count: 2,
          savable_count: 1,
          skipped_count: 1,
        },
        grouped_questions: {
          child_chapter_groups: [
            {
              classified_chapter_id: 101,
              classified_chapter_name: '第二节',
              questions: [
                {
                  question_type: 'multiple_choice',
                  stem: '细胞的控制中心是？',
                  options: [
                    { id: 'A', text: '细胞膜' },
                    { id: 'B', text: '细胞核' },
                  ],
                  answer_payload: { correct_option_id: 'B' },
                  analysis: '细胞核控制细胞活动。',
                  source_chapter_id: 1,
                  classified_chapter_id: 101,
                  source_meta: {
                    ...baseQuestions[0].source_meta,
                    generation_mode: 'subject_pdf_multi',
                    pdf_sources: [
                      {
                        subject_document_id: 9,
                        document_name: 'questions.pdf',
                        page_numbers: [3],
                        role_hint: 'question',
                      },
                    ],
                  },
                },
              ],
            },
          ],
          unassigned_questions: [],
        },
      }
    },
  )
  classifyPalaceQuizQuestionsToMiniPalacesApiMock.mockResolvedValue({
    palace_id: 1,
    mini_palace_groups: [
      { mini_palace_id: 21, mini_palace_name: '细胞核小宫殿', question_count: 1 },
    ],
    unassigned_count: 1,
    copied_question_count: 1,
    ai_call_log_id: 'log-classify',
  })
  getSubjectsApiMock.mockResolvedValue([{ id: 2, name: '生物' }])
  getSubjectTreeApiMock.mockResolvedValue({
    subject: { id: 2, name: '生物' },
    chapters: [
      {
        id: 1,
        name: '第三章',
        subject_id: 2,
        parent_id: null,
        children: [
          {
            id: 101,
            name: '第二节',
            subject_id: 2,
            parent_id: 1,
            children: [],
          },
        ],
      },
    ],
  })
  uploadSubjectDocumentApiMock.mockResolvedValue({
    id: 12,
    subject_id: 2,
    filename: 'subjects/2/uploaded.pdf',
    original_name: 'uploaded.pdf',
    mime_type: 'application/pdf',
    file_size: 456,
    page_count: 2,
    created_at: '2026-06-15T00:00:00',
  })
  refreshSubjectDocumentsMock.mockResolvedValue(undefined)
  promptForAiOptionsMock.mockResolvedValue({})
  promptForScenarioAiOptionsMock.mockImplementation(
    (request: { entries?: Array<{ scenarioKey: string }> }) =>
      Object.fromEntries((request.entries || []).map((entry) => [entry.scenarioKey, {}])),
  )
  recordPalaceQuizChoiceAttemptApiMock.mockResolvedValue({
    question: {
      ...baseQuestions[0],
      correct_count: 3,
      incorrect_count: 1,
      attempt_count: 4,
    },
    selected_option_id: 'B',
    is_correct: true,
  })
  requestPalaceShortAnswerFeedbackApiMock.mockResolvedValue({
    question_id: 12,
    feedback_text: '你的答案方向是对的，还可以补充遗传稳定性。',
    ai_call_log_id: 'log-12',
  })
}
