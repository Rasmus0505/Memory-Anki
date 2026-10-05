import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FreestyleRoundCompletion } from '@/modules/practice/ui/freestyle/model/roundCompletion'
import { FreestyleRoundCompleteCard } from './FreestyleRoundCompleteCard'

const fxMocks = vi.hoisted(() => ({
  cue: vi.fn(),
  retireOwner: vi.fn(),
  useFxOwner: vi.fn(() => 'round-owner'),
}))

vi.mock('@/shared/fx', () => fxMocks)

const completion: FreestyleRoundCompletion = {
  ratedCount: 4,
  passedCount: 3,
  retriedCount: 1,
  retryCount: 1,
  remainingCandidates: 0,
  quizCount: 0,
  totalEffectiveSeconds: 120,
  bySubject: [],
}

describe('FreestyleRoundCompleteCard', () => {
  it('skips the round show without leaving the settlement', () => {
    const onAnotherRound = vi.fn()
    const onCancelSettlement = vi.fn()
    render(
      <FreestyleRoundCompleteCard
        completion={completion}
        roundKey="round-9"
        quizPalaceCount={0}
        onClearQuizProgress={vi.fn(async () => undefined)}
        onAnotherRound={onAnotherRound}
        onCancelSettlement={onCancelSettlement}
      />,
    )

    const card = screen.getByTestId('freestyle-round-complete')
    expect(card.className).toContain('h-auto')
    expect(card.className).toContain('shrink-0')
    fireEvent.click(screen.getByTestId('freestyle-round-skip-show'))

    expect(fxMocks.retireOwner).toHaveBeenCalledWith('round:round-9')
    expect(onAnotherRound).not.toHaveBeenCalled()
    expect(onCancelSettlement).not.toHaveBeenCalled()
    expect(screen.getByText('本轮总结')).toBeTruthy()
    expect(screen.getByRole('button', { name: '配置下一轮' })).toBeTruthy()
    expect(screen.getByText(/已完成单元的复习安排不会因本按钮重置/)).toBeTruthy()

    const cancel = screen.getByRole('button', { name: '返回上一张' })
    expect(cancel.parentElement?.firstElementChild).toBe(cancel)
    expect(cancel.closest('.fs-rise')).toBeNull()
    fireEvent.click(cancel)
    expect(onCancelSettlement).toHaveBeenCalledOnce()
  })

  it('lets a partial settlement grow so 取消结算 stays in the document', () => {
    const onCancelSettlement = vi.fn()
    render(
      <FreestyleRoundCompleteCard
        variant="partial"
        completion={completion}
        roundKey="round-9:partial"
        quizPalaceCount={0}
        onClearQuizProgress={vi.fn(async () => undefined)}
        onCancelSettlement={onCancelSettlement}
        onConfirmPartial={vi.fn()}
      />,
    )

    const card = screen.getByTestId('freestyle-partial-settlement-card')
    expect(card.className).toContain('h-auto')
    expect(card.className).toContain('shrink-0')
    expect(card.className).not.toContain('h-full')
    fireEvent.click(screen.getByTestId('freestyle-round-cancel-settlement'))
    expect(onCancelSettlement).toHaveBeenCalledOnce()
  })
})
