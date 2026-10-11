import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('allows finishing with unrated or weak work without declaring it passed', () => {
    const finish = vi.fn()
    const resume = vi.fn()
    render(<FreestyleRoundCompleteCard variant="study" unscoredCount={3} completion={{ ...completion, ratedCount: 1, passedCount: 0 }} roundKey="unfinished" quizPalaceCount={2} onClearQuizProgress={vi.fn()} onCancelSettlement={resume} onFinishStudy={finish} />)
    expect(screen.getByText('结束本次学习')).toBeTruthy()
    expect(screen.getByTestId('freestyle-study-pending-counts').textContent).toContain('待评分 3 次（含重练） · 已评分未通过 1 个学习内容')
    expect(screen.getByTestId('freestyle-study-resume-note').textContent).toContain('未评分和未通过的内容会保留在同一轮')
    const confirm = screen.getByRole('button', { name: '结束并保留本轮' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    expect(finish).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保留' }))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(finish).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '继续本轮学习' }))
    expect(resume).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: '配置下一轮' })).toBeNull()
  })

  it('does not finish while clear is pending or failed', async () => {
    const clear = vi.fn().mockRejectedValueOnce(new Error('clear failed')).mockResolvedValueOnce(undefined)
    const finish = vi.fn()
    render(<FreestyleRoundCompleteCard variant="study" completion={completion} roundKey="clear" quizPalaceCount={3} onClearQuizProgress={clear} onCancelSettlement={vi.fn()} onFinishStudy={finish} />)
    const confirm = screen.getByRole('button', { name: '结束并保留本轮' }) as HTMLButtonElement
    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect(confirm.disabled).toBe(true)
    await waitFor(() => expect(screen.getByText('clear failed')).toBeTruthy())
    expect(confirm.disabled).toBe(true)
    expect(finish).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    await waitFor(() => expect(confirm.disabled).toBe(false))
    expect(screen.getByText(/已清除本轮涉及宫殿/)).toBeTruthy()
  })

  it('ignores a clear response owned by an older round', async () => {
    let resolve!: () => void
    const clear = vi.fn(() => new Promise<void>((done) => { resolve = done }))
    const props = { completion, quizPalaceCount: 1, onClearQuizProgress: clear, onFinishStudy: vi.fn(), onAnotherRound: vi.fn(), onCancelSettlement: vi.fn() }
    const { rerender } = render(<FreestyleRoundCompleteCard {...props} roundKey="old" />)
    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    rerender(<FreestyleRoundCompleteCard {...props} roundKey="new" />)
    await act(async () => resolve())
    expect((screen.getByRole('button', { name: '结束并保留本轮' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '配置下一轮' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '返回上一张' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '保留' }))
    expect((screen.getByRole('button', { name: '配置下一轮' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('offers adding due work separately from finishing or starting a new round', () => {
    const add = vi.fn()
    const finish = vi.fn()
    render(<FreestyleRoundCompleteCard variant="study" completion={completion} roundKey="due" quizPalaceCount={0} onClearQuizProgress={vi.fn()} onCancelSettlement={vi.fn()} onFinishStudy={finish} onAddDueToday={add} />)
    fireEvent.click(screen.getByRole('button', { name: '加入今天到期内容，继续本轮' }))
    expect(add).toHaveBeenCalledOnce()
    expect(finish).not.toHaveBeenCalled()
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

    expect(screen.queryByTestId('freestyle-round-quiz-clear')).toBeNull()
    expect(screen.queryByTestId('freestyle-study-finish-confirm')).toBeNull()
    const card = screen.getByTestId('freestyle-partial-settlement-card')
    expect(card.className).toContain('h-auto')
    expect(card.className).toContain('shrink-0')
    expect(card.className).not.toContain('h-full')
    fireEvent.click(screen.getByTestId('freestyle-round-cancel-settlement'))
    expect(onCancelSettlement).toHaveBeenCalledOnce()
  })
})
