import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FREESTYLE_FEED_CONFIG } from '@/modules/practice/domain/feedConfig'
import {
  ensureFreestyleOverlayQuizApi,
  progressFreestyleOverlayQuizApi,
} from '@/modules/practice/ui/freestyle/api'
import {
  getPalaceQuizQuestionsByIdsApi,
  listQuestionNodeBindingsApi,
} from '@/modules/quiz/domain/quiz-entity/api'
import { FreestyleScopeQuizDialog } from './FreestyleScopeQuizDialog'

vi.mock('@/modules/practice/public', () => ({
  createOperationId: () => 'op-1',
}))

vi.mock('@/modules/practice/ui/freestyle/api', () => ({
  ensureFreestyleOverlayQuizApi: vi.fn(),
  progressFreestyleOverlayQuizApi: vi.fn(),
}))

vi.mock('@/modules/quiz/domain/quiz-entity/api', () => ({
  getPalaceQuizQuestionsByIdsApi: vi.fn(),
  listQuestionNodeBindingsApi: vi.fn(),
}))

vi.mock('@/modules/settings/public', () => ({
  useAiRunConfigDialog: () => ({ promptForAiOptions: vi.fn(), aiRunConfigDialog: null }),
}))

vi.mock('@/modules/quiz/public', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/quiz/public')>()
  return {
    ...actual,
    isQuizChoiceShortcutActive: () => false,
    QuizQuestionInteraction: () => null,
    useQuizAttemptOrchestration: () => ({
      handleChoiceSelect: vi.fn(),
      handleShortAnswerSubmit: vi.fn(),
      handleShortAnswerFeedback: vi.fn(),
    }),
  }
})

vi.mock('@/widgets/palace-memory-lookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/widgets/palace-memory-lookup')>()
  return {
    ...actual,
    PalaceMemoryLookupDialog: ({
      open,
      currentPalaceId,
      focusNodeUid,
    }: {
      open: boolean
      currentPalaceId?: number | null
      focusNodeUid?: string | null
    }) =>
      open ? (
        <div
          data-testid="palace-memory-lookup"
          data-palace-id={String(currentPalaceId ?? '')}
          data-focus-node={String(focusNodeUid ?? '')}
        />
      ) : null,
  }
})

const ensureFreestyleOverlayQuizApiMock = vi.mocked(ensureFreestyleOverlayQuizApi)
const progressFreestyleOverlayQuizApiMock = vi.mocked(progressFreestyleOverlayQuizApi)
const getPalaceQuizQuestionsByIdsApiMock = vi.mocked(getPalaceQuizQuestionsByIdsApi)
const listQuestionNodeBindingsApiMock = vi.mocked(listQuestionNodeBindingsApi)

describe('FreestyleScopeQuizDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    progressFreestyleOverlayQuizApiMock.mockResolvedValue({} as never)
  })

  it('asks for palace order before the first session', () => {
    const onConfirmSetup = vi.fn()
    render(
      <FreestyleScopeQuizDialog
        open
        onOpenChange={vi.fn()}
        roundId="round-1"
        planVersion={1}
        storedConfig={DEFAULT_FREESTYLE_FEED_CONFIG}
        setupDone={false}
        rangeLabel="当前配置下的全部宫殿"
        onConfirmSetup={onConfirmSetup}
        onRoundSync={vi.fn()}
      />,
    )

    expect(screen.getByTestId('freestyle-scope-quiz-dialog')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /跨宫殿乱序/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /一个宫殿刷完再换/ }))
    fireEvent.click(screen.getByRole('button', { name: '开始做题' }))
    expect(onConfirmSetup).toHaveBeenCalledWith('single_palace_random')
  })

  it('opens palace lookup centered on the current question binding', async () => {
    ensureFreestyleOverlayQuizApiMock.mockResolvedValue({
      round_id: 'round-1',
      plan_version: 1,
      plan: {
        overlay_quiz: {
          question_ids: [42],
          current_index: 0,
          completed_ids: [],
          states: {},
          quiz_scope: 'cross_palace_random',
          seed: 1,
          scope_signature: 'sig',
          limit_reached: false,
          candidate_count: 1,
        },
      },
    } as never)
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
      items: [
        {
          id: 42,
          palace_id: 7,
          sort_order: 0,
          correct_count: 16,
          incorrect_count: 13,
          attempt_count: 29,
          question_type: 'multiple_choice',
          stem: '本题绑定节点',
          options: [{ id: 'A', text: 'A' }],
          answer_payload: { correct_option_id: 'A' },
          analysis: '',
          source_meta: {},
          created_at: null,
          updated_at: null,
        },
      ],
      item_count: 1,
    } as never)
    listQuestionNodeBindingsApiMock.mockResolvedValue({
      question_id: 42,
      items: [{ question_id: 42, node_uid: 'bound-9', palace_id: 7, target_palace_id: 7 }],
      item_count: 1,
    })

    render(
      <FreestyleScopeQuizDialog
        open
        onOpenChange={vi.fn()}
        roundId="round-1"
        planVersion={1}
        storedConfig={DEFAULT_FREESTYLE_FEED_CONFIG}
        setupDone
        rangeLabel="当前配置下的全部宫殿"
        onConfirmSetup={vi.fn()}
        onRoundSync={vi.fn()}
      />,
    )

    expect(await screen.findByRole('button', { name: '查看宫殿' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看宫殿' }))
    await waitFor(() => {
      const lookup = screen.getByTestId('palace-memory-lookup')
      expect(lookup.getAttribute('data-palace-id')).toBe('7')
      expect(lookup.getAttribute('data-focus-node')).toBe('bound-9')
    })
  })

  it('shows historical attempt stats left of the question type badge', async () => {
    ensureFreestyleOverlayQuizApiMock.mockResolvedValue({
      round_id: 'round-1',
      plan_version: 1,
      plan: {
        overlay_quiz: {
          question_ids: [42],
          current_index: 0,
          completed_ids: [],
          states: {},
          quiz_scope: 'cross_palace_random',
          seed: 1,
          scope_signature: 'sig',
          limit_reached: false,
          candidate_count: 1,
        },
      },
    } as never)
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
      items: [
        {
          id: 42,
          palace_id: 7,
          sort_order: 0,
          correct_count: 16,
          incorrect_count: 13,
          attempt_count: 29,
          question_type: 'multiple_choice',
          stem: '本题绑定节点',
          options: [{ id: 'A', text: 'A' }],
          answer_payload: { correct_option_id: 'A' },
          analysis: '',
          source_meta: {},
          created_at: null,
          updated_at: null,
        },
      ],
      item_count: 1,
    } as never)

    render(
      <FreestyleScopeQuizDialog
        open
        onOpenChange={vi.fn()}
        roundId="round-1"
        planVersion={1}
        storedConfig={DEFAULT_FREESTYLE_FEED_CONFIG}
        setupDone
        rangeLabel="当前配置下的全部宫殿"
        onConfirmSetup={vi.fn()}
        onRoundSync={vi.fn()}
      />,
    )

    const stats = await screen.findByTestId('quiz-attempt-stats')
    const typeBadge = screen.getByText('选择题')
    expect(stats.textContent).toBe('16/29')
    expect(
      stats.compareDocumentPosition(typeBadge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('pages the question index twenty at a time', async () => {
    const questionIds = Array.from({ length: 21 }, (_, index) => index + 1)
    ensureFreestyleOverlayQuizApiMock.mockResolvedValue({
      round_id: 'round-1',
      plan_version: 1,
      plan: {
        overlay_quiz: {
          question_ids: questionIds,
          current_index: 0,
          completed_ids: [],
          states: {},
          quiz_scope: 'cross_palace_random',
          seed: 1,
          scope_signature: 'sig',
          limit_reached: false,
          candidate_count: 21,
        },
      },
    } as never)
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
      items: questionIds.map((id) => ({
        id,
        palace_id: 7,
        sort_order: id,
        correct_count: 0,
        incorrect_count: 0,
        attempt_count: 0,
        question_type: 'multiple_choice',
        stem: `第 ${id} 题干`,
        options: [{ id: 'A', text: 'A' }],
        answer_payload: { correct_option_id: 'A' },
        analysis: '',
        source_meta: {},
        created_at: null,
        updated_at: null,
      })),
      item_count: 21,
    } as never)

    render(
      <FreestyleScopeQuizDialog
        open
        onOpenChange={vi.fn()}
        roundId="round-1"
        planVersion={1}
        storedConfig={DEFAULT_FREESTYLE_FEED_CONFIG}
        setupDone
        rangeLabel="当前配置下的全部宫殿"
        onConfirmSetup={vi.fn()}
        onRoundSync={vi.fn()}
      />,
    )

    expect(await screen.findByRole('button', { name: '1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '20' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '21' })).toBeNull()
    expect(screen.getByText('第 1/2 页（1–20）')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByRole('button', { name: '21' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '1' })).toBeNull()
  })
})
