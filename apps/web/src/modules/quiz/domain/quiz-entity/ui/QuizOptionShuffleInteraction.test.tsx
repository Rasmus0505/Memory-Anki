import { createRef, useState } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PalaceQuizQuestion, PalaceQuizQuestionDraft } from '@/shared/api/contracts'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { saveQuizAnswerMode } from '../model/quizAnswerModeSettings'
import { resetQuizOptionAutoShufflePendingForTest } from '../model/quizOptionShuffle'
import { saveQuizOptionShuffleSettings } from '../model/quizOptionShuffleSettings'
import type { QuizRuntimeState } from '../model/quizRuntime'
import type { QuizOptionShuffleActions } from '../model/quizOptionShuffle'
import { QuizQuestionInteraction } from './QuizQuestionInteraction'

const question = {
  id: 12,
  question_type: 'multiple_choice',
  stem: '选择答案',
  options: [{ id: 'A', text: '甲' }, { id: 'B', text: '乙' }, { id: 'C', text: '丙' }],
  answer_payload: { correct_option_id: 'A' },
  analysis: '',
  source_meta: { source_kind: 'manual', page_numbers: null, image_names: null, extra_prompt: '', ai_call_log_id: null, generated_at: '2026-06-15', generation_mode: 'manual' },
} as PalaceQuizQuestionDraft & PalaceQuizQuestion

function setup(elapsed = 1000, item = question) {
  const actions = createRef<QuizOptionShuffleActions | null>()
  const resolve = vi.fn()
  function Harness() {
    const [state, setState] = useState<QuizRuntimeState>({})
    return <>
      <button onClick={() => setState({})}>重答</button>
      <QuizQuestionInteraction question={item} state={state} onStateChange={setState}
        onChoiceResolve={resolve} getDurationMs={() => elapsed} optionShuffleActionsRef={actions} />
    </>
  }
  const view = render(<Harness />)
  const optionTexts = () => Array.from(view.container.querySelectorAll('[data-quiz-option-index]')).map((node) => node.textContent)
  return { actions, resolve, optionTexts, ...view }
}

describe('quiz option shuffle interaction', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    resetClientPreferenceCacheForTest()
    resetQuizOptionAutoShufflePendingForTest()
    saveQuizAnswerMode('choice')
    saveQuizOptionShuffleSettings({ enabled: true, thresholdSeconds: 5 })
  })

  it('repeatedly shuffles and restores without changing the answer id', () => {
    const { actions, resolve, optionTexts } = setup(6000)
    const original = optionTexts()
    act(() => actions.current?.shuffle())
    expect(optionTexts()).not.toEqual(original)
    expect(optionTexts().every((text) => !/^[ABC]\./.test(text || ''))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '甲' }))
    expect(resolve).toHaveBeenCalledWith('A', true)
    act(() => actions.current?.shuffle())
    act(() => actions.current?.restore())
    expect(optionTexts()).toEqual(original)
    expect(screen.getByText('回答正确')).toBeTruthy()
  })

  it('keeps the letter gutter so a shuffle never shifts the option text', () => {
    const { actions, optionTexts } = setup(6000)
    const original = optionTexts()
    act(() => actions.current?.shuffle())
    const shuffled = optionTexts()
    expect(shuffled[0]?.startsWith(' ')).toBe(true)
    expect(shuffled).toHaveLength(original.length)
  })

  it('does not reshuffle the answer being read; it applies on the next visit', () => {
    const first = setup()
    const original = first.optionTexts()
    fireEvent.click(screen.getByRole('button', { name: /A\. 甲/ }))
    // The learner is still reading this answer: nothing moves under them.
    expect(first.optionTexts()).toEqual(original)
    first.unmount()
    // Next time the same question is shown, it arrives already shuffled.
    const second = setup()
    expect(second.optionTexts()).not.toEqual(original)
    second.unmount()
  })

  it('waits for multi-select submission and applies on the next visit', () => {
    const multi = { ...question, answer_payload: { correct_option_ids: ['A', 'B'] } }
    const first = setup(1000, multi)
    const original = first.optionTexts()
    fireEvent.click(screen.getByRole('button', { name: /A\. 甲/ }))
    fireEvent.click(screen.getByRole('button', { name: /B\. 乙/ }))
    expect(first.optionTexts().map((s) => s?.replace('已选', ''))).toEqual(original)
    fireEvent.click(within(first.container).getByRole('button', { name: '提交答案' }))
    expect(first.resolve).toHaveBeenCalledWith(['A', 'B'], true)
    expect(first.optionTexts()).toEqual(original)
    first.unmount()
    const second = setup(1000, multi)
    expect(second.optionTexts()).not.toEqual(original)
    second.unmount()
  })

  it('does not mark a pending shuffle at the exact threshold', () => {
    const first = setup(5000)
    const original = first.optionTexts()
    fireEvent.click(screen.getByRole('button', { name: /A\. 甲/ }))
    expect(first.optionTexts()).toEqual(original)
    first.unmount()
    const second = setup(5000)
    expect(second.optionTexts()).toEqual(original)
    second.unmount()
  })
})
