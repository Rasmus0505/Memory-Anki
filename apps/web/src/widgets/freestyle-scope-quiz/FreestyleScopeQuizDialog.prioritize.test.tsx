// Must be imported before the widget: it registers the `vi.mock` calls for the
// dialog's module boundaries, and ESM imports run in source order.
import {
  ensureFreestyleOverlayQuizApiMock,
  getPalaceQuizQuestionsByIdsApiMock,
  progressFreestyleOverlayQuizApiMock,
} from './FreestyleScopeQuizDialog.mocks'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearQuizSessionProgress } from '@/modules/quiz/public'
import { toast } from '@/shared/feedback/toast'
import { renderScopeQuizDialog } from './FreestyleScopeQuizDialog.testHelpers'

const overlayQuiz = {
  question_ids: [42],
  current_index: 0,
  completed_ids: [],
  states: {},
  quiz_scope: 'cross_palace_random',
  seed: 1,
  scope_signature: 'sig',
  limit_reached: false,
  candidate_count: 1,
  kind_counts: { objective: 1, subjective: 0 },
}

const question = {
  id: 42,
  palace_id: 7,
  sort_order: 42,
  correct_count: 0,
  incorrect_count: 0,
  attempt_count: 0,
  question_type: 'multiple_choice',
  stem: '第 42 题干',
  options: [{ id: 'A', text: 'A' }],
  answer_payload: { correct_option_id: 'A' },
  analysis: '',
  source_meta: {},
  created_at: null,
  updated_at: null,
}

describe('FreestyleScopeQuizDialog 错题优先', () => {
  beforeEach(() => {
    clearQuizSessionProgress()
    vi.clearAllMocks()
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({ items: [question], item_count: 1 } as never)
    ensureFreestyleOverlayQuizApiMock.mockResolvedValue({
      round_id: 'round-1',
      plan_version: 2,
      plan: { overlay_quiz: overlayQuiz },
    } as never)
    progressFreestyleOverlayQuizApiMock.mockResolvedValue({
      round_id: 'round-1',
      plan_version: 3,
      wrong_priority: { unit_count: 2, palace_count: 1 },
      plan: { overlay_quiz: overlayQuiz },
    } as never)
  })

  it('reports how many units and palaces the switch hoisted', async () => {
    const successSpy = vi.spyOn(toast, 'success').mockImplementation(() => 'toast')
    renderScopeQuizDialog({ wrongUnitIds: ['unit-1'] })

    expect(await screen.findByText('第 42 题干')).toBeTruthy()
    const toggle = screen.getByRole('button', { name: '错题优先' })
    // Another spec may have left the persisted preference on.
    if (toggle.getAttribute('aria-pressed') === 'true') fireEvent.click(toggle)
    fireEvent.click(toggle)

    await waitFor(() => expect(successSpy).toHaveBeenCalledWith(
      '错题优先：已把 2 个复习单元提前，涉及 1 个宫殿',
    ))
    expect(progressFreestyleOverlayQuizApiMock).toHaveBeenCalledWith(
      'round-1',
      expect.objectContaining({ auto_prioritize_wrong_palaces: true }),
    )
    successSpy.mockRestore()
  })
})
