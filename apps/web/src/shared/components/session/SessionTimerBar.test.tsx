import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionTimerBar } from '@/shared/components/session/SessionTimerBar'
import { DEFAULT_TIMER_AUTOMATION_CONFIG, readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'

describe('SessionTimerBar', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
  })

  it('renders a read-only effective clock with start and complete controls', () => {
    const onStart = vi.fn()
    const onComplete = vi.fn()
    render(
      <SessionTimerBar
        effectiveSeconds={65}
        pauseCount={1}
        status="idle"
        onStart={onStart}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onComplete={onComplete}
      />,
    )
    expect(screen.getByText('1分 5秒')).toBeTruthy()
    expect(screen.queryByLabelText('调整总时长')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '开始' }))
    expect(onStart).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('opens the compact automation settings without idle or break controls', () => {
    render(
      <SessionTimerBar
        effectiveSeconds={1}
        pauseCount={0}
        status="running"
        onStart={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        layout="compact"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '计时设置' }))
    expect(screen.getByRole('checkbox', { name: /进入学习页面自动开始/ })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /计时中保持屏幕常亮/ })).toBeTruthy()
    expect(screen.queryByText(/闲置/)).toBeNull()
    expect(screen.queryByText(/休息/)).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: /进入学习页面自动开始/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(readTimerAutomationConfig()).toEqual({
      ...DEFAULT_TIMER_AUTOMATION_CONFIG,
      autoStartOnPageEnter: true,
    })
  })
})
