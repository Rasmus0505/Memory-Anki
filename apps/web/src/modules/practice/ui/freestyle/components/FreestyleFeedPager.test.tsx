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
    sequentialBlockedHint: null,
    onPrevious: vi.fn(),
    onNext: vi.fn(),
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

    expect(previous.className).not.toMatch(/\bhidden\b/)
    expect(next.className).not.toMatch(/\bhidden\b/)
    expect(previousPalace.className).toMatch(/\bhidden\b/)
    expect(previousPalace.className).toMatch(/\blg:inline-flex\b/)
    expect(skipPalace.className).toMatch(/\bhidden\b/)
    expect(skipPalace.className).toMatch(/\blg:inline-flex\b/)
  })

  it('pages with the same handlers the feed already uses', () => {
    const props = renderPager()

    fireEvent.click(screen.getByRole('button', { name: '下一张' }))
    fireEvent.click(screen.getByRole('button', { name: '上一张' }))

    expect(props.onNext).toHaveBeenCalledTimes(1)
    expect(props.onPrevious).toHaveBeenCalledTimes(1)
  })

  it('relabels prev/next as palace jumps in palace rating mode', () => {
    renderPager({ palaceMode: true })

    expect(screen.getByRole('button', { name: '上一宫殿' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '下一宫殿' })).toBeTruthy()
  })
})
