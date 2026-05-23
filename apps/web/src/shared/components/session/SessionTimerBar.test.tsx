import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionTimerBar } from '@/shared/components/session/SessionTimerBar'
import { TIMER_AUTOMATION_STORAGE_KEY } from '@/shared/components/session/timer-automation-config'

describe('SessionTimerBar', () => {
  it('opens automation dialog and saves updated values', () => {
    window.localStorage.clear()

    render(
      <SessionTimerBar
        effectiveSeconds={1}
        pauseCount={0}
        status="running"
        onStart={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onAdjustDuration={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '自动化配置' }))
    fireEvent.change(screen.getAllByDisplayValue('20')[0], { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    const saved = JSON.parse(window.localStorage.getItem(TIMER_AUTOMATION_STORAGE_KEY) || '{}')
    expect(saved.palace_edit.inactiveAutoPauseSeconds).toBe(30)
  })

  it('keeps local input editing isolated from live seconds updates', () => {
    const onAdjustDuration = vi.fn()

    const { rerender } = render(
      <SessionTimerBar
        effectiveSeconds={1}
        pauseCount={0}
        status="running"
        onStart={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onAdjustDuration={onAdjustDuration}
      />,
    )

    const input = screen.getByLabelText('调整总时长') as HTMLInputElement
    expect(input.value).toBe('00:00:01')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '00:00:09' } })
    rerender(
      <SessionTimerBar
        effectiveSeconds={2}
        pauseCount={0}
        status="running"
        onStart={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onAdjustDuration={onAdjustDuration}
      />,
    )

    expect(input.value).toBe('00:00:09')

    fireEvent.blur(input)
    expect(onAdjustDuration).toHaveBeenCalledWith(9)
  })

  it('resets invalid input back to the current effective seconds on blur', () => {
    const onAdjustDuration = vi.fn()

    render(
      <SessionTimerBar
        effectiveSeconds={5}
        pauseCount={0}
        status="running"
        onStart={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onAdjustDuration={onAdjustDuration}
      />,
    )

    const input = screen.getByLabelText('调整总时长') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'bad-value' } })
    fireEvent.blur(input)

    expect(onAdjustDuration).not.toHaveBeenCalled()
    expect(input.value).toBe('00:00:05')
  })
})
