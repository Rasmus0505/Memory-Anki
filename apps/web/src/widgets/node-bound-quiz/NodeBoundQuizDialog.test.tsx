import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NodeBoundQuizDialog } from '@/widgets/node-bound-quiz'

const getPalaceQuizQuestionsByIdsApiMock = vi.fn()
const getPalaceQuizQuestionsApiMock = vi.fn()
const listPalaceQuizNodeBindingsApiMock = vi.fn()

vi.mock('@/modules/settings/public', () => ({
  useAiRunConfigDialog: () => ({
    promptForAiOptions: vi.fn(),
    aiRunConfigDialog: null,
  }),
}))

vi.mock('@/modules/quiz/domain/quiz-entity/api', () => ({
  getPalaceQuizQuestionsByIdsApi: (...args: unknown[]) => getPalaceQuizQuestionsByIdsApiMock(...args),
  getPalaceQuizQuestionsApi: (...args: unknown[]) => getPalaceQuizQuestionsApiMock(...args),
  listPalaceQuizNodeBindingsApi: (...args: unknown[]) => listPalaceQuizNodeBindingsApiMock(...args),
}))

vi.mock('@/shared/feedback/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/shared/feedback/globalFeedbackModel', () => ({
  dispatchGlobalFeedback: vi.fn(),
}))

const sampleQuestion = {
  id: 42,
  palace_id: 1,
  sort_order: 0,
  correct_count: 0,
  incorrect_count: 0,
  attempt_count: 0,
  last_attempt_at: null,
  segment_ids: [],
  question_type: 'multiple_choice' as const,
  stem: '下列哪一项是细胞膜的主要成分？',
  options: [
    { id: 'A', text: '磷脂' },
    { id: 'B', text: '纤维素' },
    { id: 'C', text: '淀粉' },
    { id: 'D', text: '糖原' },
  ],
  answer_payload: { correct_option_id: 'A' },
  analysis: '细胞膜主要由磷脂双分子层构成。',
  source_meta: {
    source_kind: 'manual',
    page_numbers: null,
    image_names: null,
    extra_prompt: '',
    ai_call_log_id: null,
    generated_at: '2026-07-26T00:00:00',
    generation_mode: 'manual',
  },
}

describe('NodeBoundQuizDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({ items: [sampleQuestion], item_count: 1 })
    getPalaceQuizQuestionsApiMock.mockResolvedValue({ items: [sampleQuestion] })
    listPalaceQuizNodeBindingsApiMock.mockResolvedValue({
      items: [
        {
          question_id: 42,
          node_uid: 'node-1',
          palace_id: 1,
          question_owner_palace_id: 1,
        },
      ],
      item_count: 1,
    })
  })

  it('renders the question stem above the options', async () => {
    render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={1}
        nodeUid="node-1"
        questionIds={[42]}
        onQuestionCompleted={() => {}}
      />,
    )

    const stem = await screen.findByText('下列哪一项是细胞膜的主要成分？')
    expect(stem).toBeTruthy()
    expect(stem.closest('button')).toBeNull()
    expect(screen.getByText('选择题')).toBeTruthy()
    expect(screen.getByRole('button', { name: /磷脂/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /纤维素/ })).toBeTruthy()
  })
})
