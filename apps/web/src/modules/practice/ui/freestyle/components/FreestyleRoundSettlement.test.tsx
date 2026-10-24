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
    onSettle: vi.fn(),
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

  it('shows the first six next reviews and expands to every item', () => {
    renderSettlement({ nextReviews: items as never })
    const list = screen.getByTestId('freestyle-round-next-reviews')
    expect(list.querySelectorAll('li')).toHaveLength(6)

    fireEvent.click(screen.getByRole('button', { name: '展开全部 11 项' }))
    expect(list.querySelectorAll('li')).toHaveLength(11)

    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    expect(list.querySelectorAll('li')).toHaveLength(6)
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

  it('keeps exactly two actions: clear quiz progress and settle', () => {
    renderSettlement()
    const actions = screen.getByTestId('freestyle-round-settle').parentElement
    expect(actions?.querySelectorAll('button')).toHaveLength(2)
    expect(screen.getByTestId('freestyle-round-quiz-clear')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '再来一轮' })).toBeNull()
    expect(screen.queryByRole('button', { name: '结束并保留本轮' })).toBeNull()
    expect(screen.queryByText(/加入今天到期内容/)).toBeNull()
  })

  it('settles even when the quiz choice was never made', () => {
    const { onSettle } = renderSettlement()
    const settle = screen.getByTestId('freestyle-round-settle') as HTMLButtonElement
    expect(settle.disabled).toBe(false)
    fireEvent.click(settle)
    expect(onSettle).toHaveBeenCalledOnce()
  })

  it('settles without a quiz surface too, as the only action', () => {
    const { onSettle } = renderSettlement({ quizPalaceCount: 0 })
    expect(screen.queryByTestId('freestyle-round-quiz-clear')).toBeNull()
    fireEvent.click(screen.getByTestId('freestyle-round-settle'))
    expect(onSettle).toHaveBeenCalledOnce()
  })

  it('clears quiz progress on the second press and stays settlable', async () => {
    const clear = vi.fn(async () => undefined)
    const { onSettle } = renderSettlement({ onClearQuizProgress: clear })

    const button = screen.getByTestId('freestyle-round-quiz-clear')
    fireEvent.click(button)
    expect(clear).not.toHaveBeenCalled()
    expect(button.textContent).toBe('再点确认清空')

    fireEvent.click(button)
    await waitFor(() => expect(button.textContent).toBe('已清空做题进度'))
    expect(clear).toHaveBeenCalledOnce()
    expect(screen.getByText('已清空做题进度，学习历史和复习安排保持不变。')).toBeTruthy()

    fireEvent.click(screen.getByTestId('freestyle-round-settle'))
    expect(onSettle).toHaveBeenCalledOnce()
  })

  it('stays armed-settlable and reports the error when clearing fails', async () => {
    const clear = vi.fn(async () => { throw new Error('clear failed') })
    renderSettlement({ onClearQuizProgress: clear })
    const button = screen.getByTestId('freestyle-round-quiz-clear')
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByText('clear failed')).toBeTruthy())
    expect(button.textContent).toBe('清空做题进度')
    expect((screen.getByTestId('freestyle-round-settle') as HTMLButtonElement).disabled).toBe(false)
  })

  it('discards a clear result that belongs to a previous round', async () => {
    let resolve!: () => void
    const clear = vi.fn(() => new Promise<void>((done) => { resolve = done }))
    const props = {
      completion,
      quizPalaceCount: 2,
      onClearQuizProgress: clear,
      onSettle: vi.fn(),
      onCancelSettlement: vi.fn(),
    }
    const { rerender } = render(<FreestyleRoundSettlement {...props} roundKey="old" />)
    fireEvent.click(screen.getByTestId('freestyle-round-quiz-clear'))
    fireEvent.click(screen.getByTestId('freestyle-round-quiz-clear'))

    rerender(<FreestyleRoundSettlement {...props} roundKey="new" />)
    await act(async () => resolve())

    expect(screen.getByTestId('freestyle-round-quiz-clear').textContent).toBe('清空做题进度')
  })

  it('returns to the previous card from the top action', () => {
    const { onCancelSettlement } = renderSettlement()
    fireEvent.click(screen.getByRole('button', { name: '返回上一张' }))
    expect(onCancelSettlement).toHaveBeenCalledOnce()
  })

  it('drops the cancel action once the settled feed has no card to return to', () => {
    renderSettlement({ showCancel: false })
    expect(screen.queryByTestId('freestyle-round-cancel-settlement')).toBeNull()
    expect(screen.queryByRole('button', { name: '返回上一张' })).toBeNull()
    expect(screen.getByTestId('freestyle-round-complete')).toBeTruthy()
  })

  it('celebrates cleared palaces when a palace reached its full unit count', () => {
    renderSettlement({ quizPalaceCount: 0 })
    // 3 / 6 is not fully cleared.
    expect(screen.queryByTestId('freestyle-round-cleared-palaces')).toBeNull()

    renderSettlement({
      quizPalaceCount: 0,
      completion: {
        ...completion,
        bySubject: [{
          ...completion.bySubject[0],
          cardCount: 6,
          palaces: [{ palaceId: 10, palaceTitle: '马原', cardCount: 6, totalUnits: 6 }],
        }],
      },
    })
    expect(screen.getByTestId('freestyle-round-cleared-palaces').textContent).toContain('1 个宫殿今日已清')
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
