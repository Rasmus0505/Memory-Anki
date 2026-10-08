import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QuizQuestionRoundRatingBadge } from './QuizQuestionRoundRatingBadge'

/**
 * One badge for both answering windows.
 *
 * The toolbar 做题 overlay and 关联题目 render this same component, so 「本轮最低
 * N」 cannot mean one thing in one window and something else in the other. The
 * rule behind the number lives in the backend (`build_round_question_ratings`).
 */
describe('QuizQuestionRoundRatingBadge', () => {
  it('shows the score word when this round rated the knowledge point', () => {
    render(<QuizQuestionRoundRatingBadge rating={2} palaceId={7} />)
    expect(screen.getByTestId('overlay-question-rating').textContent).toContain('本轮最低 2 · 困难')
  })

  it('says 本轮尚未复习 instead of a zero score', () => {
    render(<QuizQuestionRoundRatingBadge rating={null} palaceId={7} />)
    const badge = screen.getByTestId('overlay-question-rating')
    expect(badge.textContent).toContain('本轮尚未复习')
    // "not reviewed yet" and "reviewed and forgotten" must not look alike.
    expect(badge.textContent).not.toContain('0')
  })

  it('jumps to the knowledge point when the source is known', () => {
    const onOpenSource = vi.fn()
    render(
      <QuizQuestionRoundRatingBadge rating={3} palaceId={7} onOpenSource={onOpenSource} />,
    )
    fireEvent.click(screen.getByTestId('overlay-question-rating'))
    expect(onOpenSource).toHaveBeenCalledTimes(1)
  })

  it('stays a plain label when there is no palace to point at', () => {
    const onOpenSource = vi.fn()
    render(
      <QuizQuestionRoundRatingBadge rating={1} palaceId={null} onOpenSource={onOpenSource} />,
    )
    // Not a button: a jump target that cannot jump should not look clickable.
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByTestId('overlay-question-rating').textContent).toContain('本轮最低 1 · 忘记')
  })

  it('tints a weak score differently from a comfortable one', () => {
    const { unmount } = render(<QuizQuestionRoundRatingBadge rating={1} palaceId={7} />)
    const weak = screen.getByTestId('overlay-question-rating').className
    unmount()
    render(<QuizQuestionRoundRatingBadge rating={4} palaceId={7} />)
    const easy = screen.getByTestId('overlay-question-rating').className
    expect(weak).not.toBe(easy)
  })
})
