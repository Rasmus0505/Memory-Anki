import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FreestyleRoundCompletion } from '@/modules/practice/ui/freestyle/model/roundCompletion'
import { formatTimer } from '@/modules/practice/ui/freestyle/model/freestyle-cards'
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
        roundKey="round-1"
        quizPalaceCount={2}
        onClearQuizProgress={vi.fn(async () => undefined)}
        onAnotherRound={onAnotherRound}
        onCancelSettlement={vi.fn()}
      />,
    )

    expect(screen.getByTestId('freestyle-round-complete-total-time').textContent).toContain('23:40')
    expect(screen.getByTestId('freestyle-round-complete-quiz-time').textContent).toContain('做题时间')
    expect(screen.getByTestId('freestyle-round-complete-quiz-time').textContent).toContain('0:00')
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

  it('cancels settlement without starting another round', () => {
    const onCancelSettlement = vi.fn()
    const onAnotherRound = vi.fn()
    render(
      <FreestyleRoundCompleteCard
        completion={completion}
        roundKey="round-1"
        quizPalaceCount={0}
        onClearQuizProgress={vi.fn(async () => undefined)}
        onAnotherRound={onAnotherRound}
        onCancelSettlement={onCancelSettlement}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '取消结算' }))
    expect(onCancelSettlement).toHaveBeenCalledTimes(1)
    expect(onAnotherRound).not.toHaveBeenCalled()
  })

  it('shows hours once the duration reaches one hour', () => {
    expect(formatTimer(37 * 60 + 53)).toBe('37:53')
    expect(formatTimer(22 * 3600 + 54 * 60 + 16)).toBe('22:54:16')
    expect(formatTimer(3600)).toBe('1:00:00')
    render(
      <FreestyleRoundCompleteCard
        completion={{
          ...completion,
          totalEffectiveSeconds: 22 * 3600 + 54 * 60 + 16,
          quizSeconds: 37 * 60 + 53,
        }}
        roundKey="round-hours"
        quizPalaceCount={0}
        onClearQuizProgress={vi.fn(async () => undefined)}
        onAnotherRound={vi.fn()}
        onCancelSettlement={vi.fn()}
      />,
    )
    expect(screen.getByTestId('freestyle-round-complete-total-time').textContent).toContain('22:54:16')
    expect(screen.getByTestId('freestyle-round-complete-quiz-time').textContent).toContain('37:53')
  })

  it('keeps or clears quiz progress for every palace in the configured round', async () => {
    const onClear = vi.fn(async () => undefined)
    const { rerender } = render(
      <FreestyleRoundCompleteCard
        completion={completion}
        roundKey="round-1"
        quizPalaceCount={2}
        onClearQuizProgress={onClear}
        onAnotherRound={vi.fn()}
        onCancelSettlement={vi.fn()}
      />,
    )

    expect(screen.getByTestId('freestyle-round-quiz-clear').textContent).toContain('全部 2 个宫殿')
    fireEvent.click(screen.getByTestId('freestyle-round-quiz-keep'))
    expect(screen.getByText('已保留做题进度，之后仍可查看。')).toBeTruthy()
    expect(onClear).not.toHaveBeenCalled()

    rerender(
      <FreestyleRoundCompleteCard
        completion={completion}
        roundKey="round-2"
        quizPalaceCount={2}
        onClearQuizProgress={onClear}
        onAnotherRound={vi.fn()}
        onCancelSettlement={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('freestyle-round-quiz-clear-confirm'))
    expect(await screen.findByText('已清除本次随心配置中所有宫殿的做题进度。')).toBeTruthy()
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
