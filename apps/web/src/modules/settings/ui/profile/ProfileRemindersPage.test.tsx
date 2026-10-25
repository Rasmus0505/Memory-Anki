import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProfileRemindersPage from '@/modules/settings/ui/profile/ProfileRemindersPage'
import * as remindersApi from '@/modules/settings/ui/profile/api/remindersApi'
import { toast } from '@/shared/feedback/toast'

vi.mock('@/shared/feedback/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function settingsPayload(overrides: Partial<remindersApi.ReminderSettings> = {}) {
  return {
    settings: {
      enabled: true,
      morning_time: '08:30',
      evening_time: '20:30',
      morning_enabled: true,
      evening_enabled: true,
      morning_window_minutes: 210,
      evening_window_minutes: 150,
      due_threshold: 0,
      content_mode: 'detailed' as const,
      bark_group: 'MemoryAnki',
      icon_url: '',
      quiet_start_hour: 0,
      quiet_end_hour: 8,
      idle_enabled: false,
      idle_after_minutes: 60,
      idle_repeat_minutes: 5,
      idle_max_repeats: 0,
      idle_requires_activity_today: true,
      ready_enabled: false,
      ready_min_units: 5,
      ready_min_gap_minutes: 15,
      hourly_enabled: false,
      daily_cap: 60,
      bark_key_masked: '••••nB4P',
      bark_configured: true,
      ...overrides,
    },
    status: {
      enabled: true,
      bark_configured: true,
      next_at: '2026-10-25T20:30:00+08:00',
      next_slot: 'evening' as const,
      consecutive_failures: 0,
      sent_today: 0,
      daily_cap: 60,
      last_delivery: null,
    },
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/profile/reminders']}>
      <ProfileRemindersPage />
    </MemoryRouter>,
  )
}

describe('ProfileRemindersPage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the masked key and the next planned reminder', async () => {
    vi.spyOn(remindersApi, 'getReminderSettingsApi').mockResolvedValue(settingsPayload())
    renderPage()

    const keyInput = (await screen.findByLabelText('Bark 推送地址')) as HTMLInputElement
    expect(keyInput.placeholder).toBe('••••nB4P')
    expect(screen.getByText(/下次提醒：/).textContent).toContain('晚上催促')
  })

  it('saves the master switch immediately', async () => {
    vi.spyOn(remindersApi, 'getReminderSettingsApi').mockResolvedValue(settingsPayload())
    const update = vi
      .spyOn(remindersApi, 'updateReminderSettingsApi')
      .mockResolvedValue(settingsPayload({ enabled: false }))
    renderPage()

    fireEvent.click(await screen.findByLabelText('启用提醒'))

    await waitFor(() => expect(update).toHaveBeenCalledWith({ enabled: false }))
  })

  it('sends a test notification and reports success', async () => {
    vi.spyOn(remindersApi, 'getReminderSettingsApi').mockResolvedValue(settingsPayload())
    const send = vi
      .spyOn(remindersApi, 'sendTestReminderApi')
      .mockResolvedValue({ ok: true, error: '' })
    renderPage()

    fireEvent.click(await screen.findByText('发送测试通知'))

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it('surfaces a failed test notification with the server reason', async () => {
    vi.spyOn(remindersApi, 'getReminderSettingsApi').mockResolvedValue(settingsPayload())
    vi.spyOn(remindersApi, 'sendTestReminderApi').mockResolvedValue({
      ok: false,
      error: 'bad key',
    })
    renderPage()

    fireEvent.click(await screen.findByText('发送测试通知'))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('发送失败：bad key'),
    )
  })

  it('switches the notification copy to the vague mode', async () => {
    vi.spyOn(remindersApi, 'getReminderSettingsApi').mockResolvedValue(settingsPayload())
    const update = vi
      .spyOn(remindersApi, 'updateReminderSettingsApi')
      .mockResolvedValue(settingsPayload({ content_mode: 'vague' }))
    renderPage()

    fireEvent.click(await screen.findByText('模糊文案'))

    await waitFor(() => expect(update).toHaveBeenCalledWith({ content_mode: 'vague' }))
  })

  it('shows how many pushes today can still produce', async () => {
    vi.spyOn(remindersApi, 'getReminderSettingsApi').mockResolvedValue(
      settingsPayload({ idle_enabled: true, idle_repeat_minutes: 5 }),
    )
    renderPage()

    const budget = await screen.findByText(/按当前设置，今天最多还会收到/)
    // 16 个可用小时 ÷ 5 分钟 = 192，被每日上限 60 截住。
    expect(budget.textContent).toContain('60')
    expect(budget.textContent).toContain('已被每日上限 60 条截住')
  })

  it('previews a single kind with real data', async () => {
    vi.spyOn(remindersApi, 'getReminderSettingsApi').mockResolvedValue(settingsPayload())
    const preview = vi.spyOn(remindersApi, 'previewReminderApi').mockResolvedValue({
      ok: true,
      error: '',
      kind: 'idle',
      title: '还在吗？',
    })
    renderPage()

    fireEvent.click(await screen.findByLabelText('预览闲置拉回'))

    await waitFor(() => expect(preview).toHaveBeenCalledWith('idle'))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it('explains that the computer must be running', async () => {
    vi.spyOn(remindersApi, 'getReminderSettingsApi').mockResolvedValue(settingsPayload())
    renderPage()

    expect(await screen.findByText(/电脑关机或服务没启动时不会推送/)).toBeTruthy()
  })
})
