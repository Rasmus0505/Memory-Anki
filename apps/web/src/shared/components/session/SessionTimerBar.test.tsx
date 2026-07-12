import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionTimerBar } from '@/shared/components/session/SessionTimerBar'
import {
  readTimerAutomationConfig,
  TIMER_AUTOMATION_STORAGE_KEY,
} from '@/shared/components/session/timer-automation-config'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'

describe('SessionTimerBar', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
  })

  afterEach(() => {
    resetClientPreferenceCacheForTest()
  })

  it('opens automation dialog and saves updated values', () => {
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
    const dialogContent = screen.getByTestId('timer-automation-dialog-content')
    expect(dialogContent.className).toContain('overflow-y-auto')
    expect(dialogContent.className).toContain('overscroll-contain')
    const autoStart = screen.getByRole('checkbox', { name: /进入学习页面自动开始/ })
    fireEvent.click(autoStart)
    fireEvent.change(screen.getByRole('spinbutton', { name: '无点击自动暂停分钟' }), {
      target: { value: '5' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    const saved = readTimerAutomationConfig()
    expect(saved.shared.autoStartOnPageEnter).toBe(true)
    expect(saved.shared.inactiveAutoPauseSeconds).toBe(300)
    expect(saved.english).toEqual(saved.shared)
  })

  it('renders the automation dialog with the wider desktop layout container', () => {
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

    const dialogContent = screen.getByTestId('timer-automation-dialog-content').parentElement
    expect(dialogContent).not.toBeNull()
    expect(dialogContent?.className).toContain('max-w-[1100px]')
    expect(dialogContent?.className).toContain('w-[min(1100px,calc(100vw-24px))]')
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

  it('shows idle seconds against the active scene threshold', () => {
    window.localStorage.setItem(
      TIMER_AUTOMATION_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 3,
        mode: 'global',
        shared: {
          autoStartOnPageEnter: false,
          inactiveAutoPauseSeconds: 300,
          inactivePauseGraceSeconds: 0,
          hiddenAutoPauseSeconds: 0,
          autoPauseRollbackSeconds: 0,
        },
      }),
    )

    render(
      <SessionTimerBar
        effectiveSeconds={30}
        idleSeconds={3}
        automationScene="palace_edit"
        pauseCount={0}
        status="running"
        onStart={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onAdjustDuration={() => {}}
      />,
    )

    expect(screen.getByText('闲置 3/300 秒')).toBeTruthy()
  })

  it('keeps the idle row visible and only highlights it after idle starts', () => {
    const { rerender } = render(
      <SessionTimerBar
        effectiveSeconds={30}
        idleSeconds={0}
        automationScene="palace_edit"
        pauseCount={0}
        status="running"
        onStart={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onAdjustDuration={() => {}}
      />,
    )

    const idleText = screen.getByText('闲置 0/120 秒')
    expect(idleText.className).toContain('text-foreground')
    expect(idleText.className).not.toContain('text-orange-500')

    rerender(
      <SessionTimerBar
        effectiveSeconds={30}
        idleSeconds={12}
        automationScene="palace_edit"
        pauseCount={0}
        status="running"
        onStart={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onAdjustDuration={() => {}}
      />,
    )

    expect(screen.getByText('闲置 12/120 秒').className).toContain('text-orange-500')
  })
})
