import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useQuizAnsweringShortcuts } from './useQuizAnsweringShortcuts'

function Harness({
  onToggleMark,
  onSelectOption,
  onNextQuestion = () => {},
  onDeleteQuestion,
  onResetAnswer,
  choiceShortcutsActive = true,
  answerRevealed = false,
  hasNextQuestion = true,
}: {
  onToggleMark: () => void
  onSelectOption: (index: number) => void
  onNextQuestion?: () => void
  onDeleteQuestion?: () => void
  onResetAnswer?: () => void
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
    onResetAnswer,
  })
  return (
    <div ref={interactionRootRef} data-quiz-shortcut-surface="" tabIndex={-1}>
      <button type="button" data-quiz-option-index="0">A</button>
      <button type="button" data-quiz-option-index="1">B</button>
      <button type="button" data-quiz-option-index="2">C</button>
      <button type="button" data-quiz-option-index="3">D</button>
    </div>
  )
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

  it('pages to the next question on bare Space', () => {
    const onNextQuestion = vi.fn()
    render(
      <Harness
        answerRevealed
        onNextQuestion={onNextQuestion}
        onToggleMark={() => {}}
        onSelectOption={() => {}}
      />,
    )
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(onNextQuestion).toHaveBeenCalledTimes(1)

    // Shift+Space is a typed space, not a page turn.
    fireEvent.keyDown(window, { key: ' ', code: 'Space', shiftKey: true })
    expect(onNextQuestion).toHaveBeenCalledTimes(1)
  })

  it('keeps Space on a focused option until the answer is visible', () => {
    const onNextQuestion = vi.fn()
    const { rerender } = render(
      <Harness onNextQuestion={onNextQuestion} onToggleMark={() => {}} onSelectOption={() => {}} />,
    )
    const option = screen.getByRole('button', { name: 'A' })
    option.focus()

    const reachedBeforeReveal = fireEvent.keyDown(option, { key: ' ', code: 'Space' })
    expect(reachedBeforeReveal).toBe(true)
    expect(onNextQuestion).not.toHaveBeenCalled()

    rerender(
      <Harness
        answerRevealed
        onNextQuestion={onNextQuestion}
        onToggleMark={() => {}}
        onSelectOption={() => {}}
      />,
    )
    const reachedAfterReveal = fireEvent.keyDown(screen.getByRole('button', { name: 'A' }), {
      key: ' ',
      code: 'Space',
    })
    expect(reachedAfterReveal).toBe(false)
    expect(onNextQuestion).toHaveBeenCalledTimes(1)
  })

  it('leaves Space to a focused toolbar button', () => {
    const onNextQuestion = vi.fn()
    render(
      <div>
        <Harness answerRevealed onNextQuestion={onNextQuestion} onToggleMark={() => {}} onSelectOption={() => {}} />
        <button type="button">设置</button>
      </div>,
    )
    fireEvent.keyDown(screen.getByRole('button', { name: '设置' }), { key: ' ', code: 'Space' })
    expect(onNextQuestion).not.toHaveBeenCalled()
  })

  it('does not page on Space while typing', () => {
    const onNextQuestion = vi.fn()
    render(
      <div>
        <Harness answerRevealed onNextQuestion={onNextQuestion} onToggleMark={() => {}} onSelectOption={() => {}} />
        <input aria-label="答案" />
      </div>,
    )
    fireEvent.keyDown(screen.getByLabelText('答案'), { key: ' ', code: 'Space' })
    expect(onNextQuestion).not.toHaveBeenCalled()
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

  it('resets once with Ctrl+Z but preserves native undo while typing', () => {
    const onResetAnswer = vi.fn()
    render(<div><Harness onResetAnswer={onResetAnswer} onToggleMark={() => {}} onSelectOption={() => {}} /><textarea aria-label="草稿" /></div>)
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true, repeat: true })
    fireEvent.keyDown(screen.getByLabelText('草稿'), { key: 'z', code: 'KeyZ', ctrlKey: true })
    expect(onResetAnswer).toHaveBeenCalledTimes(1)
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

  it('clicks the focused option so keyboard answers use the option action', () => {
    const onSelectOption = vi.fn()
    render(<Harness onToggleMark={() => {}} onSelectOption={onSelectOption} />)
    const option = screen.getByRole('button', { name: 'A' })
    const clicked = vi.fn()
    option.addEventListener('click', clicked)

    fireEvent.keyDown(window, { key: '1', code: 'Digit1' })

    expect(clicked).toHaveBeenCalledTimes(1)
    expect(onSelectOption).not.toHaveBeenCalled()
  })

  it('answers with the numpad digits too', () => {
    const onSelectOption = vi.fn()
    render(<Harness onToggleMark={() => {}} onSelectOption={onSelectOption} />)
    const option = screen.getByRole('button', { name: 'A' })
    const clicked = vi.fn()
    option.addEventListener('click', clicked)

    fireEvent.keyDown(window, { key: '1', code: 'Numpad1' })

    expect(clicked).toHaveBeenCalledTimes(1)
    expect(onSelectOption).not.toHaveBeenCalled()
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
