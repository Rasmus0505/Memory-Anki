import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TIMER_AUTOMATION_CONFIG } from './timer-automation-config'
import { TimerAutomationDialog } from './TimerAutomationDialog'

describe('TimerAutomationDialog', () => {
  it('marks the dialog as excluded from automatic timer activity', () => {
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
  })
})
