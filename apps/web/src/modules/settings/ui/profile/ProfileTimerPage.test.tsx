import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileTimerPage from '@/modules/settings/ui/profile/ProfileTimerPage'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { readTimerFocusConfig } from '@/shared/components/session/timer-focus-config'
import { readBreakGuardConfig } from '@/shared/components/session/break-guard-config'
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

  it('edits and saves in place instead of only mirroring a dialog', () => {
    renderPage()

    fireEvent.change(screen.getByRole('textbox', { name: '每轮专注目标分钟' }), {
      target: { value: '50' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(readTimerFocusConfig().primaryMinutes).toBe(50)
  })

  it('owns the settings that decide whether time keeps counting', () => {
    renderPage()

    fireEvent.click(screen.getByRole('checkbox', { name: /计时中保持屏幕常亮/ }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '切后台宽限秒数' }), {
      target: { value: '45' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    const automation = readTimerAutomationConfig()
    expect(automation.keepScreenAwake).toBe(false)
    expect(automation.backgroundGraceSeconds).toBe(45)
  })

  it('asks for notification permission before enabling break reminders', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied')
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'default', requestPermission },
    })
    renderPage()

    fireEvent.click(screen.getByRole('checkbox', { name: /休息到点发桌面通知/ }))

    expect(requestPermission).toHaveBeenCalledTimes(1)
    // A denied permission must not leave the switch claiming it is on.
    await screen.findByRole('checkbox', { name: /休息到点发桌面通知/ })
    expect(
      (screen.getByRole('checkbox', { name: /休息到点发桌面通知/ }) as HTMLInputElement).checked,
    ).toBe(false)
    expect(readBreakGuardConfig().notifyOnBreakExpired).toBe(false)
  })

  it('disables save until something changes', () => {
    // Also guards the defaults: if any default fails to survive its own
    // sanitize roundtrip the page would open permanently "dirty".
    renderPage()

    expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: '每轮专注目标分钟' }), {
      target: { value: '40' },
    })
    expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(false)
  })
})
