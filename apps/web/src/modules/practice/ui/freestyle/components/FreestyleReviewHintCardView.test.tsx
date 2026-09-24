import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FreestyleReviewHintCardView } from './FreestyleReviewHintCardView'

const hintCard = {
  id: 'review_hint:formal_review',
  type: 'review_hint',
  content_type: 'review_hint',
  text: '下一张：正式复习',
} as const

describe('FreestyleReviewHintCardView', () => {
  it('renders the yellow boundary copy', () => {
    render(<FreestyleReviewHintCardView card={hintCard} onAdvance={() => {}} />)

    expect(screen.getByTestId('freestyle-review-hint-text').textContent).toBe('下一张：正式复习')
    expect(screen.getByTestId('freestyle-review-hint-card').className).toContain('bg-amber-300')
  })

  it('advances on a rating tap without selecting any score', () => {
    const onAdvance = vi.fn()
    render(<FreestyleReviewHintCardView card={hintCard} active onAdvance={onAdvance} />)

    fireEvent.click(screen.getByTestId('freestyle-rating-button-1'))
    fireEvent.click(screen.getByTestId('freestyle-rating-button-4'))
    expect(onAdvance).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('freestyle-rating-button-1').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('freestyle-rating-button-4').getAttribute('aria-pressed')).toBe('false')
  })

  it('advances from the 1-4 shortcuts only while active', () => {
    const active = vi.fn()
    render(<FreestyleReviewHintCardView card={hintCard} active onAdvance={active} />)
    fireEvent.keyDown(window, { key: '3' })
    expect(active).toHaveBeenCalledTimes(1)

    const idle = vi.fn()
    render(<FreestyleReviewHintCardView card={hintCard} active={false} onAdvance={idle} />)
    fireEvent.keyDown(window, { key: '3' })
    expect(idle).not.toHaveBeenCalled()
  })
})
