import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import ProfileTimerPage from '@/modules/settings/ui/profile/ProfileTimerPage'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'

describe('ProfileTimerPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
  })

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={['/profile/timer']}>
        <ProfileTimerPage />
      </MemoryRouter>,
    )
  }

  it('edits and saves the two supported timer settings in place', () => {
    renderPage()

    fireEvent.click(screen.getByRole('checkbox', { name: /进入学习页面自动开始/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(readTimerAutomationConfig().autoStartOnPageEnter).toBe(true)
  })

  it('owns the settings that decide whether time keeps counting', () => {
    renderPage()

    fireEvent.click(screen.getByRole('checkbox', { name: /计时中保持屏幕常亮/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    const automation = readTimerAutomationConfig()
    expect(automation.keepScreenAwake).toBe(false)
    expect(automation).not.toHaveProperty('backgroundGraceSeconds')
  })

  it('disables save until something changes', () => {
    // Also guards the defaults: if any default fails to survive its own
    // sanitize roundtrip the page would open permanently "dirty".
    renderPage()

    expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /进入学习页面自动开始/ }))
    expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(false)
  })
})
