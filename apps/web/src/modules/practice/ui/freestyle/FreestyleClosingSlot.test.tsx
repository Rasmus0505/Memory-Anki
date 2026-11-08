import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FreestyleRoundCompletion } from '@/modules/practice/ui/freestyle/model/roundCompletion'
import { FreestyleClosingSlot } from '@/modules/practice/ui/freestyle/FreestyleClosingSlot'

const completion: FreestyleRoundCompletion = {
  ratedCount: 36,
  passedCount: 33,
  retriedCount: 9,
  retryCount: 9,
  remainingCandidates: 0,
  newCount: 5,
  reviewCount: 31,
  involvedUnitCount: 36,
  totalUnits: 54,
  bySubject: [],
}

function renderSlot(pendingReviewCount: number) {
  render(
    <FreestyleClosingSlot
      roundId="round-1"
      completion={completion}
      quizPalaceCount={0}
      onClearQuizProgress={vi.fn(async () => undefined)}
      onSettle={vi.fn()}
      onCancelSettlement={vi.fn()}
      dueTomorrowCount={11}
      settlementMeta={{}}
      pendingReviewCount={pendingReviewCount}
      nextReviewAt="2026-11-06T12:22:00"
    />,
  )
}

describe('FreestyleClosingSlot', () => {
  it('waits instead of celebrating while same-day 重练 is still owed', () => {
    renderSlot(2)
    expect(screen.getByTestId('freestyle-round-waiting')).toBeTruthy()
    expect(screen.queryByTestId('freestyle-round-complete')).toBeNull()
    expect(screen.queryByTestId('freestyle-round-settle')).toBeNull()
  })

  it('shows the round completion once nothing is owed', () => {
    renderSlot(0)
    expect(screen.getByTestId('freestyle-round-complete')).toBeTruthy()
    expect(screen.getByTestId('freestyle-round-settle')).toBeTruthy()
    expect(screen.queryByTestId('freestyle-round-waiting')).toBeNull()
  })
})
