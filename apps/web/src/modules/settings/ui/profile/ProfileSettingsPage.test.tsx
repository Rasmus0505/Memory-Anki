import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileSettingsPage from '@/modules/settings/ui/profile/ProfileSettingsPage'
import * as preferencesApi from '@/modules/settings/domain/preferences-entity/api'

vi.mock('@/shared/feedback/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/pwa/resetPwa', () => ({
  resetPwaRuntime: vi.fn(),
}))

function mockSettings() {
  vi.spyOn(preferencesApi, 'getClientPreferencesApi').mockResolvedValue({
    items: {
      memory_anki_shortcuts: null,
      review_feedback_settings: null,
      english_practice_settings: null,
      timer_automation_config: null,
      timer_focus_config: null,
      break_guard_config: null,
      dashboard_duration_filter: null,
      study_goals: null,
      palace_list_view_settings: null,
      palace_shelf_view_settings: null,
      time_record_tags: null,
      freestyle_feed_config: null,
    },
  })
}

describe('ProfileSettingsPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.className = ''
    document.documentElement.style.colorScheme = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the fixed unit ladder without legacy node scheduling settings', async () => {
    mockSettings()

    render(
      <MemoryRouter initialEntries={['/profile']}>
        <ProfileSettingsPage shortcutsSettings={<div>快捷键设置</div>} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('宫殿复习阶梯')).toBeTruthy()
    expect(screen.getByLabelText('固定复习间隔').textContent).toContain('365 天')
    expect(screen.queryByText(/FSRS/)).toBeNull()
    expect(screen.queryByText(/节点.*评分/)).toBeNull()
  })

  it('moves migration links and PWA maintenance into local runtime', async () => {
    mockSettings()

    render(
      <MemoryRouter initialEntries={['/profile']}>
        <ProfileSettingsPage shortcutsSettings={<div>快捷键设置</div>} />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: '本机运行时' }))
    expect(screen.getByText('PWA 更新')).toBeTruthy()
    expect(screen.getByRole('link', { name: '打开迁移与导入导出' }).getAttribute('href')).toBe(
      '/profile/backups?tab=transfer',
    )
  })
  it('removes configurable palace scheduling and daily-plan controls', async () => {
    mockSettings()

    render(
      <MemoryRouter initialEntries={['/profile']}>
        <ProfileSettingsPage shortcutsSettings={<div>快捷键设置</div>} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('宫殿复习阶梯')).toBeTruthy()
    expect(screen.queryByText('目标保持率')).toBeNull()
    expect(screen.queryByLabelText('最大间隔（天）')).toBeNull()
    expect(screen.queryByLabelText('掌握跨度（天）')).toBeNull()
    expect(screen.queryByLabelText('每日新学上限')).toBeNull()
    expect(screen.queryByText('逐卡间隔随机化（默认关闭）')).toBeNull()
  })

  it('renders the local theme setting and applies dark mode immediately', async () => {
    mockSettings()

    render(
      <MemoryRouter initialEntries={['/profile']}>
        <ProfileSettingsPage shortcutsSettings={<div>快捷键设置</div>} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('外观')).toBeTruthy()

    const darkButton = screen.getByText('深色').closest('button')
    expect(darkButton).toBeTruthy()
    fireEvent.click(darkButton!)

    expect(window.localStorage.getItem('memory-anki-theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })
})
