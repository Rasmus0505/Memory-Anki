import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { QuizQuestionAnswerSurface } from './QuizQuestionAnswerSurface'
import type { PalaceQuizQuestionDraft } from '@/shared/api/contracts'
import type { QuizRuntimeState } from '@/modules/quiz/domain/quiz-entity/model/quizRuntime'

const question: PalaceQuizQuestionDraft = {
  question_type: 'multiple_choice',
  stem: '细胞的控制中心是？',
  options: [
    { id: 'A', text: '细胞膜' },
    { id: 'B', text: '细胞核' },
  ],
  answer_payload: { correct_option_id: 'B' },
  analysis: '细胞核控制细胞活动。',
  source_meta: {
    source_kind: 'manual',
    page_numbers: null,
    image_names: null,
    extra_prompt: '',
    ai_call_log_id: null,
    generated_at: '2026-06-15T00:00:00',
    generation_mode: 'manual',
  },
}

describe('QuizQuestionAnswerSurface', () => {
  it('keeps the stem and answer interaction in one scaled shared surface', () => {
    let state: QuizRuntimeState = {}
    const view = render(
      <QuizQuestionAnswerSurface
        question={question}
        state={state}
        fontScalePercent={120}
        before={<div>题目前置操作</div>}
        after={<div>题目后置操作</div>}
        onStateChange={(updater) => {
          state = updater(state)
        }}
      />,
    )

    expect(screen.getByText('题目前置操作')).toBeTruthy()
    expect(screen.getByText('细胞的控制中心是？')).toBeTruthy()
    expect(screen.getByText('题目后置操作')).toBeTruthy()
    expect((screen.getByTestId('quiz-font-scale-body') as HTMLElement).style.zoom).toBe('120%')

    fireEvent.click(screen.getByRole('button', { name: 'B. 细胞核' }))
    view.rerender(
      <QuizQuestionAnswerSurface
        question={question}
        state={state}
        fontScalePercent={120}
        onStateChange={(updater) => {
          state = updater(state)
        }}
      />,
    )
    expect(screen.getByText('回答正确')).toBeTruthy()
  })
})
