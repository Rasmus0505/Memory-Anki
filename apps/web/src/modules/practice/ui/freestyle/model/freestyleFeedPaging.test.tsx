import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { describe, expect, it } from 'vitest'
import {
  getFreestyleFeedPageDirection,
  isFreestyleShortcutBlocked,
  shouldSwallowFreestyleFeedPageKey,
} from './freestyleKeyboard'

function FeedWithQuizDialog() {
  const [pages, setPages] = useState(0)
  return (
    <div
      data-testid="feed"
      data-pages={pages}
      tabIndex={-1}
      onKeyDown={(event) => {
        const direction = getFreestyleFeedPageDirection(event.key)
        if (event.defaultPrevented || isFreestyleShortcutBlocked(event.target)) {
          if (direction && shouldSwallowFreestyleFeedPageKey(event.target, event.currentTarget)) {
            event.preventDefault()
          }
          return
        }
        if (!(event.target instanceof HTMLElement)) return
        if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(event.target.tagName)) return
        if (!direction) return
        event.preventDefault()
        setPages((value) => value + (direction === 'next' ? 1 : -1))
      }}
    >
      <button type="button">卡片</button>
      {createPortal(
        <div role="dialog" data-keyboard-shortcuts-suspended="true">
          <button type="button">做题</button>
        </div>,
        document.body,
      )}
    </div>
  )
}

describe('freestyle feed paging under a quiz dialog', () => {
  it('does not turn the card when ArrowUp or ArrowDown is pressed in the dialog', () => {
    render(<FeedWithQuizDialog />)
    const quiz = screen.getByRole('button', { name: '做题' })
    quiz.focus()
    fireEvent.keyDown(quiz, { key: 'ArrowDown', code: 'ArrowDown' })
    fireEvent.keyDown(quiz, { key: 'ArrowUp', code: 'ArrowUp' })
    expect(screen.getByTestId('feed').dataset.pages).toBe('0')
  })

  it('cancels the feed scroller default when focus is still on the card underneath', () => {
    render(<FeedWithQuizDialog />)
    const card = screen.getByRole('button', { name: '卡片' })
    const reached = fireEvent.keyDown(card, { key: 'ArrowDown', code: 'ArrowDown' })
    expect(reached).toBe(false)
    expect(screen.getByTestId('feed').dataset.pages).toBe('0')
  })
})
