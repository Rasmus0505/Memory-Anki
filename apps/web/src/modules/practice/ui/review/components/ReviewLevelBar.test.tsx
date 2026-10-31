import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adjustUnitScheduleApi } from '@/modules/practice/ui/review/api/unitReviewApi'
import { isoDateFromStudyDay } from '@/modules/practice/ui/review/model/scheduleLimits'
import { ReviewLevelBar } from './ReviewLevelBar'

vi.mock('@/modules/practice/ui/review/api/unitReviewApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/practice/ui/review/api/unitReviewApi')>()),
  adjustUnitScheduleApi: vi.fn(),
}))

const adjust = vi.mocked(adjustUnitScheduleApi)

function renderBar(overrides: Partial<Parameters<typeof ReviewLevelBar>[0]> = {}) {
  const onScheduleAdjusted = vi.fn()
  render(
    <ReviewLevelBar
      unitId="unit-1"
      stageIndex={3}
      intervalDays={7}
      dueDate="2026-11-06"
      due={false}
      adjustable
      onScheduleAdjusted={onScheduleAdjusted}
      {...overrides}
    />,
  )
  return { onScheduleAdjusted }
}

function commitLevel(steps: number) {
  const slider = screen.getByRole('slider', { name: '复习等级' })
  slider.focus()
  for (let index = 0; index < Math.abs(steps); index += 1) {
    const key = steps > 0 ? 'ArrowRight' : 'ArrowLeft'
    fireEvent.keyDown(slider, { key })
    fireEvent.keyUp(slider, { key })
  }
}

beforeEach(() => {
  adjust.mockReset()
  adjust.mockResolvedValue({} as never)
})

describe('ReviewLevelBar', () => {
  it('shows the current level and the booked gap', () => {
    renderBar()

    expect(screen.getByTestId('review-level-current').textContent).toBe('等级 4 · 7–13天')
    expect(screen.getByTestId('review-level-bar').textContent).toContain('间隔 7天')
  })

  it('marks only the unit with a wrong answer this round', () => {
    renderBar({ wrongThisRound: true })
    expect(screen.getByTestId('review-level-bar').getAttribute('data-wrong-this-round')).toBe('true')
    expect(screen.getByTestId('review-level-slider').className).toContain('bg-red-500')
  })

  it('says 今天到期 for a due unit and stays read-only when not adjustable', () => {
    renderBar({ due: true, adjustable: false })

    expect(screen.getByTestId('review-level-bar').textContent).toContain('今天到期')
    expect(screen.getByTestId('review-level-bar').getAttribute('data-adjustable')).toBeNull()
    expect(screen.getByRole('slider', { name: '复习等级' }).getAttribute('data-disabled')).not.toBeNull()
  })

  it('previews on release and writes only after 应用', async () => {
    const { onScheduleAdjusted } = renderBar()

    commitLevel(1)
    expect(await screen.findByText('调整复习等级')).toBeTruthy()
    expect(adjust).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('review-level-apply'))

    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(1))
    expect(adjust).toHaveBeenCalledWith('unit-1', {
      operation_id: expect.any(String),
      stage_index: 4,
      has_passed: true,
    })
    expect(onScheduleAdjusted).toHaveBeenCalledTimes(1)
  })

  it('lets a quick chip retarget the level before applying', async () => {
    renderBar({ stageIndex: 0, intervalDays: 0, due: true })

    commitLevel(1)
    await screen.findByText('调整复习等级')
    fireEvent.click(screen.getByTestId('review-level-quick-7'))
    fireEvent.click(screen.getByTestId('review-level-apply'))

    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(1))
    expect(adjust.mock.calls[0][1]).toMatchObject({ stage_index: 3, has_passed: true })
  })

  it('writes a precise date instead of a level when one is typed', async () => {
    renderBar()

    commitLevel(1)
    await screen.findByText('调整复习等级')
    const target = isoDateFromStudyDay(21)
    fireEvent.change(screen.getByTestId('review-level-custom-date'), {
      target: { value: target },
    })
    fireEvent.click(screen.getByTestId('review-level-apply'))

    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(1))
    expect(adjust.mock.calls[0][1]).toEqual({
      operation_id: expect.any(String),
      due_date: target,
    })
  })

  it('resets to 首学 when dragged to level 0', async () => {
    renderBar()

    commitLevel(-3)
    await screen.findByText('调整复习等级')
    expect(screen.getByText(/首学 · 今天/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('review-level-apply'))

    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(1))
    expect(adjust.mock.calls[0][1]).toMatchObject({ stage_index: 0, has_passed: false })
  })

  it('reports a failed write without closing the confirmation', async () => {
    adjust.mockRejectedValueOnce(new Error('到期日不能超过一年'))
    renderBar()

    commitLevel(1)
    await screen.findByText('调整复习等级')
    fireEvent.click(screen.getByTestId('review-level-apply'))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('一年')
    expect(screen.getByText('调整复习等级')).toBeTruthy()
  })

  it('does not open the confirmation when the level did not change', async () => {
    renderBar()

    commitLevel(0)
    expect(screen.queryByText('调整复习等级')).toBeNull()
    expect(adjust).not.toHaveBeenCalled()
  })
})
