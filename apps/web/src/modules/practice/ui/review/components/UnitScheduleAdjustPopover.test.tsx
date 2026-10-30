import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adjustUnitScheduleApi } from '@/modules/practice/ui/review/api/unitReviewApi'
import { isoDateFromStudyDay } from '@/modules/practice/ui/review/model/scheduleLimits'
import { UnitScheduleAdjustPopover } from './UnitScheduleAdjustPopover'

vi.mock('@/modules/practice/ui/review/api/unitReviewApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/practice/ui/review/api/unitReviewApi')>()),
  adjustUnitScheduleApi: vi.fn(),
}))

const adjust = vi.mocked(adjustUnitScheduleApi)

function renderPopover(overrides: Partial<Parameters<typeof UnitScheduleAdjustPopover>[0]> = {}) {
  const onAdjusted = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <UnitScheduleAdjustPopover
      unitId="unit-1"
      dueDate={isoDateFromStudyDay(3)}
      open
      onOpenChange={onOpenChange}
      onAdjusted={onAdjusted}
      {...overrides}
    >
      <button type="button">调整</button>
    </UnitScheduleAdjustPopover>,
  )
  return { onAdjusted, onOpenChange }
}

beforeEach(() => {
  adjust.mockReset()
  adjust.mockResolvedValue({} as never)
})

describe('UnitScheduleAdjustPopover', () => {
  it('shows what each preset books before it is saved', () => {
    renderPopover()

    expect(screen.getByText('调整复习进度')).toBeTruthy()
    expect(screen.getByText(/当前到期/)).toBeTruthy()
    expect(screen.getByTestId('schedule-preset-1').textContent).toContain('明天')
    expect(screen.getByTestId('schedule-preset-1').textContent).toContain('间隔 1天')
    expect(screen.getByTestId('schedule-preset-7').textContent).toContain('7天后')
    // The month/day target is spelled out, not left to the learner to infer.
    const [, month, day] = isoDateFromStudyDay(7).split('-').map(Number)
    expect(screen.getByTestId('schedule-preset-7').textContent).toContain(`${month}月${day}日`)
  })

  it('saves a preset as a due-date-only write', async () => {
    const { onAdjusted, onOpenChange } = renderPopover()

    fireEvent.click(screen.getByTestId('schedule-preset-7'))

    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(1))
    expect(adjust).toHaveBeenCalledWith('unit-1', {
      operation_id: expect.any(String),
      due_date: isoDateFromStudyDay(7),
    })
    expect(onAdjusted).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('saves a custom date and states the resulting interval', async () => {
    renderPopover()
    const target = isoDateFromStudyDay(21)

    fireEvent.change(screen.getByTestId('schedule-custom-date'), {
      target: { value: target },
    })
    expect(screen.getByText(new RegExp(`间隔 21天`))).toBeTruthy()
    fireEvent.click(screen.getByTestId('schedule-custom-save'))

    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(1))
    expect(adjust.mock.calls[0][1]).toMatchObject({ due_date: target })
  })

  it('reports a failed write instead of closing silently', async () => {
    adjust.mockRejectedValueOnce(new Error('到期日不能超过一年。复习间隔最长一年'))
    const { onOpenChange } = renderPopover()

    fireEvent.click(screen.getByTestId('schedule-preset-1'))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('最长一年')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
