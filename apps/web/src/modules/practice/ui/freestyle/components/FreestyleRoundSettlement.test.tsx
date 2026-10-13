import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FreestyleRoundCompletion } from '@/modules/practice/ui/freestyle/model/roundCompletion'
import { FreestyleRoundSettlement } from './FreestyleRoundSettlement'

const completion: FreestyleRoundCompletion = {
  ratedCount: 3,
  passedCount: 2,
  retriedCount: 0,
  retryCount: 0,
  remainingCandidates: 2,
  quizCount: 1,
  newCount: 1,
  reviewCount: 2,
  involvedUnitCount: 3,
  totalUnits: 6,
  bySubject: [
    {
      subjectId: 1,
      subjectName: '政治',
      palaceCount: 1,
      cardCount: 3,
      totalUnits: 6,
      palaces: [{ palaceId: 10, palaceTitle: '马原', cardCount: 3, totalUnits: 6 }],
    },
  ],
}

function renderSettlement(overrides: Partial<Parameters<typeof FreestyleRoundSettlement>[0]> = {}) {
  const props = {
    completion,
    roundKey: 'round-1',
    quizPalaceCount: 2,
    onClearQuizProgress: vi.fn(async () => undefined),
    onAnotherRound: vi.fn(),
    onCancelSettlement: vi.fn(),
    ...overrides,
  }
  render(<FreestyleRoundSettlement {...props} />)
  return props
}

describe('FreestyleRoundSettlement next reviews', () => {
  const items = Array.from({ length: 11 }, (_, index) => ({
    unit_id: `u${index}`,
    name: `单元${index}`,
    palace_name: '宫殿',
    due_date: '2026-10-14',
  }))

  it('shows the first eight next reviews and expands to every item', () => {
    renderSettlement({ nextReviews: items as never })
    const list = screen.getByTestId('freestyle-round-next-reviews')
    expect(list.querySelectorAll('li')).toHaveLength(8)

    fireEvent.click(screen.getByRole('button', { name: '展开全部 11 项' }))
    expect(list.querySelectorAll('li')).toHaveLength(11)

    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    expect(list.querySelectorAll('li')).toHaveLength(8)
  })
})

describe('FreestyleRoundSettlement', () => {
  it('reports new, review, palace, unit and percentage figures', () => {
    renderSettlement({ quizPalaceCount: 0 })
    expect(screen.getByTestId('freestyle-round-summary').textContent).toBe('新学 1 · 复习 2 · 1 个宫殿 · 3 个单元')
    expect(screen.getByText('3 / 6 单元 · 50%')).toBeTruthy()
    expect(screen.getByText('政治').closest('button')?.textContent).toContain('3 / 6 · 50%')
    expect(screen.getByTestId('freestyle-round-status').textContent).toBe('还剩 2 项待下一轮')
  })

  it('confirms before clearing quiz progress and then reports it cleared', async () => {
    const clear = vi.fn(async () => undefined)
    const { onAnotherRound } = renderSettlement({ onClearQuizProgress: clear })

    fireEvent.click(screen.getByRole('button', { name: '清空做题进度' }))
    expect(clear).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('freestyle-round-quiz-clear-confirm'))

    await waitFor(() => expect(screen.getByRole('button', { name: '已清空' })).toBeTruthy())
    expect(clear).toHaveBeenCalledOnce()
    expect(screen.getByText('已清空做题进度，学习历史和复习安排保持不变。')).toBeTruthy()
    const next = screen.getByRole('button', { name: '再来一轮' }) as HTMLButtonElement
    expect(next.disabled).toBe(false)
    fireEvent.click(next)
    expect(onAnotherRound).toHaveBeenCalledOnce()
  })

  it('keeps next round locked until the quiz choice is resolved', () => {
    renderSettlement()
    const next = screen.getByRole('button', { name: '再来一轮' }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    fireEvent.click(screen.getByTestId('freestyle-round-quiz-keep'))
    expect(next.disabled).toBe(false)
  })

  it('hides the quiz actions and unlocks next round when no palace has quiz progress', () => {
    renderSettlement({ quizPalaceCount: 0 })
    expect(screen.queryByRole('button', { name: '清空做题进度' })).toBeNull()
    expect((screen.getByRole('button', { name: '再来一轮' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the error and stays locked when clearing fails', async () => {
    const clear = vi.fn(async () => { throw new Error('clear failed') })
    renderSettlement({ onClearQuizProgress: clear })
    fireEvent.click(screen.getByRole('button', { name: '清空做题进度' }))
    fireEvent.click(screen.getByTestId('freestyle-round-quiz-clear-confirm'))
    await waitFor(() => expect(screen.getByText('clear failed')).toBeTruthy())
    expect(screen.getByRole('button', { name: '清空做题进度' })).toBeTruthy()
    expect((screen.getByRole('button', { name: '再来一轮' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('discards a clear result that belongs to a previous round', async () => {
    let resolve!: () => void
    const clear = vi.fn(() => new Promise<void>((done) => { resolve = done }))
    const props = {
      completion,
      quizPalaceCount: 2,
      onClearQuizProgress: clear,
      onAnotherRound: vi.fn(),
      onCancelSettlement: vi.fn(),
    }
    const { rerender } = render(<FreestyleRoundSettlement {...props} roundKey="old" />)
    fireEvent.click(screen.getByRole('button', { name: '清空做题进度' }))
    fireEvent.click(screen.getByTestId('freestyle-round-quiz-clear-confirm'))

    rerender(<FreestyleRoundSettlement {...props} roundKey="new" />)
    await act(async () => resolve())

    expect(screen.queryByRole('button', { name: '已清空' })).toBeNull()
    expect((screen.getByRole('button', { name: '再来一轮' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('returns to the previous card from the top action', () => {
    const { onCancelSettlement } = renderSettlement()
    fireEvent.click(screen.getByRole('button', { name: '返回上一张' }))
    expect(onCancelSettlement).toHaveBeenCalledOnce()
  })

  it('appends tomorrow due count to the status line when known', () => {
    renderSettlement({ quizPalaceCount: 0, dueTomorrowCount: 4 })
    expect(screen.getByTestId('freestyle-round-status').textContent).toBe('还剩 2 项待下一轮 · 明天 4 个复习单元要复习')
  })

  it('shows a zero tomorrow count rather than hiding it', () => {
    renderSettlement({ quizPalaceCount: 0, dueTomorrowCount: 0 })
    expect(screen.getByTestId('freestyle-round-status').textContent).toBe('还剩 2 项待下一轮 · 明天 0 个复习单元要复习')
  })

  it('omits the tomorrow clause when the count is unavailable', () => {
    renderSettlement({ quizPalaceCount: 0, dueTomorrowCount: null })
    expect(screen.getByTestId('freestyle-round-status').textContent).toBe('还剩 2 项待下一轮')
  })

  it('omits the remaining clause when nothing is left but still shows tomorrow', () => {
    renderSettlement({
      quizPalaceCount: 0,
      completion: { ...completion, remainingCandidates: 0 },
      dueTomorrowCount: 4,
    })
    expect(screen.getByTestId('freestyle-round-status').textContent).toBe('本轮已全部完成 · 明天 4 个复习单元要复习')
  })

  it('shows the remaining palaces and 复习单元 when the server counts are known', () => {
    renderSettlement({ quizPalaceCount: 0, remainingPalaces: 2, remainingUnits: 7 })
    expect(screen.getByTestId('freestyle-round-status').textContent).toBe('还剩 2/7 待下一轮')
  })
})
