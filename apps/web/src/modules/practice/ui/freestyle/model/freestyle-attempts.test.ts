import { describe, expect, it } from 'vitest'
import type { FreestyleQuizCard } from '@/shared/api/contracts'
import { buildAttemptAnswerPayload } from './freestyle-attempts'

const question = {
  id: 1,
  palace_id: 1,
  question_type: 'multiple_choice' as const,
  stem: '控制中心？',
  options: [
    { id: 'A', text: '细胞膜' },
    { id: 'B', text: '细胞核' },
  ],
  answer_payload: { correct_option_id: 'B' },
  analysis: '',
  source_meta: {
    source_kind: 'manual',
    page_numbers: null,
    image_names: null,
    extra_prompt: '',
    ai_call_log_id: null,
    generated_at: '',
    generation_mode: 'manual',
  },
  sort_order: 1,
  correct_count: 0,
  incorrect_count: 0,
  attempt_count: 0,
  created_at: null,
  updated_at: null,
} satisfies FreestyleQuizCard['question']

describe('buildAttemptAnswerPayload', () => {
  it('stores the selected option for ordinary multiple-choice answers', () => {
    expect(buildAttemptAnswerPayload(question, { selectedOptionId: 'B', resolved: true, correct: true })).toEqual({
      selected_option_id: 'B',
    })
  })

  it('stores free text when a multiple-choice question was answered subjectively', () => {
    expect(
      buildAttemptAnswerPayload(question, {
        shortAnswerText: '细胞核',
        shortAnswerSubmitted: true,
        resolved: true,
      }),
    ).toEqual({ user_answer: '细胞核' })
  })
})
