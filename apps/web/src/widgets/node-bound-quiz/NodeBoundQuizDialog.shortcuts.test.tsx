import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveQuizAnswerMode } from '@/modules/quiz/public'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { NodeBoundQuizDialog } from '@/widgets/node-bound-quiz'

const getPalaceQuizQuestionsByIdsApiMock = vi.fn()
const deletePalaceQuizQuestionApiMock = vi.fn()

vi.mock('@/modules/settings/public', () => ({
  useAiRunConfigDialog: () => ({
    promptForAiOptions: vi.fn(),
    aiRunConfigDialog: null,
  }),
}))

vi.mock('@/modules/quiz/domain/quiz-entity/api', () => ({
  getPalaceQuizQuestionsByIdsApi: (...args: unknown[]) => getPalaceQuizQuestionsByIdsApiMock(...args),
  getPalaceQuizQuestionsApi: vi.fn(async () => ({ items: [] })),
  listPalaceQuizNodeBindingsApi: vi.fn(async () => ({ items: [], item_count: 0 })),
  recordPalaceQuizChoiceAttemptApi: vi.fn(async () => ({ question: { id: 42 } })),
  setPalaceQuizQuestionMarkedApi: vi.fn(async () => ({ ok: true })),
  deletePalaceQuizQuestionApi: (...args: unknown[]) => deletePalaceQuizQuestionApiMock(...args),
}))

vi.mock('@/shared/feedback/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/shared/feedback/globalFeedbackModel', () => ({
  dispatchGlobalFeedback: vi.fn(),
}))

vi.mock('@/widgets/palace-memory-lookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/widgets/palace-memory-lookup')>()
  return {
    ...actual,
    PalaceMemoryLookupDialog: () => null,
  }
})

const firstQuestion = {
  id: 42,
  palace_id: 1,
  sort_order: 0,
  correct_count: 1,
  incorrect_count: 0,
  attempt_count: 1,
  last_attempt_at: null,
  segment_ids: [],
  question_type: 'multiple_choice' as const,
  stem: '第一题题干',
  options: [
    { id: 'A', text: '正确项' },
    { id: 'B', text: '错误项' },
  ],
  answer_payload: { correct_option_id: 'A' },
  analysis: '解析',
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

const secondQuestion = {
  ...firstQuestion,
  id: 43,
  stem: '第二题题干',
}

describe('NodeBoundQuizDialog shortcuts', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
    saveQuizAnswerMode('choice')
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
      items: [firstQuestion, secondQuestion],
      item_count: 2,
    })
    deletePalaceQuizQuestionApiMock.mockResolvedValue({ ok: true })
  })

  it('advances with Enter after the answer is visible', async () => {
    render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={1}
        nodeUid="node-1"
        questionIds={[42, 43]}
        onQuestionCompleted={() => {}}
      />,
    )

    await screen.findByText('第一题题干')
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
    expect(screen.getByText('回答正确')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' })
    expect(await screen.findByText('第二题题干')).toBeTruthy()
  })

  it('opens delete from Backspace and confirms it with Enter', async () => {
    render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={1}
        nodeUid="node-1"
        questionIds={[42, 43]}
        onQuestionCompleted={() => {}}
      />,
    )

    await screen.findByText('第一题题干')
    fireEvent.keyDown(window, { key: 'Backspace', code: 'Backspace' })
    expect(screen.getByRole('button', { name: '移入回收站' })).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' })
    await waitFor(() => {
      expect(deletePalaceQuizQuestionApiMock).toHaveBeenCalledWith(42)
      expect(screen.getByText('第二题题干')).toBeTruthy()
    })
  })
})
