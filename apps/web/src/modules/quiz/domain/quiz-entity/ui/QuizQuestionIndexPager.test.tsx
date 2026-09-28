import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  QUIZ_INDEX_BUTTON_PX,
  QUIZ_INDEX_GAP_PX,
  QuizQuestionIndexPager,
  quizIndexPageCapacity,
} from './QuizQuestionIndexPager'

describe('quizIndexPageCapacity', () => {
  it('returns 0 until the row has a width', () => {
    expect(quizIndexPageCapacity(0)).toBe(0)
    expect(quizIndexPageCapacity(Number.NaN)).toBe(0)
  })

  it('counts how many fixed pills fit on one row', () => {
    const stride = QUIZ_INDEX_BUTTON_PX + QUIZ_INDEX_GAP_PX
    const widthFor = (count: number) => count * QUIZ_INDEX_BUTTON_PX + (count - 1) * QUIZ_INDEX_GAP_PX
    expect(quizIndexPageCapacity(widthFor(8))).toBe(8)
    expect(quizIndexPageCapacity(widthFor(8) - 1)).toBe(7)
    expect(quizIndexPageCapacity(stride)).toBe(1)
  })
})

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
        pageSize={20}
        getItemState={() => ({ done: false })}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: '1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '20' })).toBeTruthy()
    expect(screen.getByText('第 1 / 20 题')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '上一页' })).toBeNull()
  })

  it('pages a locked length at a time and follows the current index', () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <QuizQuestionIndexPager
        count={21}
        currentIndex={0}
        pageSize={20}
        getItemState={(index) => ({ done: index === 0, correct: true })}
        onSelect={onSelect}
      />,
    )

    expect(screen.getByRole('button', { name: '1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '20' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '21' })).toBeNull()
    expect(screen.getByText('第 1/2 页 · 第 1 / 21 题')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByRole('button', { name: '21' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '1' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '21' }))
    expect(onSelect).toHaveBeenCalledWith(20)

    rerender(
      <QuizQuestionIndexPager
        count={21}
        currentIndex={20}
        pageSize={20}
        getItemState={(index) => ({ done: index === 0, correct: true })}
        onSelect={onSelect}
      />,
    )
    expect(screen.getByRole('button', { name: '21' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '1' })).toBeNull()
    expect(screen.getByText('第 2/2 页 · 第 21 / 21 题')).toBeTruthy()
  })

  it('falls back to twenty pills before the row width is known', () => {
    render(
      <QuizQuestionIndexPager
        count={21}
        currentIndex={0}
        getItemState={() => ({ done: false })}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: '20' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '21' })).toBeNull()
  })

  it('fits one row to the measured width and keeps the current question on that row', () => {
    let width = 0
    let resizeCallback: ResizeObserverCallback | null = null
    const originalResizeObserver = globalThis.ResizeObserver
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }
      observe(target: Element) {
        Object.defineProperty(target, 'clientWidth', {
          configurable: true,
          get: () => width,
        })
      }
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: MockResizeObserver,
    })

    const widthFor = (count: number) => count * QUIZ_INDEX_BUTTON_PX + (count - 1) * QUIZ_INDEX_GAP_PX

    try {
      const { rerender } = render(
        <QuizQuestionIndexPager
          count={21}
          currentIndex={15}
          getItemState={() => ({ done: false })}
          onSelect={vi.fn()}
        />,
      )

      width = widthFor(8)
      act(() => {
        resizeCallback?.([], {} as ResizeObserver)
      })

      expect(screen.getByRole('button', { name: '9' })).toBeTruthy()
      expect(screen.getByRole('button', { name: '16' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: '8' })).toBeNull()
      expect(screen.queryByRole('button', { name: '17' })).toBeNull()
      expect(screen.getByText('第 2/3 页 · 第 16 / 21 题')).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: '下一页' }))
      expect(screen.getByRole('button', { name: '17' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: '16' })).toBeNull()

      width = widthFor(6)
      act(() => {
        resizeCallback?.([], {} as ResizeObserver)
      })
      expect(screen.getByRole('button', { name: '16' })).toBeTruthy()
      expect(screen.getByText('第 3/4 页 · 第 16 / 21 题')).toBeTruthy()

      rerender(
        <QuizQuestionIndexPager
          count={21}
          currentIndex={20}
          getItemState={() => ({ done: false })}
          onSelect={vi.fn()}
        />,
      )
      expect(screen.getByRole('button', { name: '21' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: '16' })).toBeNull()
      expect(screen.getByText('第 4/4 页 · 第 21 / 21 题')).toBeTruthy()
    } finally {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: originalResizeObserver,
      })
    }
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
    expect(screen.getByText('第 2 / 2 题')).toBeTruthy()
  })
})
