import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

  it('ignores shortcuts while locked, but not while another save is on the wire', () => {
    const locked = renderBar({ locked: true })
    fireEvent.keyDown(window, { key: '3' })
    expect(locked.onRate).not.toHaveBeenCalled()
    cleanup()

    // A pending save never freezes 1-4; only a modal suspends them.
    const saving = renderBar({ busy: true, pendingRating: 2 })
    fireEvent.keyDown(window, { key: '3' })
    expect(saving.onRate).toHaveBeenCalledWith(3)
    expect((screen.getByTestId('freestyle-rating-button-4') as HTMLButtonElement).disabled).toBe(false)
  })

  it('suspends 1-4 while a modal dialog owns the keyboard', () => {
    const { onRate } = renderBar()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const inside = document.createElement('button')
    dialog.appendChild(inside)
    document.body.appendChild(dialog)
    fireEvent.keyDown(inside, { key: '3' })
    expect(onRate).not.toHaveBeenCalled()
    dialog.remove()
  })

  it('shows 未保存 with a retry hint for a failed save, even before the plan arrives', () => {
    renderBar({ ratingEffects: [], failedRating: 3, canRateWithoutPlan: true, hasEncounter: false })
    expect(screen.getByTestId('freestyle-rating-unsaved-line').textContent).toBe('未保存记得再点一次重试')
    const failed = screen.getByTestId('freestyle-rating-button-3')
    expect(failed.getAttribute('aria-pressed')).toBe('false')
    expect(failed.getAttribute('data-failed')).toBe('true')
    expect(failed.getAttribute('aria-label')).toContain('再点一次重试')
  })

  it('shows a this-round last rating without offering 再点取消', () => {
    renderBar({ selectedRating: null, recordedRating: 3 })

    expect(screen.getByText(/已选记得/)).toBeTruthy()
    expect(screen.getByText('上次评分')).toBeTruthy()
    expect(screen.queryByText('再点取消')).toBeNull()
    expect(screen.getByTestId('freestyle-rating-button-3').getAttribute('aria-label')).toContain('上次评分')
    expect(screen.getByTestId('freestyle-rating-button-3').getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps the selected rating clickable so a second tap can clear it', () => {
    const { onRate } = renderBar({ selectedRating: 3 })
    const remembered = screen.getByTestId('freestyle-rating-button-3') as HTMLButtonElement

    expect(remembered.disabled).toBe(false)
    expect(remembered.getAttribute('aria-label')).toContain('再点取消评分')
    expect(screen.getByText('再点取消')).toBeTruthy()
    fireEvent.click(remembered)
    expect(onRate).toHaveBeenCalledWith(3)
  })

  it('repeats the selected rating shortcut so the parent can clear it', () => {
    const { onRate } = renderBar({ selectedRating: 3 })

    fireEvent.keyDown(window, { key: '3' })
    expect(onRate).toHaveBeenCalledWith(3)
  })

  it('does not steal digits typed into a field', () => {
    const { onRate } = renderBar()
    const input = document.createElement('input')
    document.body.appendChild(input)

    fireEvent.keyDown(input, { key: '2' })
    expect(onRate).not.toHaveBeenCalled()
    input.remove()
  })

  it('lets the learner score before the plan arrives', () => {
    const { onRate } = renderBar({
      ratingEffects: [],
      reviewReady: false,
      hasEncounter: false,
      canRateWithoutPlan: true,
    })

    const button = screen.getByTestId('freestyle-rating-button-3') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-label')).toContain('记下')
    fireEvent.click(button)
    expect(onRate).toHaveBeenCalledWith(3)
  })

  it('keeps four disabled buttons labelled 这张还不能评分 when the card cannot be scored yet', () => {
    renderBar({ ratingEffects: [], reviewReady: false, hasEncounter: false })

    for (const value of [1, 2, 3, 4]) {
      const button = screen.getByTestId(`freestyle-rating-button-${value}`) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      expect(button.getAttribute('aria-label')).toContain('这张还不能评分')
    }
  })

  it('states the blocked reason inline instead of relying on a toast', () => {
    renderBar({ blockedHint: '还有 5 个单元未评分' })

    expect(screen.getByTestId('freestyle-sequential-hint').textContent).toBe('还有 5 个单元未评分')
  })

  it('switches the preview to a palace count instead of one unit interval', () => {
    const onRatingScopeChange = vi.fn()
    renderBar({
      ratingScope: 'palace',
      palaceDueCount: 5,
      onRatingScopeChange,
    })

    expect(screen.getByTestId('freestyle-rating-scope-palace').textContent).toBe('宫殿 · 今日 5')
    expect(screen.getByTestId('freestyle-rating-button-3').textContent).toBe('记得5小节')
    expect(screen.getByTestId('freestyle-rating-button-1').textContent).toBe('忘记5小节重练')
    fireEvent.click(screen.getByTestId('freestyle-rating-scope-unit'))
    expect(onRatingScopeChange).toHaveBeenCalledWith('unit')
  })

  it('reports the locked selection after a closed encounter', () => {
    renderBar({ selectedRating: 3, locked: true })

    expect(screen.getByText(/已选记得 · 1天后复习 · 7月28日/)).toBeTruthy()
    expect(screen.getByText('已锁定')).toBeTruthy()
  })

  describe('in-flight rate', () => {
    it('does not light the tapped rating as chosen before the server answers', () => {
      renderBar({ pendingRating: 2, busy: true })

      const pressed = screen.getByTestId('freestyle-rating-button-2')
      expect(pressed.getAttribute('aria-pressed')).toBe('false')
      expect(pressed.getAttribute('aria-busy')).toBe('true')
      expect(screen.getByTestId('freestyle-rating-pending-2')).toBeTruthy()
      expect(screen.getByTestId('freestyle-rating-saving-line').textContent).toContain('保存中')
    })

    it('shows only a quiet 保存中 line, never 已选 or the schedule effect, while saving', () => {
      renderBar({ pendingRating: 3, busy: true })

      expect(screen.getByTestId('freestyle-rating-saving-line').textContent).toBe('保存中…')
      expect(screen.queryByTestId('freestyle-rating-effect-line')).toBeNull()
      expect(screen.queryByText(/已选/)).toBeNull()
    })

    it('keeps the last confirmed grade lit while another one saves', () => {
      renderBar({ selectedRating: 3, pendingRating: 4, busy: true })

      expect(screen.getByTestId('freestyle-rating-button-3').getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByTestId('freestyle-rating-button-4').getAttribute('aria-pressed')).toBe('false')
    })

    it('does not mark a pending rate as 已锁定 while it is still in flight', () => {
      renderBar({ pendingRating: 3, busy: true, locked: true })

      expect(screen.queryByText('已锁定')).toBeNull()
    })

    it('keeps the chosen button at full opacity while the others dim', () => {
      renderBar({ selectedRating: 3 })

      expect(screen.getByTestId('freestyle-rating-button-3').className)
        .toContain('disabled:opacity-100')
      expect(screen.getByTestId('freestyle-rating-button-1').className)
        .toContain('disabled:opacity-55')
    })

    it('leaves the pending spinner out of the button text', () => {
      renderBar({ pendingRating: 3, busy: true })

      // The schedule preview is the whole readable label; a spinner must not join it.
      expect(screen.getByTestId('freestyle-rating-button-3').textContent).toBe('记得1天后')
    })
  })
})

describe('移除本队列', () => {
  it('sits to the left of the four ratings and does not rate on the first press', () => {
    const onRemoveFromQueue = vi.fn()
    const { onRate } = renderBar({ onRemoveFromQueue })

    const remove = screen.getByTestId('freestyle-rating-button-remove')
    const forgot = screen.getByTestId('freestyle-rating-button-1')
    expect(remove.compareDocumentPosition(forgot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(remove.textContent).toContain('移除本队列')
    expect(remove.textContent).toContain('本轮结束')

    fireEvent.click(remove)
    expect(onRemoveFromQueue).not.toHaveBeenCalled()
    expect(onRate).not.toHaveBeenCalled()
    expect(remove.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('freestyle-rating-effect-line').textContent).toContain('再点确认移除')
    expect(screen.getByTestId('freestyle-rating-effect-line').textContent).toContain('本轮不再安排')
  })

  it('removes only on the second press and leaves the schedule ratings untouched', () => {
    const onRemoveFromQueue = vi.fn()
    const { onRate } = renderBar({ onRemoveFromQueue, selectedRating: 3 })

    const remove = screen.getByTestId('freestyle-rating-button-remove')
    fireEvent.click(remove)
    fireEvent.click(remove)
    expect(onRemoveFromQueue).toHaveBeenCalledTimes(1)
    expect(onRate).not.toHaveBeenCalled()
  })

  it('arms and confirms from the 5 key without treating 5 as a rating', () => {
    const onRemoveFromQueue = vi.fn()
    const { onRate } = renderBar({ onRemoveFromQueue })

    fireEvent.keyDown(window, { key: '5' })
    expect(onRemoveFromQueue).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: '5' })
    expect(onRemoveFromQueue).toHaveBeenCalledTimes(1)
    expect(onRate).not.toHaveBeenCalled()
  })

  it('drops the armed remove when a memory rating is chosen instead', () => {
    const onRemoveFromQueue = vi.fn()
    const { onRate } = renderBar({ onRemoveFromQueue })

    fireEvent.click(screen.getByTestId('freestyle-rating-button-remove'))
    fireEvent.click(screen.getByTestId('freestyle-rating-button-3'))
    expect(onRemoveFromQueue).not.toHaveBeenCalled()
    expect(onRate).toHaveBeenCalledWith(3)
    expect(screen.queryByText('再点确认移除 · 本轮不再安排')).toBeNull()
  })

  it('stays available before the review session loads', () => {
    const onRemoveFromQueue = vi.fn()
    renderBar({
      ratingEffects: [],
      reviewReady: false,
      hasEncounter: false,
      locked: true,
      onRemoveFromQueue,
    })

    const remove = screen.getByTestId('freestyle-rating-button-remove') as HTMLButtonElement
    expect(remove.disabled).toBe(false)
    fireEvent.click(remove)
    fireEvent.click(remove)
    expect(onRemoveFromQueue).toHaveBeenCalledTimes(1)
  })

  it('stays off hint cards, which are not queue units', () => {
    renderBar({ ratingEffects: [], hintMode: true, reviewReady: true })
    expect(screen.queryByTestId('freestyle-rating-button-remove')).toBeNull()
  })
})

describe('hintMode', () => {
  it('labels the buttons 继续 instead of schedule copy', () => {
    renderBar({ ratingEffects: [], hintMode: true, reviewReady: true })

    for (const value of [1, 2, 3, 4]) {
      const button = screen.getByTestId(`freestyle-rating-button-${value}`) as HTMLButtonElement
      expect(button.disabled).toBe(false)
      expect(button.getAttribute('aria-label')).toContain('继续')
      expect(button.getAttribute('aria-label')).not.toContain('计划不可用')
    }
  })

  it('still routes the tap through onRate so the parent can advance', () => {
    const { onRate } = renderBar({ ratingEffects: [], hintMode: true })
    fireEvent.click(screen.getByTestId('freestyle-rating-button-3'))
    expect(onRate).toHaveBeenCalledWith(3)
  })
})

describe('永久移除', () => {
  it('sits between 移除本队列 and the four ratings and says it stops future review', () => {
    renderBar({ onRemoveFromQueue: vi.fn(), onRemovePermanently: vi.fn() })

    const round = screen.getByTestId('freestyle-rating-button-remove')
    const permanent = screen.getByTestId('freestyle-rating-button-remove-permanent')
    const forgot = screen.getByTestId('freestyle-rating-button-1')
    expect(round.compareDocumentPosition(permanent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(permanent.compareDocumentPosition(forgot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(permanent.textContent).toContain('永久移除')
    expect(permanent.textContent).toContain('不再复习')
  })

  it('removes permanently only on the second press and never rates', () => {
    const onRemoveFromQueue = vi.fn()
    const onRemovePermanently = vi.fn()
    const { onRate } = renderBar({ onRemoveFromQueue, onRemovePermanently, selectedRating: 3 })

    const permanent = screen.getByTestId('freestyle-rating-button-remove-permanent')
    fireEvent.click(permanent)
    expect(onRemovePermanently).not.toHaveBeenCalled()
    expect(permanent.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('freestyle-rating-effect-line').textContent).toContain('再点确认永久移除')

    fireEvent.click(permanent)
    expect(onRemovePermanently).toHaveBeenCalledTimes(1)
    expect(onRemoveFromQueue).not.toHaveBeenCalled()
    expect(onRate).not.toHaveBeenCalled()
  })

  it('switching from 移除本队列 to 永久移除 re-arms instead of confirming the first', () => {
    const onRemoveFromQueue = vi.fn()
    const onRemovePermanently = vi.fn()
    renderBar({ onRemoveFromQueue, onRemovePermanently })

    fireEvent.click(screen.getByTestId('freestyle-rating-button-remove'))
    fireEvent.click(screen.getByTestId('freestyle-rating-button-remove-permanent'))
    expect(onRemoveFromQueue).not.toHaveBeenCalled()
    expect(onRemovePermanently).not.toHaveBeenCalled()
    expect(screen.getByTestId('freestyle-rating-button-remove-permanent').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('freestyle-rating-button-remove').getAttribute('aria-pressed')).toBe('false')
  })

  it('is absent when the card cannot be removed permanently', () => {
    renderBar({ onRemoveFromQueue: vi.fn() })
    expect(screen.queryByTestId('freestyle-rating-button-remove-permanent')).toBeNull()
    expect(screen.getByTestId('freestyle-rating-button-remove')).toBeTruthy()
  })
})
