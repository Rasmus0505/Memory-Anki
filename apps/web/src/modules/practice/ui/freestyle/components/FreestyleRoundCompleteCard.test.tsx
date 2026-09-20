import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FreestyleRoundCompletion } from '@/modules/practice/ui/freestyle/model/roundCompletion'
import { FreestyleRoundCompleteCard } from './FreestyleRoundCompleteCard'

const completion: FreestyleRoundCompletion = {
  ratedCount: 12,
  passedCount: 10,
  retriedCount: 2,
  retryCount: 2,
  remainingCandidates: 0,
  quizCount: 3,
  totalEffectiveSeconds: 1420,
  bySubject: [
    {
      subjectId: 1,
      subjectName: '教育学',
      palaceCount: 2,
      cardCount: 8,
      effectiveSeconds: 920,
      palaces: [
        { palaceId: 11, palaceTitle: '卢梭', cardCount: 5, effectiveSeconds: 550 },
        { palaceId: 12, palaceTitle: '康德', cardCount: 3, effectiveSeconds: 370 },
      ],
    },
    {
      subjectId: 2,
      subjectName: '英语',
      palaceCount: 1,
      cardCount: 4,
      effectiveSeconds: 500,
      palaces: [
        { palaceId: 21, palaceTitle: '阅读', cardCount: 4, effectiveSeconds: 500 },
      ],
    },
  ],
}

describe('FreestyleRoundCompleteCard', () => {
  it('shows total time, first subject expanded, and fires 再来一轮', () => {
    const onAnotherRound = vi.fn()
    render(
      <FreestyleRoundCompleteCard
        completion={completion}
        onAnotherRound={onAnotherRound}
      />,
    )

    expect(screen.getByTestId('freestyle-round-complete-total-time').textContent).toContain('23:40')
    const subjects = screen.getAllByTestId('freestyle-round-complete-subject')
    expect(subjects[0]?.getAttribute('data-open')).toBe('true')
    expect(subjects[1]?.getAttribute('data-open')).toBe('false')
    expect(screen.getByText('卢梭')).toBeTruthy()
    expect(screen.queryByText('阅读')).toBeNull()

    fireEvent.click(subjects[1]!)
    expect(screen.getByText('阅读')).toBeTruthy()

    fireEvent.click(screen.getByTestId('freestyle-round-another'))
    expect(onAnotherRound).toHaveBeenCalledTimes(1)
  })
})
