import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FreestyleQuizCard } from '@/shared/api/contracts'
import { saveQuizAnswerMode } from '@/modules/quiz/public'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { FreestyleQuizCardView } from './FreestyleQuizCardView'

const cueMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/fx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/fx')>()
  return { ...actual, cue: cueMock }
})

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
    correct_count: 16,
    incorrect_count: 13,
    attempt_count: 29,
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
    />,
  )
  return { onStateChange, onChoiceResolve }
}

describe('FreestyleQuizCardView', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
    saveQuizAnswerMode('choice')
  })

  afterEach(() => {
    saveQuizAnswerMode('choice')
  })

  /**
   * The feed's visual index moves the moment a page turn starts, so the answer a
   * learner taps on a still-settling card used to lose its cue entirely.
   */
  it('plays the answer cue even when the card is no longer the active page', () => {
    cueMock.mockClear()
    const props = {
      card,
      answeredBefore: false,
      active: false,
      onStateChange: vi.fn(),
      onChoiceResolve: vi.fn(),
      onShortAnswerSubmit: vi.fn(),
    }
    const view = render(<FreestyleQuizCardView {...props} state={{}} />)
    cueMock.mockClear()
    view.rerender(
      <FreestyleQuizCardView
        {...props}
        state={{ selectedOptionId: 'C', resolved: true, correct: true }}
      />,
    )

    expect(cueMock).toHaveBeenCalledWith(
      'answer.correct',
      expect.objectContaining({ paper: expect.anything() }),
    )
  })

  it('shows historical attempt stats left of the question type badge', () => {
    renderCard()
    const stats = screen.getByTestId('quiz-attempt-stats')
    expect(stats.textContent).toBe('16/29')
    expect(stats.nextElementSibling?.textContent).toBe('选择题')
  })

  it('answers the active question with number and letter keys', () => {
    const { onStateChange, onChoiceResolve } = renderCard()

    fireEvent.keyDown(window, { key: '2', code: 'Digit2' })
    fireEvent.keyDown(window, { key: 'C', code: 'KeyC' })

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

    fireEvent.keyDown(window, { key: 'ArrowDown', code: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowDown', code: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' })

    expect(onChoiceResolve).toHaveBeenCalledWith('C', true)
  })

  it('turns to the next card with Enter once the answer is on screen', () => {
    const onRequestNext = vi.fn()
    const onChoiceResolve = vi.fn()
    render(
      <FreestyleQuizCardView
        card={card}
        state={{ selectedOptionId: 'C', resolved: true, correct: true }}
        answeredBefore={false}
        active
        onStateChange={vi.fn()}
        onChoiceResolve={onChoiceResolve}
        onShortAnswerSubmit={vi.fn()}
        onRequestNext={onRequestNext}
      />,
    )

    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' })

    expect(onRequestNext).toHaveBeenCalledTimes(1)
    expect(onChoiceResolve).not.toHaveBeenCalled()
  })

  it('does not answer inactive, resolved, or text-entry states', () => {
    const inactive = renderCard({}, false)
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
    expect(inactive.onChoiceResolve).not.toHaveBeenCalled()

    const resolved = renderCard({ resolved: true, selectedOptionId: 'A' })
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
    expect(resolved.onChoiceResolve).not.toHaveBeenCalled()

    const active = renderCard()
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: '1', code: 'Digit1' })
    input.remove()
    expect(active.onChoiceResolve).not.toHaveBeenCalled()
  })

  it('does not use number keys after switching to subjective recall', () => {
    const { onChoiceResolve } = renderCard()
    fireEvent.click(screen.getByRole('button', { name: '主观' }))
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
    fireEvent.keyDown(window, { key: 'A', code: 'KeyA' })
    expect(onChoiceResolve).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('先写下你的答案，再点击提交')).toBeTruthy()
  })

  it('submits subjective recall with Enter after the mode toggle', () => {
    const onShortAnswerSubmit = vi.fn()
    render(
      <FreestyleQuizCardView
        card={card}
        state={{}}
        answeredBefore={false}
        active
        onStateChange={vi.fn()}
        onChoiceResolve={vi.fn()}
        onShortAnswerSubmit={onShortAnswerSubmit}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '主观' }))
    expect(document.activeElement?.hasAttribute('data-quiz-shortcut-surface')).toBe(true)
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter', code: 'Enter' })
    expect(onShortAnswerSubmit).toHaveBeenCalledTimes(1)
  })

  it('restores shortcut focus when the card becomes the active feed item', () => {
    const onChoiceResolve = vi.fn()
    const props = {
      card,
      state: {},
      answeredBefore: false,
      onStateChange: vi.fn(),
      onChoiceResolve,
      onShortAnswerSubmit: vi.fn(),
    }
    const view = render(<FreestyleQuizCardView {...props} active={false} />)
    const leftover = document.createElement('button')
    leftover.textContent = '下一题'
    document.body.appendChild(leftover)
    leftover.focus()
    expect(document.activeElement).toBe(leftover)

    view.rerender(<FreestyleQuizCardView {...props} active />)
    expect(document.activeElement?.hasAttribute('data-quiz-shortcut-surface')).toBe(true)
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter', code: 'Enter' })
    expect(onChoiceResolve).toHaveBeenCalledWith('A', false)
    leftover.remove()
  })
})
