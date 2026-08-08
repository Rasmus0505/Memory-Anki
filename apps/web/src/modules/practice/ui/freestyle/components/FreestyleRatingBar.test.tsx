import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UnitRatingEffectDto } from '@/modules/practice/public'
import { FreestyleRatingBar } from './FreestyleRatingBar'

const effects: UnitRatingEffectDto[] = [
  {
    rating: 1,
    label: '忘记',
    passed: false,
    target_stage_index: 0,
    target_interval_days: 0,
    target_actual_interval_days: 0,
    target_due_date: '2026-07-27',
    retry_after_cards: 3,
    stage_action: 'reset',
  },
  {
    rating: 2,
    label: '困难',
    passed: false,
    target_stage_index: 0,
    target_interval_days: 0,
    target_actual_interval_days: 0,
    target_due_date: '2026-07-27',
    retry_after_cards: 3,
    stage_action: 'keep',
  },
  {
    rating: 3,
    label: '记得',
    passed: true,
    target_stage_index: 1,
    target_interval_days: 1,
    target_actual_interval_days: 1,
    target_due_date: '2026-07-28',
    retry_after_cards: 0,
    stage_action: 'advance',
  },
  {
    rating: 4,
    label: '轻松',
    passed: true,
    target_stage_index: 2,
    target_interval_days: 3,
    target_actual_interval_days: 3,
    target_due_date: '2026-07-30',
    retry_after_cards: 0,
    stage_action: 'advance',
  },
]

function renderBar(overrides: Partial<Parameters<typeof FreestyleRatingBar>[0]> = {}) {
  const onRate = vi.fn()
  const props = {
    ratingEffects: effects,
    selectedRating: null,
    retryAfterCards: 3,
    busy: false,
    locked: false,
    reviewReady: true,
    hasEncounter: true,
    actionError: null,
    shortcutsActive: true,
    onRate,
    ...overrides,
  }
  render(<FreestyleRatingBar {...props} />)
  return { onRate }
}

describe('FreestyleRatingBar', () => {
  it('prints the schedule consequence on the button so touch users see it before tapping', () => {
    renderBar()

    // Touch has no hover, so the preview cannot live in `title` alone.
    expect(screen.getByTestId('freestyle-rating-button-3').textContent).toBe('记得1天后')
    expect(screen.getByTestId('freestyle-rating-button-4').textContent).toBe('轻松3天后')
    expect(screen.getByTestId('freestyle-rating-button-1').textContent).toBe('忘记3张后')
  })

  it('shows 立即重练 rather than a card count when the retry lands next', () => {
    renderBar({ retryAfterCards: 0 })

    expect(screen.getByTestId('freestyle-rating-button-2').textContent).toBe('困难立即重练')
  })

  it('keeps the full sentence in the accessible name', () => {
    renderBar()

    expect(screen.getByRole('button', { name: '记得：1天后复习 · 7月28日' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '忘记：3张后重练 · 重置到首学阶段' })).toBeTruthy()
  })

  it('rates from the 1-4 shortcuts', () => {
    const { onRate } = renderBar()

    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: '4' })
    expect(onRate.mock.calls).toEqual([[1], [4]])
  })

  it('ignores shortcuts for the card that is not under the viewport', () => {
    const { onRate } = renderBar({ shortcutsActive: false })

    fireEvent.keyDown(window, { key: '3' })
    expect(onRate).not.toHaveBeenCalled()
  })

  it('ignores shortcuts while locked, busy, or already on that rating', () => {
    const locked = renderBar({ locked: true })
    fireEvent.keyDown(window, { key: '3' })
    expect(locked.onRate).not.toHaveBeenCalled()

    const busy = renderBar({ busy: true })
    fireEvent.keyDown(window, { key: '3' })
    expect(busy.onRate).not.toHaveBeenCalled()

    const same = renderBar({ selectedRating: 3 })
    fireEvent.keyDown(window, { key: '3' })
    expect(same.onRate).not.toHaveBeenCalled()
  })

  it('does not steal digits typed into a field', () => {
    const { onRate } = renderBar()
    const input = document.createElement('input')
    document.body.appendChild(input)

    fireEvent.keyDown(input, { key: '2' })
    expect(onRate).not.toHaveBeenCalled()
    input.remove()
  })

  it('keeps four disabled buttons labelled 加载中 before the plan arrives', () => {
    renderBar({ ratingEffects: [], reviewReady: false, hasEncounter: false })

    for (const value of [1, 2, 3, 4]) {
      const button = screen.getByTestId(`freestyle-rating-button-${value}`) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      expect(button.getAttribute('aria-label')).toContain('加载中')
    }
  })

  it('states the blocked reason inline instead of relying on a toast', () => {
    renderBar({ blockedHint: '还有 5 个单元未评分' })

    expect(screen.getByTestId('freestyle-sequential-hint').textContent).toBe('还有 5 个单元未评分')
  })

  it('reports the locked selection after a closed encounter', () => {
    renderBar({ selectedRating: 3, locked: true })

    expect(screen.getByText(/已选记得 · 1天后复习 · 7月28日/)).toBeTruthy()
    expect(screen.getByText('已锁定')).toBeTruthy()
  })
})
