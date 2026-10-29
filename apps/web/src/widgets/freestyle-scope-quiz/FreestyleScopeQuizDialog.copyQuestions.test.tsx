// Must be imported before the widget: it registers the `vi.mock` calls for the
// dialog's module boundaries, and ESM imports run in source order.
import {
  ensureFreestyleOverlayQuizApiMock,
  getPalaceQuizQuestionsByIdsApiMock,
} from './FreestyleScopeQuizDialog.mocks'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearQuizSessionProgress } from '@/modules/quiz/public'
import { renderScopeQuizDialog } from './FreestyleScopeQuizDialog.testHelpers'

describe('FreestyleScopeQuizDialog 复制题目', () => {
  beforeEach(() => {
    clearQuizSessionProgress()
    vi.clearAllMocks()
  })

  it('copies every question in the window with options, answer and analysis', async () => {
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
          stem: '书院教学的基本精神是（　）。',
          options: [
            { id: 'A', text: '分斋教学' },
            { id: 'B', text: '自由讲学' },
          ],
          answer_payload: { correct_option_id: 'B' },
          analysis: '书院以自由讲学为基本精神。',
          source_meta: {},
          created_at: null,
          updated_at: null,
        },
      ],
      item_count: 1,
    } as never)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    renderScopeQuizDialog()

    fireEvent.click(await screen.findByRole('button', { name: '复制题目' }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(writeText.mock.calls.at(-1)?.[0]).toBe([
      '1. 书院教学的基本精神是（　）。',
      '   A. 分斋教学',
      '   B. 自由讲学',
      '   答案：B. 自由讲学',
      '   解析：书院以自由讲学为基本精神。',
    ].join('\n'))
  })
})
