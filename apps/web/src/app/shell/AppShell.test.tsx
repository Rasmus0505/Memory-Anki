import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
const preloadPracticeRoutes = vi.fn()
const preloadReviewRoutes = vi.fn()
const preloadEnglishWorkspacePage = vi.fn()
const preloadEnglishReadingPage = vi.fn()
const preloadFreestylePage = vi.fn()
const preloadFreestyleSessionPage = vi.fn()
const preloadKnowledgePage = vi.fn()
const preloadPalaceEditPage = vi.fn()
const preloadProfilePage = vi.fn()
const backgroundTaskRegistryMock = vi.hoisted(() => ({
  useRunningTaskCountBySection: vi.fn<(section: unknown) => number>(() => 0),
}))

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
}))

vi.mock('@/app/router/appRoutes', () => ({
  preloadPracticeRoutes: () => preloadPracticeRoutes(),
  preloadReviewRoutes: () => preloadReviewRoutes(),
  preloadEnglishWorkspacePage: () => preloadEnglishWorkspacePage(),
  preloadEnglishReadingPage: () => preloadEnglishReadingPage(),
  preloadFreestylePage: () => preloadFreestylePage(),
  preloadFreestyleSessionPage: () => preloadFreestyleSessionPage(),
  preloadKnowledgePage: () => preloadKnowledgePage(),
  preloadPalaceEditPage: () => preloadPalaceEditPage(),
  preloadProfilePage: () => preloadProfilePage(),
}))

vi.mock('@/shared/background-tasks/backgroundTaskRegistry', async () => {
  const actual = await vi.importActual<typeof import('@/shared/background-tasks/backgroundTaskRegistry')>(
    '@/shared/background-tasks/backgroundTaskRegistry',
  )
  return {
    ...actual,
    useRunningTaskCountBySection: (section: unknown) =>
      backgroundTaskRegistryMock.useRunningTaskCountBySection(section),
  }
})

describe('AppShell', () => {
  beforeEach(async () => {
    __resetBackgroundTaskStoreForTest()
    getRuntimeInfoApi.mockReset()
    prefetchPalaceSubjectShelfApi.mockClear()
    prefetchPalacesGroupedSummaryApi.mockClear()
    prefetchDashboardApi.mockClear()
    prefetchReviewQueueApi.mockClear()
    preloadPracticeRoutes.mockClear()
    preloadReviewRoutes.mockClear()
    preloadEnglishWorkspacePage.mockClear()
    preloadEnglishReadingPage.mockClear()
    preloadFreestylePage.mockClear()
    preloadKnowledgePage.mockClear()
    preloadPalaceEditPage.mockClear()
    preloadProfilePage.mockClear()
    backgroundTaskRegistryMock.useRunningTaskCountBySection.mockClear()
    backgroundTaskRegistryMock.useRunningTaskCountBySection.mockReturnValue(0)
    resetNavSectionHistoryForTest()
  })

  afterEach(async () => {
    __resetBackgroundTaskStoreForTest()
    resetNavSectionHistoryForTest()
    vi.useRealTimers()
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

  it('keeps sidebar clock ticks from rerendering navigation subscriptions', () => {
    vi.useFakeTimers()
    getRuntimeInfoApi.mockReturnValue(new Promise(() => {}))

    render(
      <MemoryRouter>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    expect(backgroundTaskRegistryMock.useRunningTaskCountBySection).toHaveBeenCalled()
    backgroundTaskRegistryMock.useRunningTaskCountBySection.mockClear()

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(backgroundTaskRegistryMock.useRunningTaskCountBySection).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('opens the global app log drawer from shell actions', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'dev',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
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

  it('highlights unified english section for listening and reading routes', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'stable',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
      min_supported_generation: 1,
      max_supported_generation: 1,
      last_started_at: '2026-06-01T12:00:00+08:00',
    })

    const { unmount } = render(
      <MemoryRouter initialEntries={['/english-reading']}>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    await screen.findAllByText(/Stable abcdef12/)

    const englishLink = screen.getAllByRole('link', { name: '英语' })[0]
    const libraryLink = screen.getAllByRole('link', { name: '知识' })[0]
    expect(englishLink.className).toContain('bg-primary')
    expect(libraryLink.className).not.toContain('bg-primary')
    unmount()

    render(
      <MemoryRouter initialEntries={['/english/courses/7']}>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    await screen.findAllByText(/Stable abcdef12/)
    const courseEnglishLink = screen.getAllByRole('link', { name: '英语' })[0]
    expect(courseEnglishLink.className).toContain('bg-primary')
    expect(screen.getAllByRole('link', { name: '知识' })[0].className).not.toContain('bg-primary')
  })

  it('renders a mobile bottom navigation that reuses the main route targets', async () => {
    getRuntimeInfoApi.mockResolvedValue(null)

    render(
      <MemoryRouter initialEntries={['/freestyle']}>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    const mobileNav = screen.getByRole('navigation', { name: '移动端主导航' })
    expect(mobileNav.className).toContain('lg:hidden')
    expect(mobileNav.querySelectorAll('a')).toHaveLength(5)
    expect(mobileNav.querySelector('a[href="/freestyle"]')?.className).toContain('bg-primary')
    expect(mobileNav.querySelector('a[href="/palaces"]')).toBeTruthy()
    expect(mobileNav.querySelector('a[href="/english"]')).toBeTruthy()
    expect(mobileNav.querySelector('a[href="/english-reading"]')).toBeFalsy()
    expect(mobileNav.querySelector('a[href="/dashboard"]')).toBeTruthy()
  })

  it('rejects stale cross-section history targets in mobile navigation', () => {
    getRuntimeInfoApi.mockResolvedValue(null)
    window.localStorage.setItem('memory-anki.page-history.device.v1', JSON.stringify({
      version: 1,
      snapshots: [],
      sectionLastUrls: {
        palaces: '/palaces/new',
        knowledge: '/knowledge',
      },
      lastWorkspacePath: '/palaces/new',
    }))

    render(
      <MemoryRouter initialEntries={['/freestyle']}>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    const mobileNav = screen.getByRole('navigation', { name: '移动端主导航' })
    expect(mobileNav.querySelector('a[href="/palaces"]')?.textContent).toContain('知识')
    expect(mobileNav.querySelector('a[href="/palaces/new"]')?.textContent).toContain('创建')
  })

  it('renders the main learning-loop sections and keeps today active', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'stable',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
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
    const expectedLabels = ['今日', '知识', '英语', '创建', '洞察']
    const navLabels = screen
      .getAllByRole('link')
      .map((link) => link.textContent?.trim() || '')
      .filter((label) => expectedLabels.includes(label))

    expect(navLabels.slice(0, 5)).toEqual(expectedLabels)
    const freestyleLink = screen.getAllByRole('link', { name: '今日' })[0]
    expect(freestyleLink.className).toContain('bg-primary')

    preloadFreestylePage.mockClear()
    fireEvent.mouseEnter(freestyleLink)
    expect(preloadFreestylePage).toHaveBeenCalled()
  })

  it('keeps content creation active on a palace quiz route', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'stable',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
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

    const creationLink = screen.getAllByRole('link', { name: '创建' })[0]
    expect(creationLink.className).toContain('bg-primary')
  })

  it('warms knowledge library targets on hover', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'stable',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
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

    fireEvent.mouseEnter(screen.getAllByRole('link', { name: '知识' })[0]!)

    expect(prefetchPalaceSubjectShelfApi.mock.calls.length).toBe(beforeHoverCalls + 1)
    expect(prefetchPalacesGroupedSummaryApi.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(preloadKnowledgePage).toHaveBeenCalled()
  })

  it('warms core study routes, queues, and dashboard on startup', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'stable',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
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
      expect(preloadPracticeRoutes).toHaveBeenCalledTimes(1)
      expect(preloadReviewRoutes).toHaveBeenCalledTimes(1)
      expect(preloadFreestylePage).toHaveBeenCalledTimes(1)
    })
  })

  it('always routes content creation to a fresh /palaces/new draft', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'stable',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
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

    fireEvent.click(screen.getAllByRole('link', { name: '今日' })[0]!)
    await waitFor(() => {
      expect(screen.getByText('/freestyle')).toBeTruthy()
    })

    const mobileNav = screen.getByRole('navigation', { name: '移动端主导航' })
    const desktopLinks = screen.getAllByRole('link').filter((link) => !mobileNav.contains(link))
    expect(desktopLinks.some((link) => link.getAttribute('href') === '/palaces/new')).toBe(true)
    expect(mobileNav.querySelector('a[href="/palaces/new"]')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('link', { name: '创建' })[0]!)
    await waitFor(() => {
      expect(screen.getByText('/palaces/new')).toBeTruthy()
    })
  })

  it('returns review navigation to the stable dashboard after visiting a review session', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'stable',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
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
    fireEvent.click(screen.getAllByRole('link', { name: '今日' })[0]!)
    await waitFor(() => {
      expect(screen.getByText('/freestyle')).toBeTruthy()
    })

    const reviewLinks = screen.getAllByRole('link', { name: '洞察' })
    const reviewHrefs = reviewLinks.map((link) => link.getAttribute('href'))
    expect(reviewHrefs).toContain('/dashboard')
    const reviewOverviewLink = reviewLinks.find((link) => link.getAttribute('href') === '/dashboard')
    fireEvent.click(reviewOverviewLink!)
    await waitFor(() => {
      expect(screen.getByText('/dashboard')).toBeTruthy()
    })
  })

  it('renders quiz-generation bubbles and navigates to practice mode', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'stable',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
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
