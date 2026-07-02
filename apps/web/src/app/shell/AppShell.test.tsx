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

const getRuntimeInfoApi = vi.fn()
const prefetchPalaceSubjectShelfApi = vi.fn()
const prefetchPalacesGroupedSummaryApi = vi.fn()
const prefetchDashboardApi = vi.fn()
const prefetchReviewQueueApi = vi.fn()
const prefetchSegmentReviewQueueApi = vi.fn()
const preloadPracticeRoutes = vi.fn()
const preloadReviewRoutes = vi.fn()
const preloadEnglishWorkspacePage = vi.fn()
const preloadEnglishReadingPage = vi.fn()
const preloadFreestylePage = vi.fn()
const preloadKnowledgePage = vi.fn()
const preloadPalaceEditPage = vi.fn()
const preloadProfilePage = vi.fn()

vi.mock('@/entities/runtime/api', () => ({
  getRuntimeInfoApi: () => getRuntimeInfoApi(),
}))

vi.mock('@/entities/palace/api', () => ({
  prefetchPalaceSubjectShelfApi: () => prefetchPalaceSubjectShelfApi(),
  prefetchPalacesGroupedSummaryApi: () => prefetchPalacesGroupedSummaryApi(),
}))

vi.mock('@/features/dashboard/api', () => ({
  prefetchDashboardApi: () => prefetchDashboardApi(),
}))

vi.mock('@/features/review/api', () => ({
  prefetchReviewQueueApi: () => prefetchReviewQueueApi(),
  prefetchSegmentReviewQueueApi: () => prefetchSegmentReviewQueueApi(),
}))

vi.mock('@/app/router/appRoutes', () => ({
  preloadPracticeRoutes: () => preloadPracticeRoutes(),
  preloadReviewRoutes: () => preloadReviewRoutes(),
  preloadEnglishWorkspacePage: () => preloadEnglishWorkspacePage(),
  preloadEnglishReadingPage: () => preloadEnglishReadingPage(),
  preloadFreestylePage: () => preloadFreestylePage(),
  preloadKnowledgePage: () => preloadKnowledgePage(),
  preloadPalaceEditPage: () => preloadPalaceEditPage(),
  preloadProfilePage: () => preloadProfilePage(),
}))

describe('AppShell', () => {
  beforeEach(async () => {
    __resetBackgroundTaskStoreForTest()
    getRuntimeInfoApi.mockReset()
    prefetchPalaceSubjectShelfApi.mockClear()
    prefetchPalacesGroupedSummaryApi.mockClear()
    prefetchDashboardApi.mockClear()
    prefetchReviewQueueApi.mockClear()
    prefetchSegmentReviewQueueApi.mockClear()
    preloadPracticeRoutes.mockClear()
    preloadReviewRoutes.mockClear()
    preloadEnglishWorkspacePage.mockClear()
    preloadEnglishReadingPage.mockClear()
    preloadFreestylePage.mockClear()
    preloadKnowledgePage.mockClear()
    preloadPalaceEditPage.mockClear()
    preloadProfilePage.mockClear()
    resetNavSectionHistoryForTest()
  })

  afterEach(async () => {
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

  it('places freestyle second in the main navigation and keeps it active on its route', async () => {
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
      <MemoryRouter initialEntries={['/freestyle']}>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    await screen.findAllByText(/Stable abcdef12/)
    const navLabels = screen
      .getAllByRole('link')
      .map((link) => link.textContent?.trim() || '')
      .filter((label) => ['仪表盘', '随心模式', '记忆宫殿'].includes(label))

    expect(navLabels.slice(0, 3)).toEqual(['仪表盘', '随心模式', '记忆宫殿'])
    const freestyleLink = screen.getAllByRole('link', { name: '随心模式' })[0]
    expect(freestyleLink.className).toContain('bg-primary')

    preloadFreestylePage.mockClear()
    fireEvent.mouseEnter(freestyleLink)
    expect(preloadFreestylePage).toHaveBeenCalled()
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
    expect(preloadPracticeRoutes).toHaveBeenCalled()
  })

  it('warms core study routes, queues, and dashboard on startup', async () => {
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
      expect(prefetchReviewQueueApi).toHaveBeenCalledTimes(1)
      expect(prefetchSegmentReviewQueueApi).toHaveBeenCalledTimes(1)
      expect(preloadPracticeRoutes).toHaveBeenCalledTimes(1)
      expect(preloadReviewRoutes).toHaveBeenCalledTimes(1)
      expect(preloadFreestylePage).toHaveBeenCalledTimes(1)
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
