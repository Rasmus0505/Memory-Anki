import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileSettingsPage from '@/features/profile/ProfileSettingsPage'
import * as preferencesApi from '@/entities/preferences/api'
import * as reviewApi from '@/features/review/api'

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
  vi.spyOn(preferencesApi, 'getReviewSettingsApi').mockResolvedValue({
    default_review_mode: 'review',
    sleep_review_time: '22:00',
    early_review_anchor: 'true',
    ebbinghaus_intervals: '1h,sleep,1,2,4,7,15,30,60',
    daily_max_reviews: '0',
    mastered_interval: '30',
    auto_smooth_overdue: 'false',
    overdue_smoothing_days: '7',
    overdue_smoothing_threshold: '5',
    mindmap_ai_split_api_key: '',
    mindmap_ai_split_base_url: '',
    mindmap_ai_split_model: '',
    mindmap_ai_split_temperature: '',
    mindmap_ai_split_max_children: '',
    mindmap_ai_split_include_note: '',
    mindmap_ai_split_custom_instruction: '',
  })
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

  it('repairs historical review stage progress from the settings page', async () => {
    mockSettings()
    const repairSpy = vi.spyOn(reviewApi, 'repairReviewStageProgressApi').mockResolvedValue({
      ok: true,
      palace_count: 3,
      segment_count: 0,
    })

    render(
      <MemoryRouter initialEntries={['/profile']}>
        <ProfileSettingsPage />
      </MemoryRouter>,
    )

    const repairButton = await screen.findByRole('button', {
      name: '一键修复历史宫殿复习进度',
    })
    fireEvent.click(repairButton)

    await waitFor(() => {
      expect(repairSpy).toHaveBeenCalledTimes(1)
      expect(screen.getByText('修复完成：重建 3 个宫殿。')).toBeTruthy()
    })
  })

  it('renders the local theme setting and applies dark mode immediately', async () => {
    mockSettings()

    render(
      <MemoryRouter initialEntries={['/profile']}>
        <ProfileSettingsPage />
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
