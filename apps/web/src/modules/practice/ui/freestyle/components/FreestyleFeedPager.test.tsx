import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FreestyleFeedPager } from './FreestyleFeedPager'

function renderPager(
  overrides: Partial<Parameters<typeof FreestyleFeedPager>[0]> = {},
) {
  const props = {
    canGoPrevious: true,
    canGoNext: true,
    canGoPreviousPalace: true,
    canGoNextPalace: true,
    canComplete: true,
    completeTitle: '进入本轮结算',
    sequentialBlockedHint: null,
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onComplete: vi.fn(),
    onPreviousPalace: vi.fn(),
    onSkipPalace: vi.fn(),
    ...overrides,
  }
  render(<FreestyleFeedPager {...props} />)
  return props
}

describe('FreestyleFeedPager', () => {
  it('keeps prev/next on the phone dock and hides palace skip below lg', () => {
    renderPager()

    const previous = screen.getByRole('button', { name: '上一张' })
    const next = screen.getByRole('button', { name: '下一张' })
    const previousPalace = screen.getByRole('button', { name: '上一组', hidden: true })
    const skipPalace = screen.getByRole('button', { name: '跳过本组', hidden: true })

    const complete = screen.getByRole('button', { name: '完成' })

    expect(previous.className).not.toMatch(/\bhidden\b/)
    expect(next.className).not.toMatch(/\bhidden\b/)
    expect(complete.className).not.toMatch(/\bhidden\b/)
    expect(previousPalace.className).toMatch(/\bhidden\b/)
    expect(previousPalace.className).toMatch(/\blg:inline-flex\b/)
    expect(skipPalace.className).toMatch(/\bhidden\b/)
    expect(skipPalace.className).toMatch(/\blg:inline-flex\b/)
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

  it('keeps card paging labels even when palace skip buttons exist', () => {
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
      completeTitle: '定位到最早还没完成的单元',
    })

    expect((screen.getByRole('button', { name: '完成' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
