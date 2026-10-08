import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { NodeBoundQuizDialog } from '@/widgets/node-bound-quiz'

/**
 * Shared harness for the `NodeBoundQuizDialog` specs.
 *
 * The widget resolves its questions, bindings, palace lookup and preferences
 * through five different module boundaries, so every spec file needs the same
 * module mocks and the same sample questions. Keeping one copy here means a
 * change to one of those contracts is fixed once instead of per spec file.
 *
 * The specs are split by concern (interaction vs. window/destructive actions)
 * rather than by fixture, which is why this exists at all.
 */

export const getPalaceQuizQuestionsByIdsApiMock = vi.fn()
export const getPalaceQuizQuestionsApiMock = vi.fn()
export const listPalaceQuizNodeBindingsApiMock = vi.fn()
export const recordPalaceQuizChoiceAttemptApiMock = vi.fn()
export const setPalaceQuizQuestionMarkedApiMock = vi.fn()
export const deletePalaceQuizQuestionApiMock = vi.fn()

// These mock factories read the mock fns declared above. Vitest hoists the
// `vi.mock` calls above the imports in a spec, but a factory body only runs when
// the module is first imported, by which point these bindings are initialised.
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
  recordPalaceQuizChoiceAttemptApi: (...args: unknown[]) => recordPalaceQuizChoiceAttemptApiMock(...args),
  setPalaceQuizQuestionMarkedApi: (...args: unknown[]) => setPalaceQuizQuestionMarkedApiMock(...args),
  deletePalaceQuizQuestionApi: (...args: unknown[]) => deletePalaceQuizQuestionApiMock(...args),
}))

vi.mock('@/shared/feedback/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

/** This-round ratings as the backend would return them for the sample questions. */
/** This-round ratings as the backend would return them for the sample questions. */
export const useRoundQuestionRatingsMock = vi.fn(
  (_args: { roundId?: string | null; enabled?: boolean }): Record<string, number> | null => null,
)

vi.mock('@/modules/practice/ui/freestyle/hooks/useRoundQuestionRatings', () => ({
  useRoundQuestionRatings: (args: { roundId?: string | null; enabled?: boolean }) =>
    useRoundQuestionRatingsMock(args),
}))

vi.mock('@/shared/feedback/globalFeedbackModel', () => ({
  dispatchGlobalFeedback: vi.fn(),
}))

vi.mock('@/modules/content/public', () => ({
  getPalacesGroupedApi: vi.fn(async () => ({
    groups: [],
    ungrouped: [],
    subjects: [{
      subject: null,
      chapter_groups: [],
      ungrouped_palaces: [{ id: 1, title: '第一节', resolved_title: '第一节新教育运动' }],
    }],
  })),
}))

vi.mock('@/widgets/palace-memory-lookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/widgets/palace-memory-lookup')>()
  return {
    ...actual,
    PalaceMemoryLookupDialog: ({
      open,
      onOpenChange,
      currentPalaceId,
      focusNodeUid,
    }: {
      open: boolean
      onOpenChange: (open: boolean) => void
      currentPalaceId: number | null
      focusNodeUid?: string | null
    }) =>
      open ? (
        <div
          data-testid="palace-memory-lookup"
          data-palace-id={String(currentPalaceId)}
          data-focus-node={String(focusNodeUid ?? '')}
        >
          <button type="button" onClick={() => onOpenChange(false)}>
            关闭宫殿查看
          </button>
        </div>
      ) : null,
  }
})

export const sampleQuestion = {
  id: 42,
  palace_id: 1,
  sort_order: 0,
  correct_count: 16,
  incorrect_count: 13,
  attempt_count: 29,
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

export const secondQuestion = {
  ...sampleQuestion,
  id: 43,
  stem: '第二道关联题目',
}

export const shortAnswerQuestion = {
  ...sampleQuestion,
  id: 41,
  sort_order: 0,
  question_type: 'short_answer' as const,
  stem: '简述细胞膜的主要成分。',
  options: [],
  answer_payload: { reference_answer: '磷脂双分子层。' },
}

/** The resolved question set every spec starts from. */
export function primeQuestionMocks() {
  getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
    items: [sampleQuestion, secondQuestion],
    item_count: 2,
  })
  getPalaceQuizQuestionsApiMock.mockResolvedValue({ items: [sampleQuestion, secondQuestion] })
  recordPalaceQuizChoiceAttemptApiMock.mockImplementation(async (questionId: number) => ({
    question: questionId === secondQuestion.id ? secondQuestion : sampleQuestion,
  }))
  deletePalaceQuizQuestionApiMock.mockResolvedValue({ ok: true })
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
}

export function renderDialog(props: {
  questionIds?: number[]
  palaceId?: number
  nodeUid?: string
  onQuestionCompleted?: () => void
  roundId?: string | null
} = {}) {
  return render(
    <NodeBoundQuizDialog
      open
      onOpenChange={() => {}}
      palaceId={props.palaceId ?? 1}
      nodeUid={props.nodeUid ?? 'node-1'}
      questionIds={props.questionIds ?? [42]}
      onQuestionCompleted={props.onQuestionCompleted ?? (() => {})}
      roundId={props.roundId ?? null}
    />,
  )
}
