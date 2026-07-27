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
  vi.spyOn(preferencesApi, 'getReviewSettingsApi').mockResolvedValue({
    default_review_mode: 'review',
    desired_retention: '0.90',
    mastery_horizon_days: '60',
    maximum_interval: '36500',
    learning_steps: '10m,1h',
    relearning_steps: '10m,1h',
    enable_fuzzing: 'false',
    daily_new_limit: '20',
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
      review_queue_view_settings: null,
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

  it('describes FSRS scheduling without exposing legacy stage repair controls', async () => {
    mockSettings()

    render(
      <MemoryRouter initialEntries={['/profile']}>
        <ProfileSettingsPage shortcutsSettings={<div>快捷键设置</div>} />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/FSRS 会根据每个节点的实际评分计算下一次复习时间/)).toBeTruthy()
    expect(screen.getByText(/旧艾宾浩斯记录保留在数据库中用于迁移审计/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '一键修复历史宫殿复习进度' })).toBeNull()
  })

  it('renders live FSRS/daily-plan settings and drops dead legacy configs', async () => {
    mockSettings()

    render(
      <MemoryRouter initialEntries={['/profile']}>
        <ProfileSettingsPage shortcutsSettings={<div>快捷键设置</div>} />
      </MemoryRouter>,
    )

    // 真实生效的配置
    expect(await screen.findByText('目标保持率')).toBeTruthy()
    expect(screen.getByLabelText('最大间隔（天）')).toBeTruthy()
    expect(screen.getByLabelText('首次学习短期步骤')).toBeTruthy()
    expect(screen.getByLabelText('遗忘后短期步骤')).toBeTruthy()
    expect(screen.getByLabelText('每日新学上限')).toBeTruthy()
    expect(screen.queryByLabelText('每日复习上限')).toBeNull()
    expect(screen.getByText('逐卡间隔随机化（默认关闭）')).toBeTruthy()
    expect(screen.getByText(/目标保持率越高复习越频繁/)).toBeTruthy()

    // 已删除的死配置不再渲染
    expect(screen.queryByText('睡前复习时间')).toBeNull()
    expect(screen.queryByText('每日正式复习上限')).toBeNull()
    expect(screen.queryByText('逾期平滑窗口天数')).toBeNull()
    expect(screen.queryByText('默认自动平滑逾期任务')).toBeNull()
    expect(screen.queryByText('提前复习锚定策略')).toBeNull()
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
