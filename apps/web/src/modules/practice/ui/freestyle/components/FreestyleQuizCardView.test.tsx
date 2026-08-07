import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FreestyleQuizCard } from '@/shared/api/contracts'
import { FreestyleQuizCardView } from './FreestyleQuizCardView'

const card = {
  id: 'quiz:1',
  type: 'quiz_question',
  content_type: 'quiz_question',
  palace_context: { id: 1, title: '测试宫殿' },
  group_key: 'palace:1',
  question: {
    id: 1,
    palace_id: 1,
    question_type: 'multiple_choice',
    stem: '测试题',
    options: [
      { id: 'A', text: '选项 A' },
      { id: 'B', text: '选项 B' },
      { id: 'C', text: '选项 C' },
      { id: 'D', text: '选项 D' },
    ],
    answer_payload: { correct_option_id: 'C' },
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
  },
} satisfies FreestyleQuizCard

function renderCard(state: Record<string, unknown> = {}, active = true) {
  const onStateChange = vi.fn()
  const onChoiceResolve = vi.fn()
  render(
    <FreestyleQuizCardView
      card={card}
      state={state}
      answeredBefore={false}
      active={active}
      onStateChange={onStateChange}
      onChoiceResolve={onChoiceResolve}
      onShortAnswerSubmit={vi.fn()}
      onRequestShortAnswerFeedback={vi.fn()}
    />,
  )
  return { onStateChange, onChoiceResolve }
}

describe('FreestyleQuizCardView keyboard shortcuts', () => {
  it('answers the active question with number and letter keys', () => {
    const { onStateChange, onChoiceResolve } = renderCard()

    fireEvent.keyDown(window, { key: '2' })
    fireEvent.keyDown(window, { key: 'C' })

    expect(onStateChange).toHaveBeenCalledTimes(2)
    expect(onStateChange.mock.calls[0]?.[0]({})).toMatchObject({
      selectedOptionId: 'B',
      resolved: true,
      correct: false,
    })
    expect(onStateChange.mock.calls[1]?.[0]({})).toMatchObject({
      selectedOptionId: 'C',
      resolved: true,
      correct: true,
    })
    expect(onChoiceResolve).toHaveBeenNthCalledWith(1, 'B', false)
    expect(onChoiceResolve).toHaveBeenNthCalledWith(2, 'C', true)
  })

  it('moves through choices with vertical arrows and confirms with Enter', () => {
    const { onChoiceResolve } = renderCard()

    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(onChoiceResolve).toHaveBeenCalledWith('C', true)
  })

  it('does not answer inactive, resolved, or text-entry states', () => {
    const inactive = renderCard({}, false)
    fireEvent.keyDown(window, { key: '1' })
    expect(inactive.onChoiceResolve).not.toHaveBeenCalled()

    const resolved = renderCard({ resolved: true })
    fireEvent.keyDown(window, { key: '1' })
    expect(resolved.onChoiceResolve).not.toHaveBeenCalled()

    const active = renderCard()
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: '1' })
    input.remove()
    expect(active.onChoiceResolve).not.toHaveBeenCalled()
  })
})
