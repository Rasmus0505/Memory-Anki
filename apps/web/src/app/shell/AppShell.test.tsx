import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell, resetNavSectionHistoryForTest } from '@/app/shell/AppShell'
import {
  __resetBackgroundTaskStoreForTest,
  completeTask,
  getBackgroundTasks,
  registerTask,
} from '@/shared/background-tasks/backgroundTaskRegistry'
import { enqueueMutation, resetMutationQueueForTest } from '@/shared/persistence/mutationQueue'

const getRuntimeInfoApi = vi.fn()
const prefetchPalaceSubjectShelfApi = vi.fn()
const prefetchPalacesGroupedSummaryApi = vi.fn()
const prefetchDashboardApi = vi.fn()

vi.mock('@/entities/runtime/api/runtimeApi', () => ({
  getRuntimeInfoApi: () => getRuntimeInfoApi(),
}))

vi.mock('@/entities/palace/api/catalogApi', () => ({
  prefetchPalaceSubjectShelfApi: () => prefetchPalaceSubjectShelfApi(),
  prefetchPalacesGroupedSummaryApi: () => prefetchPalacesGroupedSummaryApi(),
}))

vi.mock('@/features/dashboard/api/dashboardApi', () => ({
  prefetchDashboardApi: () => prefetchDashboardApi(),
}))

describe('AppShell', () => {
  beforeEach(async () => {
    await resetMutationQueueForTest()
    __resetBackgroundTaskStoreForTest()
    getRuntimeInfoApi.mockReset()
    prefetchPalaceSubjectShelfApi.mockClear()
    prefetchPalacesGroupedSummaryApi.mockClear()
    prefetchDashboardApi.mockClear()
    resetNavSectionHistoryForTest()
  })

  afterEach(async () => {
    await resetMutationQueueForTest()
    __resetBackgroundTaskStoreForTest()
    resetNavSectionHistoryForTest()
    vi.restoreAllMocks()
  })

  function LocationEcho() {
    const location = useLocation()
    return <div>{`${location.pathname}${location.search}${location.hash}`}</div>
  }

  it('shows current runtime channel and short commit badge', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'stable',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
      runtime_generation: 1,
      declared_runtime_generation: 1,
      min_supported_generation: 1,
      max_supported_generation: 1,
      last_started_at: '2026-06-01T12:00:00+08:00',
    })

    render(
      <MemoryRouter>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getAllByText(/Stable abcdef12/).length).toBeGreaterThan(0)
    })
  })

  it('opens the global app log drawer from shell actions', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'dev',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
      runtime_generation: 1,
      declared_runtime_generation: 1,
      min_supported_generation: 1,
      max_supported_generation: 1,
      last_started_at: '2026-06-01T12:00:00+08:00',
    })

    render(
      <MemoryRouter>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    const buttons = await screen.findAllByLabelText('打开日志侧边栏')
    fireEvent.click(buttons[0]!)

    expect(await screen.findByText('调用与错误日志')).toBeTruthy()
  })

  it('opens the mutation queue drawer from shell actions', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'dev',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
      runtime_generation: 1,
      declared_runtime_generation: 1,
      min_supported_generation: 1,
      max_supported_generation: 1,
      last_started_at: '2026-06-01T12:00:00+08:00',
    })
    await enqueueMutation({
      resourceKey: 'time-record:record-1',
      description: '保存学习时长',
      url: '/api/v1/time-records',
      method: 'POST',
      bodyKind: 'json',
      body: JSON.stringify({ id: 'record-1' }),
      replayMode: 'auto',
    })

    render(
      <MemoryRouter>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    const buttons = await screen.findAllByLabelText('打开数据同步侧边栏')
    fireEvent.click(buttons[0]!)

    expect(await screen.findByText('1 项待同步')).toBeTruthy()
    expect(screen.getByText('保存学习时长')).toBeTruthy()
  })

  it('keeps only the reading nav item active on the english reading route', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'stable',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
      runtime_generation: 1,
      declared_runtime_generation: 1,
      min_supported_generation: 1,
      max_supported_generation: 1,
      last_started_at: '2026-06-01T12:00:00+08:00',
    })

    render(
      <MemoryRouter initialEntries={['/english-reading']}>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    await screen.findAllByText(/Stable abcdef12/)

    const readingLink = screen.getAllByRole('link', { name: '英语阅读' })[0]
    const englishLink = screen.getAllByRole('link', { name: '英语听力' })[0]

    expect(readingLink.className).toContain('bg-primary')
    expect(englishLink.className).not.toContain('bg-primary')
  })

  it('keeps palace navigation active on a palace quiz route', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'stable',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
      runtime_generation: 1,
      declared_runtime_generation: 1,
      min_supported_generation: 1,
      max_supported_generation: 1,
      last_started_at: '2026-06-01T12:00:00+08:00',
    })

    render(
      <MemoryRouter initialEntries={['/palaces/12/quiz']}>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    await screen.findAllByText(/Stable abcdef12/)

    const palaceLink = screen.getAllByRole('link', { name: '记忆宫殿' })[0]
    expect(palaceLink.className).toContain('bg-primary')
  })

  it('warms palace navigation targets on hover', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'stable',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
      runtime_generation: 1,
      declared_runtime_generation: 1,
      min_supported_generation: 1,
      max_supported_generation: 1,
      last_started_at: '2026-06-01T12:00:00+08:00',
    })

    render(
      <MemoryRouter>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    await screen.findAllByText(/Stable abcdef12/)
    const beforeHoverCalls = prefetchPalaceSubjectShelfApi.mock.calls.length

    fireEvent.mouseEnter(screen.getAllByRole('link', { name: '记忆宫殿' })[0]!)

    expect(prefetchPalaceSubjectShelfApi.mock.calls.length).toBe(beforeHoverCalls + 1)
    expect(prefetchPalacesGroupedSummaryApi.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('warms core palace routes on startup and dashboard on the home page', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'stable',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
      runtime_generation: 1,
      declared_runtime_generation: 1,
      min_supported_generation: 1,
      max_supported_generation: 1,
      last_started_at: '2026-06-01T12:00:00+08:00',
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    await screen.findAllByText(/Stable abcdef12/)
    await waitFor(() => {
      expect(prefetchPalaceSubjectShelfApi).toHaveBeenCalledTimes(1)
      expect(prefetchPalacesGroupedSummaryApi).toHaveBeenCalledTimes(1)
      expect(prefetchDashboardApi).toHaveBeenCalledTimes(1)
    })
  })

  it('returns palace navigation to the last visited palace child route instead of the shelf root', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'stable',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
      runtime_generation: 1,
      declared_runtime_generation: 1,
      min_supported_generation: 1,
      max_supported_generation: 1,
      last_started_at: '2026-06-01T12:00:00+08:00',
    })

    render(
      <MemoryRouter initialEntries={['/palaces/30/edit?miniPalaceId=5&miniPalaceMode=edit#mindmap']}>
        <AppShell>
          <LocationEcho />
        </AppShell>
      </MemoryRouter>,
    )

    await screen.findAllByText(/Stable abcdef12/)
    expect(screen.getByText('/palaces/30/edit?miniPalaceId=5&miniPalaceMode=edit#mindmap')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('link', { name: '英语听力' })[0]!)
    await waitFor(() => {
      expect(screen.getByText('/english')).toBeTruthy()
    })

    fireEvent.click(screen.getAllByRole('link', { name: '记忆宫殿' })[0]!)
    await waitFor(() => {
      expect(screen.getByText('/palaces/30/edit?miniPalaceId=5&miniPalaceMode=edit#mindmap')).toBeTruthy()
    })
  })

  it('returns review navigation to the last visited review child route', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'stable',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
      runtime_generation: 1,
      declared_runtime_generation: 1,
      min_supported_generation: 1,
      max_supported_generation: 1,
      last_started_at: '2026-06-01T12:00:00+08:00',
    })

    render(
      <MemoryRouter initialEntries={['/review/session/9']}>
        <AppShell>
          <LocationEcho />
        </AppShell>
      </MemoryRouter>,
    )

    await screen.findAllByText(/Stable abcdef12/)
    fireEvent.click(screen.getAllByRole('link', { name: '个人中心' })[0]!)
    await waitFor(() => {
      expect(screen.getByText('/profile')).toBeTruthy()
    })

    fireEvent.click(screen.getAllByRole('link', { name: '复习' })[0]!)
    await waitFor(() => {
      expect(screen.getByText('/review/session/9')).toBeTruthy()
    })
  })

  it('renders quiz-generation bubbles and navigates to practice mode', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'stable',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
      runtime_generation: 1,
      declared_runtime_generation: 1,
      min_supported_generation: 1,
      max_supported_generation: 1,
      last_started_at: '2026-06-01T12:00:00+08:00',
    })
    registerTask({
      id: 'quiz-1',
      section: 'palaceQuiz',
      kind: 'quiz-generation',
      title: '细胞生物学宫殿 · 做题生成中',
      detail: '已保存 4 题，点击去做题。',
      progress: 92,
      navigateTarget: '/palaces/1/quiz?tab=practice',
      bubble: { x: 100, y: 120 },
    })
    completeTask('quiz-1', { detail: '已保存 4 题，点击去做题。' })

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell>
          <LocationEcho />
        </AppShell>
      </MemoryRouter>,
    )

    await screen.findAllByText('细胞生物学宫殿 · 做题生成中')
    expect(screen.getByRole('button', { name: '去做题' })).toBeTruthy()
    expect(getBackgroundTasks()[0]?.bubble).toEqual({ x: 100, y: 120 })

    fireEvent.click(screen.getByRole('button', { name: '去做题' }))

    await waitFor(() => {
      expect(screen.getByText('/palaces/1/quiz?tab=practice')).toBeTruthy()
    })
  })
})
