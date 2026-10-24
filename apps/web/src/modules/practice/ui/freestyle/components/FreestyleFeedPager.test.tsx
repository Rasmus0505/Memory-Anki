import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FreestyleFeedPager } from './FreestyleFeedPager'

function renderPager(
  overrides: Partial<Parameters<typeof FreestyleFeedPager>[0]> = {},
) {
  const props = {
    canGoPrevious: true,
    canGoNext: true,
    canComplete: true,
    completeTitle: '进入本轮结算',
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onComplete: vi.fn(),
    ...overrides,
  }
  render(<FreestyleFeedPager {...props} />)
  return props
}

describe('FreestyleFeedPager', () => {
  it('shows the same three buttons on PWA and desktop', () => {
    renderPager()

    const previous = screen.getByRole('button', { name: '上一张' })
    const next = screen.getByRole('button', { name: '下一张' })
    const complete = screen.getByRole('button', { name: '完成' })

    expect(previous.className).not.toMatch(/\bhidden\b/)
    expect(next.className).not.toMatch(/\bhidden\b/)
    expect(complete.className).not.toMatch(/\bhidden\b/)
    expect(screen.queryByRole('button', { name: '上一组' })).toBeNull()
    expect(screen.queryByRole('button', { name: '跳过本组' })).toBeNull()
  })

  it('pages with the same handlers the feed already uses', () => {
    const props = renderPager()

    fireEvent.click(screen.getByRole('button', { name: '下一张' }))
    fireEvent.click(screen.getByRole('button', { name: '上一张' }))
    fireEvent.click(screen.getByRole('button', { name: '完成' }))

    expect(props.onNext).toHaveBeenCalledTimes(1)
    expect(props.onPrevious).toHaveBeenCalledTimes(1)
    expect(props.onComplete).toHaveBeenCalledTimes(1)
  })

  it('keeps card paging labels and does not revive palace jump buttons', () => {
    renderPager()

    expect(screen.getByRole('button', { name: '上一张' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '下一张' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '上一宫殿' })).toBeNull()
    expect(screen.queryByRole('button', { name: '下一宫殿' })).toBeNull()
    expect(screen.queryByRole('button', { name: '最早未评' })).toBeNull()
  })

  it('disables 完成 when there is nothing to seek', () => {
    renderPager({
      canComplete: false,
      completeTitle: '定位到最早还没评分的单元',
    })

    expect((screen.getByRole('button', { name: '完成' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('sits on the right edge as a vertical column on phones, like desktop', () => {
    const { container } = render(
      <FreestyleFeedPager
        canGoPrevious
        canGoNext
        canComplete
        completeTitle="进入本轮结算"
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onComplete={vi.fn()}
      />,
    )
    const shell = container.firstElementChild as HTMLElement
    // Right edge, vertically centred, never the old strip above the rating dock.
    expect(shell.className).toContain('right-1')
    expect(shell.className).toContain('top-1/2')
    expect(shell.className).not.toContain('bottom-')
    const group = screen.getByTestId('freestyle-feed-pager')
    expect(group.className).toContain('flex-col')
    expect(group.className).not.toContain('flex-row')
  })

  it('releases the pager focus after paging so Enter flips the new card', () => {
    const props = renderPager()
    const next = screen.getByRole('button', { name: '下一张' }) as HTMLButtonElement
    next.focus()
    expect(document.activeElement).toBe(next)

    fireEvent.click(next)

    expect(props.onNext).toHaveBeenCalledTimes(1)
    expect(document.activeElement).not.toBe(next)
  })
})
