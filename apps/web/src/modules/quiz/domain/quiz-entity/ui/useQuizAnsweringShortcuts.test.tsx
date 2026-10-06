import { fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useQuizAnsweringShortcuts } from './useQuizAnsweringShortcuts'

function Harness({
  onToggleMark,
  onSelectOption,
  onNextQuestion = () => {},
  onDeleteQuestion,
  choiceShortcutsActive = true,
  answerRevealed = false,
  hasNextQuestion = true,
}: {
  onToggleMark: () => void
  onSelectOption: (index: number) => void
  onNextQuestion?: () => void
  onDeleteQuestion?: () => void
  choiceShortcutsActive?: boolean
  answerRevealed?: boolean
  hasNextQuestion?: boolean
}) {
  const interactionRootRef = useRef<HTMLDivElement | null>(null)
  useQuizAnsweringShortcuts({
    enabled: true,
    questionCount: 2,
    optionCount: 4,
    choiceShortcutsActive,
    attemptClosed: false,
    answerRevealed,
    hasNextQuestion,
    keyboardOptionIndex: 0,
    setKeyboardOptionIndex: () => {},
    interactionRootRef,
    onPreviousQuestion: () => {},
    onNextQuestion,
    onSelectOption,
    onToggleMark,
    onDeleteQuestion,
  })
  return <div ref={interactionRootRef} data-quiz-shortcut-surface="" tabIndex={-1} />
}

describe('useQuizAnsweringShortcuts', () => {
  it('toggles mark once per ArrowUp press and does not let the key reach the feed', () => {
    const onToggleMark = vi.fn()
    const onSelectOption = vi.fn()
    const seenByFeed = vi.fn()
    window.addEventListener('keydown', seenByFeed)
    render(<Harness onToggleMark={onToggleMark} onSelectOption={onSelectOption} />)

    fireEvent.keyDown(window, { key: 'ArrowUp', code: 'ArrowUp' })
    fireEvent.keyDown(window, { key: 'ArrowUp', code: 'ArrowUp', repeat: true })

    expect(onToggleMark).toHaveBeenCalledTimes(1)
    expect(seenByFeed).not.toHaveBeenCalled()
    window.removeEventListener('keydown', seenByFeed)
  })

  it('swallows ArrowDown even when it is not moving an option', () => {
    const seenByFeed = vi.fn()
    window.addEventListener('keydown', seenByFeed)
    render(
      <Harness
        choiceShortcutsActive={false}
        onToggleMark={() => {}}
        onSelectOption={() => {}}
      />,
    )

    fireEvent.keyDown(window, { key: 'ArrowDown', code: 'ArrowDown' })

    expect(seenByFeed).not.toHaveBeenCalled()
    window.removeEventListener('keydown', seenByFeed)
  })

  it('advances on Enter after the answer is visible, including a disabled field', () => {
    const onNextQuestion = vi.fn()
    render(
      <div>
        <Harness answerRevealed onNextQuestion={onNextQuestion} onToggleMark={() => {}} onSelectOption={() => {}} />
        <textarea aria-label="答案" disabled defaultValue="已写" />
      </div>,
    )
    fireEvent.keyDown(document.querySelector('textarea') as HTMLTextAreaElement, { key: 'Enter', code: 'Enter' })
    expect(onNextQuestion).toHaveBeenCalledTimes(1)
  })

  it('opens delete from Backspace unless the learner is still typing', () => {
    const onDeleteQuestion = vi.fn()
    const { rerender } = render(
      <Harness onDeleteQuestion={onDeleteQuestion} onToggleMark={() => {}} onSelectOption={() => {}} />,
    )
    fireEvent.keyDown(window, { key: 'Backspace', code: 'Backspace' })
    expect(onDeleteQuestion).toHaveBeenCalledTimes(1)

    rerender(
      <div>
        <Harness onDeleteQuestion={onDeleteQuestion} onToggleMark={() => {}} onSelectOption={() => {}} />
        <textarea aria-label="草稿" defaultValue="还在写" />
      </div>,
    )
    fireEvent.keyDown(document.querySelector('textarea') as HTMLTextAreaElement, { key: 'Backspace', code: 'Backspace' })
    expect(onDeleteQuestion).toHaveBeenCalledTimes(1)
  })

  it('yields Enter while a confirmation dialog is open', () => {
    const onNextQuestion = vi.fn()
    render(
      <div>
        <Harness answerRevealed onNextQuestion={onNextQuestion} onToggleMark={() => {}} onSelectOption={() => {}} />
        <div data-confirm-dialog="open" />
      </div>,
    )
    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' })
    expect(onNextQuestion).not.toHaveBeenCalled()
  })

  it('does not answer while typing', () => {
    const onSelectOption = vi.fn()
    render(
      <div>
        <Harness onToggleMark={() => {}} onSelectOption={onSelectOption} />
        <input aria-label="答案" />
      </div>,
    )
    fireEvent.keyDown(document.querySelector('input') as HTMLInputElement, { key: '1', code: 'Digit1' })
    expect(onSelectOption).not.toHaveBeenCalled()
  })
})
