import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import PalaceQuizPage from '@/features/palace-quiz/PalaceQuizPage'

const getPalaceApiMock = vi.fn()
const getPalaceQuizQuestionsApiMock = vi.fn()
const batchCreateChapterQuizQuestionsApiMock = vi.fn()
const batchCreatePalaceQuizQuestionsApiMock = vi.fn()
const batchDeletePalaceQuizQuestionsApiMock = vi.fn()
const previewPalaceQuizGenerationFromPdfStreamApiMock = vi.fn()
const recoverAndSavePalaceQuizGenerationFromAiLogApiMock = vi.fn()
const classifyPalaceQuizQuestionsToMiniPalacesApiMock = vi.fn()
const recordPalaceQuizChoiceAttemptApiMock = vi.fn()
const requestPalaceShortAnswerFeedbackApiMock = vi.fn()
const deletePalaceQuizQuestionApiMock = vi.fn()
const dispatchGlobalFeedbackMock = vi.fn()
const getSubjectsApiMock = vi.fn()
const getSubjectTreeApiMock = vi.fn()
const uploadSubjectDocumentApiMock = vi.fn()
const useTimedSessionMock = vi.fn()
const promptForAiOptionsMock = vi.fn()
const refreshSubjectDocumentsMock = vi.fn()
const pdfControllerMock = {
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

vi.mock('@/shared/api/modules/palaces', () => ({
  getPalaceApi: (...args: unknown[]) => getPalaceApiMock(...args),
}))

vi.mock('@/features/ai-config/useAiRunConfigDialog', () => ({
  useAiRunConfigDialog: () => ({
    promptForAiOptions: (...args: unknown[]) => promptForAiOptionsMock(...args),
    aiRunConfigDialog: null,
  }),
}))

vi.mock('@/shared/api/modules/quizzes', () => ({
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

vi.mock('@/shared/api/modules/knowledge', () => ({
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

vi.mock('@/features/palace-edit/hooks/usePdfImportController', () => ({
  usePdfImportController: () => pdfControllerMock,
}))

const palaceResponse = {
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

const baseQuestions = [
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/palaces/1/quiz']}>
      <Routes>
        <Route path="/palaces/:id/quiz" element={<PalaceQuizPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PalaceQuizPage', () => {
  beforeEach(() => {
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
  })

  it('renders the route and switches among practice, manage, and AI tabs', async () => {
    renderPage()

    expect(await screen.findByText('细胞生物学宫殿 · 配套习题')).toBeTruthy()
    const backLink = screen.getByRole('link', { name: '返回做题区' })
    expect(backLink.getAttribute('href')).toBe('/palaces/quiz')
    expect(screen.getByText('PDF生成')).toBeTruthy()
    expect(screen.getByText(/questions\.pdf/)).toBeTruthy()
    expect(screen.getByText(/answers\.pdf/)).toBeTruthy()
    expect(useTimedSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'quiz',
        palaceId: 1,
        automationScene: 'quiz',
        sourceKind: 'palace',
        persistKey: 'palace_quiz:1',
      }),
    )
    expect(screen.getByTestId('session-timer-bar')).toBeTruthy()
    expect(screen.getByRole('button', { name: '做题' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '管理' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'AI生成' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    expect(await screen.findByText('题库列表')).toBeTruthy()
    expect(screen.getByRole('button', { name: /新增题目/ })).toBeTruthy()
    expect(screen.getAllByText('PDF生成').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'AI生成' }))
    expect(await screen.findByText('来源设置')).toBeTruthy()
    expect(await screen.findByText('生物 / 第三章')).toBeTruthy()
    expect(screen.getByText('预览后保存')).toBeTruthy()
    expect(screen.getByText('历史生成记录')).toBeTruthy()
    expect(screen.queryByText('从 AI 日志恢复')).toBeNull()
  })

  it('judges multiple-choice questions immediately, refreshes stats, and supports retry', async () => {
    renderPage()

    expect(await screen.findByText('细胞的控制中心是？')).toBeTruthy()
    expect(screen.getByText('答对 2 次 / 答错 1 次')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'B. 细胞核' }))

    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_answer_select',
      expect.objectContaining({ label: 'B', audioScope: 'local' }),
    )

    expect(await screen.findByText('回答正确')).toBeTruthy()
    expect(screen.getByText('解析：细胞核控制细胞活动。')).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByText('答对 3 次 / 答错 1 次')).toBeTruthy()
    })
    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_result_correct',
      expect.objectContaining({ label: '答对', audioScope: 'local' }),
    )
    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_result_reveal',
      expect.objectContaining({ audioScope: 'local' }),
    )

    fireEvent.click(screen.getByRole('button', { name: /再做一次/ }))

    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_answer_reset',
      expect.objectContaining({ label: '重做', audioScope: 'local' }),
    )

    await waitFor(() => {
      expect(screen.queryByText('回答正确')).toBeNull()
    })
  })

  it('reveals short-answer reference content after submit and enables AI feedback', async () => {
    window.localStorage.setItem('memory_anki_palace_quiz_view_mode', 'list')
    renderPage()

    expect(await screen.findByText('简述有丝分裂的意义。')).toBeTruthy()
    const aiFeedbackButton = screen.getAllByRole('button', { name: 'AI点评' })[0]
    expect((aiFeedbackButton as HTMLButtonElement).disabled).toBe(true)

    const textarea = screen.getByPlaceholderText('先写下你的答案，再点击提交')
    fireEvent.change(textarea, { target: { value: '能让细胞分裂。' } })
    fireEvent.click(screen.getByRole('button', { name: '提交答案' }))

    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_answer_submit',
      expect.objectContaining({ label: '提交答案', audioScope: 'local' }),
    )

    expect(await screen.findByText('参考答案')).toBeTruthy()
    expect(screen.getByText('保证遗传信息稳定传递。')).toBeTruthy()

    const enabledAiFeedbackButton = screen.getByRole('button', { name: 'AI点评' })
    expect((enabledAiFeedbackButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(enabledAiFeedbackButton)

    expect(
      await screen.findByText('你的答案方向是对的，还可以补充遗传稳定性。'),
    ).toBeTruthy()
    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_result_ai_feedback_ready',
      expect.objectContaining({ label: 'AI完成', audioScope: 'global' }),
    )
  })

  it('supports filtering questions by palace scope in manage view', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '管理' }))
    expect(await screen.findByText('细胞核的主要作用是什么？')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '细胞核小宫殿' }))

    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_nav_scope_change',
      expect.objectContaining({ label: '细胞核小宫殿', audioScope: 'global' }),
    )

    expect(await screen.findByText('细胞核的主要作用是什么？')).toBeTruthy()
    expect(screen.queryByText('简述有丝分裂的意义。')).toBeNull()
  })

  it('shows chapter-range controls and saves grouped preview', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    expect(await screen.findByText('已有题库归类到小宫殿')).toBeTruthy()
    expect(screen.getByRole('button', { name: '选择范围' })).toBeTruthy()
    expect(screen.getByText('按小宫殿分类保存')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '归类已有题库' }))
    expect(await screen.findByText('本次写入 1 道小宫殿题。')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('例如：3,4,8-10'), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: '加入本次资料集' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /按小宫殿分类保存/ }))
    fireEvent.click(screen.getByRole('button', { name: '生成预览' }))

    await waitFor(() => {
      expect(previewPalaceQuizGenerationFromPdfStreamApiMock).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          classify_by_mini_palace: true,
          enable_secondary_review: false,
          selected_chapter_id: 1,
        }),
        expect.any(Object),
      )
    })

    expect(await screen.findByText('第二节')).toBeTruthy()
    expect(screen.getByText(/AI返回 2 题，可保存\s*1 题，跳过\s*1 题/)).toBeTruthy()
    expect(screen.getByText(/正确答案不在选项列表中/)).toBeTruthy()
    expect(screen.getByText('将保存 1 题')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存到题库' }))

    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_generate_preview_ready',
      expect.objectContaining({ audioScope: 'global' }),
    )
    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_generate_save',
      expect.objectContaining({ label: '写入题库', audioScope: 'global' }),
    )

    await waitFor(() => {
      expect(recoverAndSavePalaceQuizGenerationFromAiLogApiMock).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          ai_call_log_id: 'log-preview',
          selected_chapter_id: 1,
          classify_by_mini_palace: true,
        }),
      )
    })
    expect(batchCreateChapterQuizQuestionsApiMock).not.toHaveBeenCalled()
    expect(batchCreatePalaceQuizQuestionsApiMock).not.toHaveBeenCalled()
  })

  it('falls back to direct batch save when preview has no ai log id', async () => {
    previewPalaceQuizGenerationFromPdfStreamApiMock.mockResolvedValueOnce({
      palace_id: 1,
      questions: [
        {
          question_type: 'multiple_choice',
          stem: '直接保存题目',
          options: [
            { id: 'A', text: '选项A' },
            { id: 'B', text: '选项B' },
          ],
          answer_payload: { correct_option_id: 'A' },
          analysis: '解析',
          source_meta: {
            source_kind: 'subject_pdf',
            subject_document_id: 9,
            page_numbers: [3],
            image_names: ['page-3.png'],
            extra_prompt: '',
            ai_call_log_id: null,
            generated_at: '2026-06-15T00:00:00',
            generation_mode: 'subject_pdf',
          },
        },
      ],
      source_meta: {
        source_kind: 'subject_pdf',
        subject_document_id: 9,
        page_numbers: [3],
        image_names: ['page-3.png'],
        extra_prompt: '',
        ai_call_log_id: null,
        generated_at: '2026-06-15T00:00:00',
        generation_mode: 'subject_pdf',
      },
      ai_call_log_id: null,
      grouped_questions: null,
    })

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.change(screen.getByPlaceholderText('例如：3,4,8-10'), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: '加入本次资料集' }))
    fireEvent.click(screen.getByRole('button', { name: '生成预览' }))
    fireEvent.click(await screen.findByRole('button', { name: '保存到题库' }))

    await waitFor(() => {
      expect(batchCreateChapterQuizQuestionsApiMock).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({
            source_chapter_id: 1,
            classified_chapter_id: null,
          }),
        ]),
      )
    })
    expect(recoverAndSavePalaceQuizGenerationFromAiLogApiMock).not.toHaveBeenCalled()
  })

  it('collects multiple pdf sources before generating preview', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    expect(await screen.findByText('本次已加入的 PDF 资料')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('例如：3,4,8-10'), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: '加入本次资料集' }))

    expect(await screen.findAllByText('questions.pdf')).toHaveLength(2)
    const roleSelect = screen.getByDisplayValue('题目') as HTMLSelectElement
    expect(Array.from(roleSelect.options).map((option) => option.textContent)).toEqual([
      '题目',
      '答案',
    ])
    fireEvent.change(roleSelect, { target: { value: 'answer' } })

    fireEvent.click(screen.getByRole('button', { name: '生成预览' }))

    await waitFor(() => {
      expect(previewPalaceQuizGenerationFromPdfStreamApiMock).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          pdf_sources: [
            expect.objectContaining({
              subject_document_id: 9,
              page_selection: [3],
              role_hint: 'answer',
            }),
          ],
          selected_chapter_id: 1,
        }),
        expect.any(Object),
      )
    })
    expect(await screen.findByTestId('palace-quiz-generation-stream-preview')).toBeTruthy()
  })

  it('renders secondary review toggle and sends it when enabled', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    expect(await screen.findByText('二次筛选')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('例如：3,4,8-10'), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: '加入本次资料集' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /二次筛选/ }))
    fireEvent.click(screen.getByRole('button', { name: '生成预览' }))

    await waitFor(() => {
      expect(previewPalaceQuizGenerationFromPdfStreamApiMock).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ enable_secondary_review: true, selected_chapter_id: 1 }),
        expect.any(Object),
      )
    })
  })

  it('stores generation history and regenerates from it', async () => {
    pdfControllerMock.rangePrompt = '只生成本章重点题'
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.change(screen.getByPlaceholderText('例如：3,4,8-10'), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: '加入本次资料集' }))
    fireEvent.click(screen.getByRole('button', { name: '生成预览' }))

    await waitFor(() => {
      expect(previewPalaceQuizGenerationFromPdfStreamApiMock).toHaveBeenCalledTimes(1)
    })
    expect(screen.getAllByText('questions.pdf').length).toBeGreaterThan(1)
    expect(screen.getAllByRole('button', { name: '重新生成' }).length).toBeGreaterThan(0)

    fireEvent.click(screen.getAllByRole('button', { name: '重新生成' })[0])

    await waitFor(() => {
      expect(previewPalaceQuizGenerationFromPdfStreamApiMock).toHaveBeenCalledTimes(2)
    })
    expect(previewPalaceQuizGenerationFromPdfStreamApiMock).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({
        extra_prompt: '只生成本章重点题',
        selected_chapter_id: 1,
        pdf_sources: [
          expect.objectContaining({
            subject_document_id: 9,
            page_selection: [3],
          }),
        ],
      }),
      expect.any(Object),
    )
  })

  it('loads a saved history item back into the source panel', async () => {
    window.localStorage.setItem(
      'memory_anki_palace_quiz_generation_history_1',
      JSON.stringify([
        {
          id: 'history-1',
          createdAt: '2026-06-15T08:00:00.000Z',
          sourceKind: 'subject-pdf',
          title: 'questions.pdf',
          extraPrompt: '按大题拆分并提高难度',
          enableSecondaryReview: true,
          classifyByMiniPalace: true,
          selectedChapterId: 101,
          selectedChapterPath: '生物 / 第三章 / 第二节',
          pdfSources: [
            {
              subject_document_id: 9,
              document_name: 'questions.pdf',
              page_selection: [3],
              role_hint: 'question',
            },
          ],
          imageFileNames: [],
          previewQuestionCount: 2,
          savableQuestionCount: 1,
          aiCallLogId: 'log-preview',
        },
      ]),
    )

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.click(screen.getByRole('button', { name: '导入到左侧' }))

    expect(pdfControllerMock.setSelectedSubjectId).toHaveBeenCalledWith(2)
    expect(pdfControllerMock.setSelectedSubjectDocumentId).toHaveBeenCalledWith(9)
    expect(pdfControllerMock.setSelectedPdfPages).toHaveBeenCalledWith([3])
    expect(pdfControllerMock.setPdfPageInput).toHaveBeenCalledWith('3')
    expect(pdfControllerMock.setRangePrompt).toHaveBeenCalledWith('按大题拆分并提高难度')
    expect(await screen.findByText('生物 / 第三章 / 第二节')).toBeTruthy()
  })

  it('opens the range dialog and lets the user switch to a child chapter', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.click(screen.getByRole('button', { name: '选择范围' }))

    expect(
      await screen.findByText(
        '选择本次 AI 生成题目所属的章节范围。一次只能选择一个章节节点，也支持直接选择父级大章节整章生成。',
      ),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /第二节/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认范围' }))

    expect(await screen.findByText('生物 / 第三章 / 第二节')).toBeTruthy()
  })

  it('allows selecting an ancestor chapter when only a child chapter is explicitly bound', async () => {
    getPalaceApiMock.mockResolvedValueOnce({
      ...palaceResponse,
      primary_chapter_id: 101,
      primary_chapter: { id: 101, name: '第二节', subject_id: 2, parent_id: 1 },
      chapters: [
        {
          id: 1,
          name: '第三章',
          subject_id: 2,
          parent_id: null,
          is_explicit: false,
          subject: { id: 2, name: '生物' },
        },
        {
          id: 101,
          name: '第二节',
          subject_id: 2,
          parent_id: 1,
          is_explicit: true,
          subject: { id: 2, name: '生物' },
        },
      ],
    })

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.click(screen.getByRole('button', { name: '选择范围' }))

    await screen.findByText(
      '选择本次 AI 生成题目所属的章节范围。一次只能选择一个章节节点，也支持直接选择父级大章节整章生成。',
    )
    fireEvent.click(await screen.findByRole('button', { name: /第三章/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认范围' }))

    expect(await screen.findByText('生物 / 第三章')).toBeTruthy()
    expect(
      (screen.getByRole('checkbox', { name: /按小宫殿分类保存/ }) as HTMLInputElement).disabled,
    ).toBe(false)
    expect(
      screen.getByText('开启后，题目会按当前所选范围的直接子章节分类，并以章节题的形式分别保存。'),
    ).toBeTruthy()
  })

  it('opens the file picker from the upload button', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.click(screen.getByRole('button', { name: '上传新 PDF 到资料库' }))

    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('uploads the selected pdf and refreshes the subject documents', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null

    expect(fileInput).toBeTruthy()
    const file = new File(['%PDF-1.4'], 'uploaded.pdf', { type: 'application/pdf' })
    fireEvent.change(fileInput!, { target: { files: [file] } })

    await waitFor(() => {
      expect(uploadSubjectDocumentApiMock).toHaveBeenCalledWith(2, file)
    })
    await waitFor(() => {
      expect(refreshSubjectDocumentsMock).toHaveBeenCalled()
    })
  })

  it('keeps complex question types viewable and deletable in manage mode without edit actions', async () => {
    getPalaceQuizQuestionsApiMock.mockResolvedValue({
      items: [
        ...baseQuestions,
        {
          id: 14,
          palace_id: 1,
          question_type: 'true_false' as const,
          stem: 'DNA 复制发生在间期。',
          options: [],
          answer_payload: { correct_answer: true },
          analysis: '这是细胞周期中的基础知识点。',
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
          sort_order: 4,
          correct_count: 0,
          incorrect_count: 0,
          attempt_count: 0,
          created_at: '2026-06-12T00:00:00',
          updated_at: '2026-06-12T00:00:00',
        },
      ],
    })

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '管理' }))

    expect(await screen.findByText('DNA 复制发生在间期。')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '编辑' })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: '删除' })).toHaveLength(4)
  })

  it('supports selecting and batch deleting questions in the manage tab', async () => {
    getPalaceQuizQuestionsApiMock
      .mockResolvedValueOnce({ items: baseQuestions })
      .mockResolvedValueOnce({ items: [baseQuestions[2]] })

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '管理' }))

    fireEvent.click(screen.getByRole('checkbox', { name: '选择题目 细胞的控制中心是？' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择题目 简述有丝分裂的意义。' }))

    expect(screen.getByText('已选 2 题')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '批量删除所选' }))

    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_manage_batch_delete',
      expect.objectContaining({ label: '批量删除', audioScope: 'global' }),
    )

    await waitFor(() => {
      expect(batchDeletePalaceQuizQuestionsApiMock).toHaveBeenCalledWith([11, 12])
    })
    await waitFor(() => {
      expect(screen.getByText('已选 0 题')).toBeTruthy()
    })
  })
})
