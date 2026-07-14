import { render } from '@testing-library/react'
import { Route, Routes, MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import PalaceQuizPage from '@/features/palace-quiz/PalaceQuizPage'

export const getPalaceApiMock = vi.fn()
export const getPalacesGroupedApiMock = vi.fn()
export const getPalaceEditorApiMock = vi.fn()
export const getPalaceQuizQuestionsApiMock = vi.fn()
export const batchCreateChapterQuizQuestionsApiMock = vi.fn()
export const batchCreatePalaceQuizQuestionsApiMock = vi.fn()
export const batchDeletePalaceQuizQuestionsApiMock = vi.fn()
export const previewPalaceQuizGenerationFromImagesApiMock = vi.fn()
export const previewPalaceQuizGenerationFromTextFilesApiMock = vi.fn()
export const classifyPalaceQuizQuestionsToMiniPalacesApiMock = vi.fn()
export const recordPalaceQuizChoiceAttemptApiMock = vi.fn()
export const resetPalaceQuizQuestionAttemptsApiMock = vi.fn()
export const requestPalaceShortAnswerFeedbackApiMock = vi.fn()
export const deletePalaceQuizQuestionApiMock = vi.fn()
export const dispatchGlobalFeedbackMock = vi.fn()
export const emitReviewConfettiMock = vi.fn()
export const getSubjectsApiMock = vi.fn()
export const getSubjectTreeApiMock = vi.fn()
export const useTimedSessionMock = vi.fn()
export const promptForAiOptionsMock = vi.fn()
export const promptForScenarioAiOptionsMock = vi.fn()
export const mindMapFramePropsMock = vi.fn()
export const listQuizGenerationJobsApiMock = vi.fn()
export const listQuizPdfAssetsApiMock = vi.fn()
export const createQuizGenerationJobApiMock = vi.fn()
export const addQuizFileSourceApiMock = vi.fn()
export const addQuizTextSourceApiMock = vi.fn()
export const addQuizPdfSourceApiMock = vi.fn()
export const deleteQuizSourceApiMock = vi.fn()
export const reorderQuizSourcesApiMock = vi.fn()
export const extractMatchQuizJobApiMock = vi.fn()
export const updateQuizMatchingApiMock = vi.fn()
export const generateQuizWorkspacePreviewApiMock = vi.fn()
export const markQuizGenerationJobSavedApiMock = vi.fn()
export const updateQuizGenerationJobApiMock = vi.fn()
export const uploadQuizPdfAssetApiMock = vi.fn()
export const updateQuizPdfAssetApiMock = vi.fn()
export const deleteQuizPdfAssetApiMock = vi.fn()
export const deleteQuizGenerationJobApiMock = vi.fn()

function collectMindMapNodes(root: any): Array<{ uid: string; text: string }> {
  if (!root) return []
  const nodes: Array<{ uid: string; text: string }> = []
  const walk = (node: any, fallbackUid: string) => {
    const uid = String(node?.data?.uid ?? node?.data?.memoryAnkiId ?? fallbackUid)
    const text = String(node?.data?.text ?? '')
    nodes.push({ uid, text })
    const children = Array.isArray(node?.children) ? node.children : []
    children.forEach((child, index) => walk(child, `${uid}-${index}`))
  }
  walk(root, 'root')
  return nodes
}

vi.mock('@/entities/palace/api', () => ({
  getPalaceApi: (...args: unknown[]) => getPalaceApiMock(...args),
  getPalacesGroupedApi: (...args: unknown[]) => getPalacesGroupedApiMock(...args),
  getPalaceEditorApi: (...args: unknown[]) => getPalaceEditorApiMock(...args),
}))

vi.mock('@/features/mindmap-editor', () => ({
  MindMapEditorSurface: (props: {
    editorState?: any
    readonly?: boolean
    focusRequestNodeUid?: string | null
    focusRequestNonce?: number
    onNodeClick?: (nodes: Array<{ uid: string; text: string }>) => void
    onNodeContextMenu?: (nodes: Array<{ uid: string; text: string }>) => void
    practiceModeActive?: boolean
    reviewFxSignal?: { type?: string } | null
    syncReason?: string | null
  }) => {
    mindMapFramePropsMock(props)
    const nodes = collectMindMapNodes(props.editorState?.editor_doc?.root)
    return (
      <div
        data-testid="memory-lookup-mindmap"
        data-readonly={props.readonly ? 'true' : 'false'}
        data-root-uid={props.focusRequestNodeUid || ''}
        data-focus-nonce={String(props.focusRequestNonce ?? 0)}
        data-practice-mode={props.practiceModeActive ? 'true' : 'false'}
        data-review-fx={props.reviewFxSignal?.type || ''}
        data-sync-reason={props.syncReason || ''}
      >
        {nodes.map((node) => (
          <span
            key={node.uid}
            data-testid={`memory-node-${node.uid}`}
            onClick={() => props.onNodeClick?.([{ uid: node.uid, text: node.text }])}
            onContextMenu={(event) => {
              event.preventDefault()
              props.onNodeContextMenu?.([{ uid: node.uid, text: node.text }])
            }}
          >
            {node.text}
          </span>
        ))}
      </div>
    )
  },
}))

vi.mock('@/entities/ai-runtime', () => ({
  useAiRunConfigDialog: () => ({
    promptForAiOptions: (...args: unknown[]) => promptForAiOptionsMock(...args),
    promptForScenarioAiOptions: (...args: unknown[]) => promptForScenarioAiOptionsMock(...args),
    aiRunConfigDialog: null,
  }),
}))

vi.mock('@/entities/quiz/api', () => ({
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
  previewPalaceQuizGenerationFromImagesApi: (...args: unknown[]) =>
    previewPalaceQuizGenerationFromImagesApiMock(...args),
  previewPalaceQuizGenerationFromTextFilesApi: (...args: unknown[]) =>
    previewPalaceQuizGenerationFromTextFilesApiMock(...args),
  classifyPalaceQuizQuestionsToMiniPalacesApi: (...args: unknown[]) =>
    classifyPalaceQuizQuestionsToMiniPalacesApiMock(...args),
  recordPalaceQuizChoiceAttemptApi: (...args: unknown[]) =>
    recordPalaceQuizChoiceAttemptApiMock(...args),
  resetPalaceQuizQuestionAttemptsApi: (...args: unknown[]) =>
    resetPalaceQuizQuestionAttemptsApiMock(...args),
  requestPalaceShortAnswerFeedbackApi: (...args: unknown[]) =>
    requestPalaceShortAnswerFeedbackApiMock(...args),
}))

vi.mock('@/entities/knowledge/api', () => ({
  getSubjectsApi: (...args: unknown[]) => getSubjectsApiMock(...args),
  getSubjectTreeApi: (...args: unknown[]) => getSubjectTreeApiMock(...args),
}))

vi.mock('@/features/palace-quiz/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/palace-quiz/api')>()),
  listQuizGenerationJobsApi: (...args: unknown[]) => listQuizGenerationJobsApiMock(...args),
  listQuizPdfAssetsApi: (...args: unknown[]) => listQuizPdfAssetsApiMock(...args),
  createQuizGenerationJobApi: (...args: unknown[]) => createQuizGenerationJobApiMock(...args),
  addQuizFileSourceApi: (...args: unknown[]) => addQuizFileSourceApiMock(...args),
  addQuizTextSourceApi: (...args: unknown[]) => addQuizTextSourceApiMock(...args),
  addQuizPdfSourceApi: (...args: unknown[]) => addQuizPdfSourceApiMock(...args),
  deleteQuizSourceApi: (...args: unknown[]) => deleteQuizSourceApiMock(...args),
  reorderQuizSourcesApi: (...args: unknown[]) => reorderQuizSourcesApiMock(...args),
  extractMatchQuizJobApi: (...args: unknown[]) => extractMatchQuizJobApiMock(...args),
  updateQuizMatchingApi: (...args: unknown[]) => updateQuizMatchingApiMock(...args),
  generateQuizWorkspacePreviewApi: (...args: unknown[]) => generateQuizWorkspacePreviewApiMock(...args),
  markQuizGenerationJobSavedApi: (...args: unknown[]) => markQuizGenerationJobSavedApiMock(...args),
  updateQuizGenerationJobApi: (...args: unknown[]) => updateQuizGenerationJobApiMock(...args),
  uploadQuizPdfAssetApi: (...args: unknown[]) => uploadQuizPdfAssetApiMock(...args),
  updateQuizPdfAssetApi: (...args: unknown[]) => updateQuizPdfAssetApiMock(...args),
  deleteQuizPdfAssetApi: (...args: unknown[]) => deleteQuizPdfAssetApiMock(...args),
  deleteQuizGenerationJobApi: (...args: unknown[]) => deleteQuizGenerationJobApiMock(...args),
}))

vi.mock('@/shared/hooks/useTimedSession', () => ({
  useTimedSession: (...args: unknown[]) => useTimedSessionMock(...args),
  shouldAutoStartOnPageEnter: vi.fn(() => true),
}))

vi.mock('@/shared/feedback/globalFeedbackModel', () => ({
  dispatchGlobalFeedback: (...args: unknown[]) => dispatchGlobalFeedbackMock(...args),
}))

vi.mock('@/shared/components/celebration', async () => {
  const actual = await vi.importActual<typeof import('@/shared/components/celebration')>(
    '@/shared/components/celebration',
  )
  return {
    ...actual,
    emitReviewConfetti: (...args: unknown[]) => emitReviewConfettiMock(...args),
  }
})

export const palaceResponse = {
  id: 1,
  title: '细胞生物学宫殿',
  primary_chapter_id: 1,
  primary_chapter: { id: 1, name: '第三章', subject_id: 2, parent_id: null },
  segments: [
    { id: 21, palace_id: 1, name: '细胞核学习组', display_name: '细胞核学习组', color: '#14b8a6', node_count: 1, sort_order: 0, is_virtual_default: false },
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

export const palaceLookupGroupedResponse = {
  groups: [],
  ungrouped: [],
  subjects: [
    {
      subject: { id: 2, name: '生物', color: '#22c55e' },
      chapter_groups: [
        {
          source_chapter: { id: 1, name: '第三章', subject_id: 2, parent_id: null },
          palaces: [
            {
              id: 1,
              title: '细胞生物学宫殿',
              resolved_title: '细胞生物学宫殿',
              description: '',
              mastered: false,
              created_at: '2026-06-12T00:00:00',
              next_review_at: null,
              has_due_review: false,
              current_review_schedule_id: null,
              review_stage_total: 0,
              review_stage_completed: 0,
              review_stage_progress: 0,
              stage_labels: [],
              review_stages: [],
              title_mode: 'sync',
              manual_title: '',
              grouping_mode: 'auto',
              manual_group_chapter_id: null,
              binding_status: 'ok',
              primary_chapter_id: 1,
              primary_chapter: { id: 1, name: '第三章', subject_id: 2, parent_id: null },
              resolved_subject: { id: 2, name: '生物', color: '#22c55e' },
              resolved_parent_chapter: null,
              group_id: null,
              group_sort_order: 0,
              chapters: palaceResponse.chapters,
              segments: palaceResponse.segments,
            },
            {
              id: 2,
              title: '遗传学宫殿',
              resolved_title: '遗传学宫殿',
              description: '',
              mastered: false,
              created_at: '2026-06-12T00:00:00',
              next_review_at: null,
              has_due_review: false,
              current_review_schedule_id: null,
              review_stage_total: 0,
              review_stage_completed: 0,
              review_stage_progress: 0,
              stage_labels: [],
              review_stages: [],
              title_mode: 'sync',
              manual_title: '',
              grouping_mode: 'auto',
              manual_group_chapter_id: null,
              binding_status: 'ok',
              primary_chapter_id: 2,
              primary_chapter: { id: 2, name: '第四章', subject_id: 2, parent_id: null },
              resolved_subject: { id: 2, name: '生物', color: '#22c55e' },
              resolved_parent_chapter: null,
              group_id: null,
              group_sort_order: 0,
              chapters: [{ ...palaceResponse.chapters[0], id: 2, name: '第四章' }],
              segments: [],
              mini_palaces: [],
            },
          ],
        },
      ],
      ungrouped_palaces: [],
    },
  ],
}

export function buildPalaceEditorResponse(palaceId = 1) {
  return {
    palace: {
      id: palaceId,
      title: palaceId === 1 ? '细胞生物学宫殿' : '遗传学宫殿',
    },
    editor_doc: {
      root: {
        data: {
          uid: `root-${palaceId}`,
          text: palaceId === 1 ? '细胞生物学宫殿' : '遗传学宫殿',
        },
        children: [
          {
            data: {
              uid: `child-${palaceId}`,
              text: palaceId === 1 ? '细胞核知识点' : '遗传因子知识点',
            },
            children: [
              {
                data: {
                  uid: `grandchild-${palaceId}`,
                  text: palaceId === 1 ? '染色体线索' : '分离定律线索',
                },
                children: [],
              },
            ],
          },
        ],
      },
    },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
    editor_fingerprint: `palace-${palaceId}`,
  }
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
      source_kind: 'image_batch',
      page_numbers: null,
      image_names: ['question.png', 'answer.png'],
      extra_prompt: '只要本节的',
      secondary_review_enabled: false,
      ai_call_log_id: 'log-image-source',
      generated_at: '2026-06-12T00:00:00',
      generation_mode: 'image_batch',
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
    mini_palace_id: null,
    origin_question_id: 11,
    mini_palace: null,
    source_meta: {
      source_kind: 'manual',
      page_numbers: null,
      image_names: null,
      extra_prompt: '',
      ai_call_log_id: null,
      generated_at: '2026-06-12T00:00:00',
      generation_mode: 'manual',
    },
    segment_ids: [21],
    sort_order: 3,
    correct_count: 0,
    incorrect_count: 0,
    attempt_count: 0,
    created_at: '2026-06-12T00:00:00',
    updated_at: '2026-06-12T00:00:00',
  },
]

export function renderPage(
  initialEntry = '/palaces/1/quiz',
  routePath = '/palaces/:id/quiz',
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path={routePath} element={<PalaceQuizPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

export const workspaceQuestion = {
  question_type: 'multiple_choice' as const,
  stem: '细胞的控制中心是？',
  options: [{ id: 'A', text: '细胞膜' }, { id: 'B', text: '细胞核' }],
  answer_payload: { correct_option_id: 'B' },
  analysis: '细胞核控制细胞活动。',
  source_meta: { ...baseQuestions[0].source_meta, source_kind: 'workspace', generation_mode: 'workspace' },
}

export function buildWorkspaceJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1', palace_id: 1, selected_chapter_id: 1, status: 'draft',
    title: '细胞生物学宫殿题库生成', extra_prompt: '', options: {},
    matching_items: [], preview: null, error_message: '', sources: [],
    created_at: '2026-07-10T00:00:00', updated_at: '2026-07-10T00:00:00',
    ...overrides,
  }
}

export function setupPalaceQuizPageTest() {
  vi.clearAllMocks()
  vi.stubGlobal('confirm', vi.fn(() => true))
  window.localStorage.clear()
  const emptyJob = buildWorkspaceJob()
  listQuizGenerationJobsApiMock.mockResolvedValue({ items: [] })
  listQuizPdfAssetsApiMock.mockResolvedValue({ items: [{ id: 7, name: '生物题库', original_name: 'biology.pdf', file_size: 1048576, page_count: 80, archived: false, created_at: null, updated_at: null }] })
  createQuizGenerationJobApiMock.mockResolvedValue({ item: emptyJob })
  addQuizFileSourceApiMock.mockResolvedValue({ item: {} })
  addQuizTextSourceApiMock.mockResolvedValue({ item: {} })
  addQuizPdfSourceApiMock.mockResolvedValue({ item: {} })
  deleteQuizSourceApiMock.mockResolvedValue({ ok: true })
  reorderQuizSourcesApiMock.mockResolvedValue({ item: emptyJob })
  updateQuizGenerationJobApiMock.mockImplementation(async (_jobId: string, data: Record<string, unknown>) => ({ item: { ...emptyJob, ...data } }))
  extractMatchQuizJobApiMock.mockResolvedValue({ item: buildWorkspaceJob({ status: 'matching_review', matching_items: [{ id: 'match-1', status: 'ai_generated_answer', confidence: 'medium', ignored: false, question: workspaceQuestion, question_text: workspaceQuestion.stem, answer_text: JSON.stringify(workspaceQuestion.answer_payload), answer_generated_by_ai: true }] }) })
  updateQuizMatchingApiMock.mockImplementation(async (_jobId: string, items: unknown[]) => ({ item: buildWorkspaceJob({ status: 'matching_review', matching_items: items }) }))
  generateQuizWorkspacePreviewApiMock.mockResolvedValue({ item: buildWorkspaceJob({ status: 'preview', matching_items: [{ id: 'match-1', status: 'matched', confidence: 'high', ignored: false, question: workspaceQuestion, question_text: workspaceQuestion.stem, answer_text: JSON.stringify(workspaceQuestion.answer_payload), answer_generated_by_ai: false }], preview: { palace_id: 1, questions: [workspaceQuestion], source_meta: { source_kind: 'workspace', generation_mode: 'workspace' }, ai_call_log_id: null, warnings: [], generation_stats: { returned_count: 1, savable_count: 1, skipped_count: 0 }, grouped_questions: null } }) })
  markQuizGenerationJobSavedApiMock.mockResolvedValue({ item: buildWorkspaceJob({ status: 'saved' }) })
  uploadQuizPdfAssetApiMock.mockResolvedValue({ item: { id: 8, name: '新 PDF', original_name: 'new.pdf', file_size: 1, page_count: 3, archived: false, created_at: null, updated_at: null } })
  updateQuizPdfAssetApiMock.mockResolvedValue({ item: {} })
  deleteQuizPdfAssetApiMock.mockResolvedValue({ ok: true })
  deleteQuizGenerationJobApiMock.mockResolvedValue({ ok: true })
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
  getPalacesGroupedApiMock.mockResolvedValue(palaceLookupGroupedResponse)
  getPalaceEditorApiMock.mockImplementation(async (palaceId: number) =>
    buildPalaceEditorResponse(palaceId),
  )
  getPalaceQuizQuestionsApiMock.mockResolvedValue({ items: baseQuestions })
  batchCreateChapterQuizQuestionsApiMock.mockResolvedValue({ items: [] })
  batchCreatePalaceQuizQuestionsApiMock.mockResolvedValue({ items: [] })
  batchDeletePalaceQuizQuestionsApiMock.mockResolvedValue({ ok: true, deleted_count: 0 })
  deletePalaceQuizQuestionApiMock.mockResolvedValue({ ok: true })
  previewPalaceQuizGenerationFromImagesApiMock.mockResolvedValue({
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
              source_kind: 'image_single',
              generation_mode: 'image_single',
              image_names: ['bio-question.png'],
            },
          },
        ],
        source_meta: {
          ...baseQuestions[0].source_meta,
          source_kind: 'image_single',
          generation_mode: 'image_single',
          image_names: ['bio-question.png'],
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
                    source_kind: 'image_single',
                    generation_mode: 'image_single',
                    image_names: ['bio-question.png'],
                  },
                },
              ],
            },
          ],
          unassigned_questions: [],
        },
      })
  previewPalaceQuizGenerationFromTextFilesApiMock.mockResolvedValue({
    palace_id: 1,
    questions: [
      {
        question_type: 'short_answer',
        stem: '简述细胞核的作用。',
        options: [],
        answer_payload: { reference_answer: '储存遗传信息并控制细胞活动。' },
        analysis: '细胞核是细胞活动控制中心。',
        source_chapter_id: 1,
        source_meta: {
          ...baseQuestions[1].source_meta,
          source_kind: 'text_files',
          generation_mode: 'manual_text_pair',
          image_names: ['bio_questions.txt', 'bio_answers.txt'],
        },
      },
    ],
    source_meta: {
      ...baseQuestions[1].source_meta,
      source_kind: 'text_files',
      generation_mode: 'manual_text_pair',
      image_names: ['bio_questions.txt', 'bio_answers.txt'],
    },
    ai_call_log_id: null,
    warnings: [],
    generation_stats: {
      returned_count: 1,
      savable_count: 1,
      skipped_count: 0,
    },
    grouped_questions: null,
  })
  classifyPalaceQuizQuestionsToMiniPalacesApiMock.mockResolvedValue({
    palace_id: 1,
    mini_palace_groups: [
      { mini_palace_id: 21, mini_palace_name: '细胞核迷你宫殿训练', question_count: 1 },
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
  resetPalaceQuizQuestionAttemptsApiMock.mockResolvedValue({ ok: true, reset_count: 1 })
  requestPalaceShortAnswerFeedbackApiMock.mockResolvedValue({
    question_id: 12,
    feedback_text: '你的答案方向是对的，还可以补充遗传稳定性。',
    ai_call_log_id: 'log-12',
  })
}
