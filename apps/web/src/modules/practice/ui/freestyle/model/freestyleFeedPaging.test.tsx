import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MEMORY_ANKI_SHORTCUTS,
  resolveFlipCardPageDirection,
} from '@/modules/settings/public'
import {
  getFreestyleFeedPageDirection,
  isFreestyleShortcutBlocked,
  shouldSwallowFreestyleFeedPageKey,
} from './freestyleKeyboard'

function FeedSurface({ withQuizDialog = false }: { withQuizDialog?: boolean }) {
  const [pages, setPages] = useState(0)
  return (
    <div
      data-testid="feed"
      data-pages={pages}
      tabIndex={-1}
      onKeyDown={(event) => {
        const direction =
          resolveFlipCardPageDirection(event.nativeEvent, DEFAULT_MEMORY_ANKI_SHORTCUTS)
          ?? getFreestyleFeedPageDirection(event.key)
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
      {withQuizDialog
        ? createPortal(
            <div role="dialog" data-keyboard-shortcuts-suspended="true">
              <button type="button">做题</button>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

function FeedWithQuizDialog() {
  return <FeedSurface withQuizDialog />
}

describe('freestyle feed paging under a quiz dialog', () => {
  it('never turns the card on Space, and PageDown still pages', () => {
    render(<FeedSurface />)
    const feed = screen.getByTestId('feed')
    feed.focus()
    // Space is the character typed inside a card editor; it must not page.
    fireEvent.keyDown(feed, { key: ' ', code: 'Space' })
    expect(screen.getByTestId('feed').dataset.pages).toBe('0')
    // PageDown is still the fixed page key.
    fireEvent.keyDown(feed, { key: 'PageDown', code: 'PageDown' })
    expect(screen.getByTestId('feed').dataset.pages).toBe('1')
  })

  it('does not page while a card editor is open even if focus left the editor', () => {
    render(<FeedWithQuizDialog />)
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.setAttribute('data-mindmap-editor-active', 'true')
    document.body.appendChild(editor)
    try {
      // Focus sits on the feed (the caret was pulled out of the editor) while the
      // edit session is still open: page keys must not turn the card.
      const feed = screen.getByTestId('feed')
      feed.focus()
      fireEvent.keyDown(feed, { key: 'PageDown', code: 'PageDown' })
      fireEvent.keyDown(feed, { key: 'ArrowDown', code: 'ArrowDown' })
      expect(screen.getByTestId('feed').dataset.pages).toBe('0')
    } finally {
      editor.remove()
    }
  })

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
