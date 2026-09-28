import { fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useQuizAnsweringShortcuts } from './useQuizAnsweringShortcuts'

function Harness({
  onToggleMark,
  onSelectOption,
  choiceShortcutsActive = true,
}: {
  onToggleMark: () => void
  onSelectOption: (index: number) => void
  choiceShortcutsActive?: boolean
}) {
  const interactionRootRef = useRef<HTMLDivElement | null>(null)
  useQuizAnsweringShortcuts({
    enabled: true,
    questionCount: 2,
    optionCount: 4,
    choiceShortcutsActive,
    attemptClosed: false,
    keyboardOptionIndex: 0,
    setKeyboardOptionIndex: () => {},
    interactionRootRef,
    onPreviousQuestion: () => {},
    onNextQuestion: () => {},
    onSelectOption,
    onToggleMark,
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
