import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUIZ_SHORTCUTS,
  formatQuizShortcutLabel,
  resolveQuizShortcutAction,
  sanitizeQuizShortcutMap,
  type QuizShortcutContext,
} from './quizShortcuts'

function context(overrides: Partial<QuizShortcutContext> = {}): QuizShortcutContext {
  return {
    questionCount: 3,
    optionCount: 4,
    choiceShortcutsActive: true,
    attemptClosed: false,
    answerRevealed: false,
    hasNextQuestion: true,
    repeat: false,
    editable: false,
    recording: false,
    enterOnUnrelatedControl: false,
    ...overrides,
  }
}

function keydown(key: string, code: string, extras: KeyboardEventInit = {}) {
  return new KeyboardEvent('keydown', { key, code, ...extras })
}

describe('quizShortcuts', () => {
  it('uses ArrowUp once to toggle mark and leaves previous-option unset', () => {
    expect(formatQuizShortcutLabel(DEFAULT_QUIZ_SHORTCUTS.toggle_mark)).toBe('↑')
    expect(DEFAULT_QUIZ_SHORTCUTS.previous_option).toBeNull()
    const first = resolveQuizShortcutAction(
      keydown('ArrowUp', 'ArrowUp'),
      DEFAULT_QUIZ_SHORTCUTS,
      context(),
    )
    const held = resolveQuizShortcutAction(
      keydown('ArrowUp', 'ArrowUp', { repeat: true }),
      DEFAULT_QUIZ_SHORTCUTS,
      context({ repeat: true }),
    )
    expect(first).toEqual({ id: 'toggle_mark', run: true })
    expect(held).toEqual({ id: 'toggle_mark', run: false })
  })

  it('still toggles mark on subjective questions', () => {
    const match = resolveQuizShortcutAction(
      keydown('ArrowUp', 'ArrowUp'),
      DEFAULT_QUIZ_SHORTCUTS,
      context({ choiceShortcutsActive: false, optionCount: 0 }),
    )
    expect(match).toEqual({ id: 'toggle_mark', run: true })
  })

  it('keeps digit, letter, arrow, and enter defaults', () => {
    expect(resolveQuizShortcutAction(keydown('ArrowLeft', 'ArrowLeft'), DEFAULT_QUIZ_SHORTCUTS, context())?.id)
      .toBe('previous_question')
    expect(resolveQuizShortcutAction(keydown('ArrowDown', 'ArrowDown'), DEFAULT_QUIZ_SHORTCUTS, context())?.id)
      .toBe('next_option')
    expect(resolveQuizShortcutAction(keydown('2', 'Digit2'), DEFAULT_QUIZ_SHORTCUTS, context())).toMatchObject({
      id: 'select_option_2',
      optionIndex: 1,
      run: true,
    })
    expect(resolveQuizShortcutAction(keydown('d', 'KeyD'), DEFAULT_QUIZ_SHORTCUTS, context())?.id)
      .toBe('select_option_d')
    expect(resolveQuizShortcutAction(keydown('Enter', 'Enter'), DEFAULT_QUIZ_SHORTCUTS, context())?.id)
      .toBe('submit_choice')
  })

  it('does not submit when Enter lands on another control', () => {
    expect(resolveQuizShortcutAction(
      keydown('Enter', 'Enter'),
      DEFAULT_QUIZ_SHORTCUTS,
      context({ enterOnUnrelatedControl: true }),
    )).toBeNull()
  })

  it('opens delete from Backspace and keeps that binding in the saved map', () => {
    expect(DEFAULT_QUIZ_SHORTCUTS.delete_question?.code).toBe('Backspace')
    expect(sanitizeQuizShortcutMap(DEFAULT_QUIZ_SHORTCUTS).delete_question?.code).toBe('Backspace')
    expect(resolveQuizShortcutAction(
      keydown('Backspace', 'Backspace'),
      DEFAULT_QUIZ_SHORTCUTS,
      context({ choiceShortcutsActive: false, optionCount: 0 }),
    )).toEqual({ id: 'delete_question', run: true })
    expect(resolveQuizShortcutAction(
      keydown('Backspace', 'Backspace', { repeat: true }),
      DEFAULT_QUIZ_SHORTCUTS,
      context({ repeat: true }),
    )).toEqual({ id: 'delete_question', run: false })
    expect(resolveQuizShortcutAction(
      keydown('Backspace', 'Backspace'),
      DEFAULT_QUIZ_SHORTCUTS,
      context({ editable: true }),
    )).toBeNull()
  })

  it('turns Enter into the next question only after the answer is visible', () => {
    expect(resolveQuizShortcutAction(
      keydown('Enter', 'Enter'),
      DEFAULT_QUIZ_SHORTCUTS,
      context({
        answerRevealed: true,
        choiceShortcutsActive: false,
        attemptClosed: true,
        optionCount: 0,
      }),
    )).toEqual({ id: 'next_question', run: true })
    expect(resolveQuizShortcutAction(
      keydown('Enter', 'Enter', { repeat: true }),
      DEFAULT_QUIZ_SHORTCUTS,
      context({ answerRevealed: true, repeat: true }),
    )).toEqual({ id: 'next_question', run: false })
    expect(resolveQuizShortcutAction(
      keydown('Enter', 'Enter'),
      DEFAULT_QUIZ_SHORTCUTS,
      context({ answerRevealed: true, hasNextQuestion: false }),
    )).toBeNull()
  })

  it('drops a second action that reuses ArrowUp', () => {
    const sanitized = sanitizeQuizShortcutMap({
      ...DEFAULT_QUIZ_SHORTCUTS,
      previous_option: DEFAULT_QUIZ_SHORTCUTS.toggle_mark,
    })
    expect(sanitized.toggle_mark?.code).toBe('ArrowUp')
    expect(sanitized.previous_option).toBeNull()
  })
})
