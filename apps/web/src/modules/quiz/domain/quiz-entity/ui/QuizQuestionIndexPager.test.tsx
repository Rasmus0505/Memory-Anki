import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QuizQuestionIndexPager } from './QuizQuestionIndexPager'

describe('QuizQuestionIndexPager', () => {
  it('does not render for a single question', () => {
    const { container } = render(
      <QuizQuestionIndexPager
        count={1}
        currentIndex={0}
        getItemState={() => ({ done: false })}
        onSelect={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows every number when the set fits on one page', () => {
    render(
      <QuizQuestionIndexPager
        count={20}
        currentIndex={0}
        getItemState={() => ({ done: false })}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: '1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '20' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '上一页' })).toBeNull()
  })

  it('pages twenty questions at a time and follows the current index', () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <QuizQuestionIndexPager
        count={21}
        currentIndex={0}
        getItemState={(index) => ({ done: index === 0, correct: true })}
        onSelect={onSelect}
      />,
    )

    expect(screen.getByRole('button', { name: '1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '20' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '21' })).toBeNull()
    expect(screen.getByText('第 1/2 页（1–20）')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByRole('button', { name: '21' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '1' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '21' }))
    expect(onSelect).toHaveBeenCalledWith(20)

    rerender(
      <QuizQuestionIndexPager
        count={21}
        currentIndex={20}
        getItemState={(index) => ({ done: index === 0, correct: true })}
        onSelect={onSelect}
      />,
    )
    expect(screen.getByRole('button', { name: '21' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '1' })).toBeNull()
  })

  it('paints marked question numbers rose, including the current one', () => {
    render(
      <QuizQuestionIndexPager
        count={2}
        currentIndex={1}
        getItemState={(index) => ({ done: false, marked: index === 1 })}
        onSelect={vi.fn()}
      />,
    )
    const marked = screen.getByRole('button', { name: '2' })
    expect(marked.getAttribute('title')).toContain('已标记')
    expect(marked.getAttribute('data-marked')).toBe('true')
    expect(marked.className).toContain('bg-rose-600')
    expect(screen.getByRole('button', { name: '1' }).hasAttribute('data-marked')).toBe(false)
  })
})
