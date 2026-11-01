import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearQuizSessionProgress } from '@/modules/quiz/public'
import { ensureFreestyleOverlayQuizApi } from '@/modules/practice/ui/freestyle/api'
import {
  getPalaceQuizQuestionsByIdsApi,
  updatePalaceQuizQuestionApi,
} from '@/modules/quiz/domain/quiz-entity/api'
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
  updatePalaceQuizQuestionApi: vi.fn(),
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
const getPalaceQuizQuestionsByIdsApiMock = vi.mocked(getPalaceQuizQuestionsByIdsApi)
const updatePalaceQuizQuestionApiMock = vi.mocked(updatePalaceQuizQuestionApi)

function multiSelectQuestion(stem: string) {
  return {
    id: 41,
    palace_id: 7,
    sort_order: 1,
    correct_count: 1,
    incorrect_count: 0,
    attempt_count: 1,
    question_type: 'multiple_choice',
    stem,
    options: [
      { id: 'A', text: '甲' },
      { id: 'B', text: '乙' },
      { id: 'C', text: '丙' },
      { id: 'D', text: '丁' },
    ],
    answer_payload: { correct_option_id: 'A', correct_option_ids: ['A', 'C'] },
    analysis: '原解析',
    source_meta: {},
    created_at: null,
    updated_at: null,
  }
}

function overlay() {
  return {
    question_ids: [41, 42],
    current_index: 0,
    completed_ids: [42],
    states: { '41': { resolved: true, correct: true }, '42': { resolved: true, correct: false } },
    quiz_scope: 'cross_palace_random',
    seed: 1,
    scope_signature: 'sig',
    limit_reached: false,
    candidate_count: 2,
  }
}

describe('FreestyleScopeQuizDialog inline question edit', () => {
  beforeEach(() => {
    clearQuizSessionProgress()
    vi.clearAllMocks()
    ensureFreestyleOverlayQuizApiMock.mockResolvedValue({
      round_id: 'round-1',
      plan_version: 1,
      plan: { overlay_quiz: overlay() },
    } as never)
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
      items: [multiSelectQuestion('第 41 题干'), { ...multiSelectQuestion('第 42 题干'), id: 42 }],
      item_count: 2,
    } as never)
    updatePalaceQuizQuestionApiMock.mockResolvedValue({
      item: { ...multiSelectQuestion('改好的题干'), correct_count: 0, incorrect_count: 0 },
    } as never)
  })

  it('edits the current question inside the dialog and keeps its multi-select answer', async () => {
    renderScopeQuizDialog()

    expect(await screen.findByText('第 41 题干')).toBeTruthy()
    expect(screen.getByText('已答对')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '编辑本题' }))
    const stemField = screen.getByLabelText('题干') as HTMLTextAreaElement
    expect(stemField.value).toBe('第 41 题干')
    // Correct options survive opening the editor, multi-select included.
    expect(
      (screen.getByLabelText('选项 A 是正确答案') as HTMLElement).getAttribute('data-state'),
    ).toBe('checked')
    expect(
      (screen.getByLabelText('选项 C 是正确答案') as HTMLElement).getAttribute('data-state'),
    ).toBe('checked')
    // Paging is locked so the draft cannot be thrown away by a click.
    expect((screen.getByRole('button', { name: '下一题' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(stemField, { target: { value: '改好的题干' } })
    fireEvent.click(screen.getByRole('button', { name: '保存题目' }))

    await waitFor(() => expect(updatePalaceQuizQuestionApiMock).toHaveBeenCalledTimes(1))
    expect(updatePalaceQuizQuestionApiMock).toHaveBeenCalledWith(
      41,
      expect.objectContaining({
        stem: '改好的题干',
        answer_payload: { correct_option_ids: ['A', 'C'] },
      }),
    )

    // The window shows the new text, and the old answer is gone: the question
    // can be taken again instead of staying 「已答对」 on stale content.
    expect(await screen.findByText('改好的题干')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('已答对')).toBeNull())
    expect(screen.queryByTestId('quiz-question-edit-form')).toBeNull()
  })

  it('cancels without saving and unlocks paging', async () => {
    renderScopeQuizDialog()

    expect(await screen.findByText('第 41 题干')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '编辑本题' }))
    fireEvent.change(screen.getByLabelText('题干'), { target: { value: '不保存的改动' } })
    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }))

    expect(screen.queryByTestId('quiz-question-edit-form')).toBeNull()
    expect(screen.getByText('第 41 题干')).toBeTruthy()
    expect(updatePalaceQuizQuestionApiMock).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: '下一题' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
