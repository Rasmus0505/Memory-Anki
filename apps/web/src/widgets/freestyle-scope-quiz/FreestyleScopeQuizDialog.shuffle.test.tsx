import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearQuizSessionProgress } from '@/modules/quiz/public'
import {
  ensureFreestyleOverlayQuizApi,
  shuffleFreestyleOverlayQuizApi,
} from '@/modules/practice/ui/freestyle/api'
import { getPalaceQuizQuestionsByIdsApi } from '@/modules/quiz/domain/quiz-entity/api'
import { renderScopeQuizDialog } from './FreestyleScopeQuizDialog.testHelpers'

vi.mock('@/modules/practice/public', () => ({
  createOperationId: () => 'op-1',
}))

vi.mock('@/modules/practice/ui/freestyle/api', () => ({
  ensureFreestyleOverlayQuizApi: vi.fn(),
  progressFreestyleOverlayQuizApi: vi.fn(),
  shuffleFreestyleOverlayQuizApi: vi.fn(),
}))

vi.mock('@/modules/quiz/domain/quiz-entity/api', () => ({
  getPalaceQuizQuestionsByIdsApi: vi.fn(),
  listQuestionNodeBindingsApi: vi.fn(),
  deletePalaceQuizQuestionApi: vi.fn(async () => ({ ok: true })),
  setPalaceQuizQuestionMarkedApi: vi.fn(async (id: number, marked: boolean) => ({
    item: { id, marked },
  })),
}))

vi.mock('@/modules/settings/public', () => ({
  useAiRunConfigDialog: () => ({ promptForAiOptions: vi.fn(), aiRunConfigDialog: null }),
}))

vi.mock('@/modules/content/public', () => ({
  getPalacesGroupedApi: vi.fn(async () => ({ groups: [], ungrouped: [], subjects: [] })),
}))

vi.mock('@/widgets/palace-memory-lookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/widgets/palace-memory-lookup')>()
  return { ...actual, PalaceMemoryLookupDialog: () => null }
})

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

const ensureFreestyleOverlayQuizApiMock = vi.mocked(ensureFreestyleOverlayQuizApi)
const shuffleFreestyleOverlayQuizApiMock = vi.mocked(shuffleFreestyleOverlayQuizApi)
const getPalaceQuizQuestionsByIdsApiMock = vi.mocked(getPalaceQuizQuestionsByIdsApi)

function question(id: number, stem: string) {
  return {
    id,
    palace_id: 7,
    sort_order: id,
    correct_count: 0,
    incorrect_count: 0,
    attempt_count: 0,
    question_type: 'multiple_choice',
    stem,
    options: [{ id: 'A', text: 'A' }],
    answer_payload: { correct_option_id: 'A' },
    analysis: '',
    source_meta: {},
    created_at: null,
    updated_at: null,
  }
}

function overlay(questionIds: number[], currentIndex: number) {
  return {
    question_ids: questionIds,
    current_index: currentIndex,
    completed_ids: [41],
    states: { '41': { resolved: true } },
    quiz_scope: 'cross_palace_random',
    seed: 1,
    scope_signature: 'sig',
    limit_reached: false,
    candidate_count: 3,
  }
}

describe('FreestyleScopeQuizDialog 打乱题库', () => {
  beforeEach(() => {
    clearQuizSessionProgress()
    vi.clearAllMocks()
    ensureFreestyleOverlayQuizApiMock.mockResolvedValue({
      round_id: 'round-1',
      plan_version: 1,
      plan: { overlay_quiz: overlay([41, 42, 43], 0) },
    } as never)
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
      items: [question(41, '第 41 题干'), question(42, '第 42 题干'), question(43, '第 43 题干')],
      item_count: 3,
    } as never)
  })

  it('rewrites the round order on the server and resumes at the first open question', async () => {
    shuffleFreestyleOverlayQuizApiMock.mockResolvedValue({
      round_id: 'round-1',
      plan_version: 2,
      plan: { overlay_quiz: overlay([41, 43, 42], 1) },
    } as never)

    renderScopeQuizDialog()

    expect(await screen.findByText('第 41 题干')).toBeTruthy()
    expect(screen.getByRole('button', { name: '打乱题库' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '打乱题库' }))
    await waitFor(() => expect(shuffleFreestyleOverlayQuizApiMock).toHaveBeenCalledTimes(1))
    const [roundId, payload] = shuffleFreestyleOverlayQuizApiMock.mock.calls[0]
    expect(roundId).toBe('round-1')
    expect(payload.expected_version).toBe(1)
    expect(payload.operation_id).toEqual(expect.any(String))
    expect(await screen.findByText('第 43 题干')).toBeTruthy()
  })

  it('hides the button when the round holds a single question', async () => {
    ensureFreestyleOverlayQuizApiMock.mockResolvedValue({
      round_id: 'round-1',
      plan_version: 1,
      plan: { overlay_quiz: overlay([41], 0) },
    } as never)
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
      items: [question(41, '第 41 题干')],
      item_count: 1,
    } as never)

    renderScopeQuizDialog()

    expect(await screen.findByText('第 41 题干')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '打乱题库' })).toBeNull()
  })
})
