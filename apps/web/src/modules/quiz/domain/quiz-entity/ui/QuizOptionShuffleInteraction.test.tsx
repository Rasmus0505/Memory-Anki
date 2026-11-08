import { act, useRef, useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PalaceQuizQuestion, PalaceQuizQuestionDraft } from '@/shared/api/contracts'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { saveQuizAnswerMode } from '../model/quizAnswerModeSettings'
import { readQuizOptionShuffleSettings, saveQuizOptionShuffleSettings } from '../model/quizOptionShuffleSettings'
import type { QuizRuntimeState } from '../model/quizRuntime'
import { QuizQuestionInteraction } from './QuizQuestionInteraction'
import { useQuizAnsweringShortcuts } from './useQuizAnsweringShortcuts'

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
  const resolve = vi.fn()
  function Harness() {
    const [state, setState] = useState<QuizRuntimeState>({})
    return <QuizQuestionInteraction question={item} state={state} onStateChange={setState}
      onChoiceResolve={resolve} getDurationMs={() => elapsed} />
  }
  const view = render(<Harness />)
  const optionIds = () => Array.from(view.container.querySelectorAll<HTMLElement>('[data-quiz-option-id]')).map((node) => node.dataset.quizOptionId)
  return { resolve, optionIds, ...view }
}

describe('quiz option shuffle interaction', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    resetClientPreferenceCacheForTest()
    saveQuizAnswerMode('choice')
    saveQuizOptionShuffleSettings({ enabled: true })
  })

  it('shuffles immediately after a slow answer', () => {
    const first = setup(60000)
    const original = first.optionIds()
    fireEvent.click(screen.getByRole('button', { name: /A\. 甲/ }))
    expect(first.resolve).toHaveBeenCalledWith('A', true)
    expect(first.optionIds()).not.toEqual(original)
    first.unmount()
  })

  it('shuffles immediately after a wrong answer too', () => {
    const first = setup(1000)
    const original = first.optionIds()
    fireEvent.click(screen.getByRole('button', { name: /B\. 乙/ }))
    expect(first.resolve).toHaveBeenCalledWith('B', false)
    expect(first.optionIds()).not.toEqual(original)
    first.unmount()
  })

  it('keeps the letter gutter after shuffling so option text never shifts', () => {
    const first = setup()
    const original = first.optionIds()
    fireEvent.click(screen.getByRole('button', { name: /A\. 甲/ }))
    const shuffled = first.optionIds()
    expect(shuffled).not.toEqual(original)
    const gutters = Array.from(first.container.querySelectorAll<HTMLElement>('[data-quiz-option-id] span:first-child'))
    expect(gutters).toHaveLength(3)
    expect(gutters.every((gutter) => gutter.className.includes('w-[1.25rem]'))).toBe(true)
    first.unmount()
  })

  it('waits until multi-select submission, then shuffles immediately', () => {
    const multi = { ...question, answer_payload: { correct_option_ids: ['A', 'B'] } }
    const first = setup(1000, multi)
    const original = first.optionIds()
    fireEvent.click(screen.getByRole('button', { name: /A\. 甲/ }))
    fireEvent.click(screen.getByRole('button', { name: /B\. 乙/ }))
    expect(first.optionIds()).toEqual(original)
    fireEvent.click(within(first.container).getByRole('button', { name: '提交答案' }))
    expect(first.resolve).toHaveBeenCalledWith(['A', 'B'], true)
    expect(first.optionIds()).not.toEqual(original)
    expect(screen.getByText('回答正确')).toBeTruthy()
    expect(screen.getByText('正确答案：甲、乙')).toBeTruthy()
    first.unmount()
  })

  it('keeps the current question order while mounted and respects the setting toggle', () => {
    const secondQuestion = { ...question, id: 13, stem: '另一道题' }
    const resolve = vi.fn()
    function Harness() {
      const [current, setCurrent] = useState(question)
      const [state, setState] = useState<QuizRuntimeState>({})
      return (
        <>
          <button type="button" onClick={() => {
            setCurrent((value) => value.id === 12 ? secondQuestion : question)
            setState({})
          }}>
            切换题目
          </button>
          <QuizQuestionInteraction
            question={current}
            state={state}
            onStateChange={setState}
            onChoiceResolve={resolve}
          />
        </>
      )
    }
    const view = render(<Harness />)
    const optionIds = () => Array.from(view.container.querySelectorAll<HTMLElement>('[data-quiz-option-id]')).map((node) => node.dataset.quizOptionId)
    const original = optionIds()
    expect(readQuizOptionShuffleSettings().enabled).toBe(true)

    fireEvent.click(view.container.querySelector('[data-quiz-option-id="A"]')!)
    const firstAnswerOrder = optionIds()
    expect(firstAnswerOrder).not.toEqual(original)
    fireEvent.click(screen.getByRole('button', { name: '切换题目' }))
    fireEvent.click(screen.getByRole('button', { name: '切换题目' }))
    const firstReturnOrder = optionIds()
    expect(firstReturnOrder).toEqual(firstAnswerOrder)

    fireEvent.click(view.container.querySelector('[data-quiz-option-id="A"]')!)
    expect(optionIds()).not.toEqual(firstReturnOrder)
    fireEvent.click(screen.getByRole('button', { name: '切换题目' }))
    fireEvent.click(screen.getByRole('button', { name: '切换题目' }))
    expect(optionIds()).not.toEqual(firstReturnOrder)

    act(() => saveQuizOptionShuffleSettings({ enabled: false }))
    const beforeDisabledAttempt = optionIds()
    fireEvent.click(view.container.querySelector('[data-quiz-option-id="B"]')!)
    expect(optionIds()).toEqual(beforeDisabledAttempt)
    act(() => saveQuizOptionShuffleSettings({ enabled: true }))
    expect(optionIds()).toEqual(beforeDisabledAttempt)
  })

  it('shuffles after submitting a choice question in subjective presentation', () => {
    const first = setup()
    const original = first.optionIds()
    fireEvent.click(screen.getByRole('button', { name: '主观' }))
    fireEvent.change(screen.getByPlaceholderText('先写下你的答案，再点击提交'), {
      target: { value: '甲' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交答案' }))

    const revealedOrder = Array.from(first.container.querySelectorAll('li')).map((node) => node.textContent?.split('.')[0])
    expect(revealedOrder).toHaveLength(3)
    expect(revealedOrder).not.toEqual(original)
    expect([...revealedOrder].sort()).toEqual(['A', 'B', 'C'])
    expect(screen.getByText('选项')).toBeTruthy()
    expect(screen.getByText('A. 甲')).toBeTruthy()
    expect(screen.getByText('B. 乙')).toBeTruthy()
    expect(screen.getByText('C. 丙')).toBeTruthy()
  })

  it('shuffles after a wrong multi-select submission and keeps correct option IDs highlighted', () => {
    const first = setup(60000, { ...question, answer_payload: { correct_option_ids: ['A', 'B'] } })
    const original = first.optionIds()
    fireEvent.click(first.container.querySelector('[data-quiz-option-id="C"]')!)
    expect(first.optionIds()).toEqual(original)
    fireEvent.click(screen.getByRole('button', { name: '提交答案' }))
    expect(first.optionIds()).not.toEqual(original)
    expect(first.resolve).toHaveBeenCalledWith(['C'], false)
    expect(first.container.querySelector('[data-quiz-option-id="C"]')?.className).toContain('text-destructive')
    expect(first.container.querySelector('[data-quiz-option-id="A"]')?.className).toContain('text-success')
    expect(screen.getByText('回答错误')).toBeTruthy()
  })

  it('uses the displayed position for keyboard answers and shuffles again after Ctrl+Z', () => {
    const resolve = vi.fn()
    function Harness() {
      const [state, setState] = useState<QuizRuntimeState>({})
      const [keyboardOptionIndex, setKeyboardOptionIndex] = useState(0)
      const interactionRootRef = useRef<HTMLDivElement>(null)
      useQuizAnsweringShortcuts({
        enabled: true, questionCount: 1, optionCount: 3, choiceShortcutsActive: true,
        attemptClosed: Boolean(state.selectedOptionId), answerRevealed: Boolean(state.resolved),
        hasNextQuestion: false, keyboardOptionIndex, setKeyboardOptionIndex, interactionRootRef,
        onPreviousQuestion: () => {}, onNextQuestion: () => {}, onSelectOption: () => {},
        onToggleMark: () => {}, onResetAnswer: () => setState({}),
      })
      return <div ref={interactionRootRef}><QuizQuestionInteraction question={question} state={state}
        onStateChange={setState} onChoiceResolve={resolve} /></div>
    }
    const view = render(<Harness />)
    const ids = () => Array.from(view.container.querySelectorAll<HTMLElement>('[data-quiz-option-id]')).map((node) => node.dataset.quizOptionId)
    const original = ids()
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
    const firstOrder = ids()
    expect(firstOrder).not.toEqual(original)
    expect(resolve).toHaveBeenLastCalledWith('A', true)
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true })
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
    expect(resolve).toHaveBeenLastCalledWith(firstOrder[0], firstOrder[0] === 'A')
    expect(ids()).not.toEqual(firstOrder)
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('leaves the order alone when the switch is off', () => {
    saveQuizOptionShuffleSettings({ enabled: false })
    const first = setup()
    const original = first.optionIds()
    fireEvent.click(screen.getByRole('button', { name: /A\. 甲/ }))
    expect(first.optionIds()).toEqual(original)
    first.unmount()
    const second = setup()
    expect(second.optionIds()).toEqual(original)
    second.unmount()
  })
})
