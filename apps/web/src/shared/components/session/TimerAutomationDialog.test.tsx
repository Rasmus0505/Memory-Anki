import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TIMER_AUTOMATION_CONFIG } from './timer-automation-config'
import { TimerAutomationDialog } from './TimerAutomationDialog'

describe('TimerAutomationDialog', () => {
  it('exposes only auto-start and screen-awake controls', () => {
    render(
      <TimerAutomationDialog
        open
        config={DEFAULT_TIMER_AUTOMATION_CONFIG}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
        onReset={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog').getAttribute('data-timer-activity')).toBe('ignore')
    expect(screen.getByRole('checkbox', { name: /进入学习页面自动开始/ })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /计时中保持屏幕常亮/ })).toBeTruthy()
    expect(screen.queryByText(/休息/)).toBeNull()
    expect(screen.queryByText(/闲置/)).toBeNull()
  })

  it('saves the two supported settings only', () => {
    const onSave = vi.fn()
    render(
      <TimerAutomationDialog
        open
        config={DEFAULT_TIMER_AUTOMATION_CONFIG}
        onOpenChange={vi.fn()}
        onSave={onSave}
        onReset={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: /进入学习页面自动开始/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).toHaveBeenCalledWith({
      schemaVersion: DEFAULT_TIMER_AUTOMATION_CONFIG.schemaVersion,
      autoStartOnPageEnter: true,
      keepScreenAwake: true,
    })
  })
})
