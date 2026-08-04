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
const preloadPracticeRoutes = vi.fn()
const preloadEnglishWorkspacePage = vi.fn()
const preloadEnglishReadingPage = vi.fn()
const preloadFreestylePage = vi.fn()
const preloadTodayLearningPage = vi.fn()
const preloadKnowledgePage = vi.fn()
const preloadPalaceEditPage = vi.fn()
const preloadProfilePage = vi.fn()
const preloadDashboardPage = vi.fn()
const preloadPalaceListPage = vi.fn()
const preloadPalaceShelfPage = vi.fn()
const backgroundTaskRegistryMock = vi.hoisted(() => ({
  useRunningTaskCountBySection: vi.fn<(section: unknown) => number>(() => 0),
}))

vi.mock('@/modules/settings/domain/runtime-entity/api', () => ({
  getRuntimeInfoApi: () => getRuntimeInfoApi(),
}))

vi.mock('@/modules/content/domain/palace-entity/api', () => ({
  prefetchPalaceSubjectShelfApi: () => prefetchPalaceSubjectShelfApi(),
  prefetchPalacesGroupedSummaryApi: () => prefetchPalacesGroupedSummaryApi(),
}))

vi.mock('@/modules/dashboard/ui/dashboard/api', () => ({
  prefetchDashboardApi: () => prefetchDashboardApi(),
}))

vi.mock('@/app/router/appRoutes', () => ({
  preloadPracticeRoutes: () => preloadPracticeRoutes(),
  preloadEnglishWorkspacePage: () => preloadEnglishWorkspacePage(),
  preloadEnglishReadingPage: () => preloadEnglishReadingPage(),
  preloadFreestylePage: () => preloadFreestylePage(),
  preloadTodayLearningPage: () => preloadTodayLearningPage(),
  preloadKnowledgePage: () => preloadKnowledgePage(),
  preloadPalaceEditPage: () => preloadPalaceEditPage(),
  preloadProfilePage: () => preloadProfilePage(),
  preloadDashboardPage: () => preloadDashboardPage(),
  preloadPalaceListPage: () => preloadPalaceListPage(),
  preloadPalaceShelfPage: () => preloadPalaceShelfPage(),
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
    preloadPracticeRoutes.mockClear()
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
      <MemoryRouter initialEntries={['/english/reading']}>
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
      <MemoryRouter initialEntries={['/english/listening/courses/7']}>
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

  it('hides mobile bottom navigation on immersive freestyle', async () => {
    getRuntimeInfoApi.mockResolvedValue(null)

    render(
      <MemoryRouter initialEntries={['/freestyle']}>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    expect(screen.queryByRole('navigation', { name: '移动端主导航' })).toBeNull()
  })

  it('renders a mobile bottom navigation that reuses the main route targets', async () => {
    getRuntimeInfoApi.mockResolvedValue(null)

    render(
      <MemoryRouter initialEntries={['/palaces']}>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    const mobileNav = screen.getByRole('navigation', { name: '移动端主导航' })
    expect(mobileNav.className).toContain('lg:hidden')
    expect(mobileNav.querySelectorAll('a')).toHaveLength(5)
    expect(mobileNav.querySelector('a[href="/palaces"]')?.className).toContain('bg-primary')
    expect(mobileNav.querySelector('a[href="/freestyle"]')).toBeTruthy()
    expect(mobileNav.querySelector('a[href="/english"]')).toBeTruthy()
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
      <MemoryRouter initialEntries={['/palaces']}>
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
    const expectedLabels = ['随心', '知识', '英语', '创建', '洞察']
    const navLabels = screen
      .getAllByRole('link')
      .map((link) => link.textContent?.trim() || '')
      .filter((label) => expectedLabels.includes(label))

    expect(navLabels.slice(0, 5)).toEqual(expectedLabels)
    const freestyleLink = screen.getAllByRole('link', { name: '随心' })[0]
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
      expect(preloadPracticeRoutes).toHaveBeenCalledTimes(1)
      expect(preloadFreestylePage).toHaveBeenCalledTimes(1)
    })
  })

  it('restores the last create-section page when switching back from another section', async () => {
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

    // While still in 创建, the nav link points at the section root for a second-click reset.
    const mobileNav = screen.getByRole('navigation', { name: '移动端主导航' })
    expect(mobileNav.querySelector('a[href="/palaces/new"]')?.textContent).toContain('创建')

    fireEvent.click(screen.getAllByRole('link', { name: '随心' })[0]!)
    await waitFor(() => {
      expect(screen.getByText('/freestyle')).toBeTruthy()
    })

    const createLinks = screen.getAllByRole('link', { name: '创建' })
    expect(
      createLinks.some(
        (link) =>
          link.getAttribute('href') ===
          '/palaces/30/edit?miniPalaceId=5&miniPalaceMode=edit#mindmap',
      ),
    ).toBe(true)

    fireEvent.click(
      createLinks.find(
        (link) =>
          link.getAttribute('href') ===
          '/palaces/30/edit?miniPalaceId=5&miniPalaceMode=edit#mindmap',
      )!,
    )
    await waitFor(() => {
      expect(
        screen.getByText('/palaces/30/edit?miniPalaceId=5&miniPalaceMode=edit#mindmap'),
      ).toBeTruthy()
    })
  })

  it('returns content creation to /palaces/new when the create nav is clicked while already active', async () => {
    getRuntimeInfoApi.mockResolvedValue({
      channel: 'stable',
      commit: 'abcdef1234567890',
      short_commit: 'abcdef12',
      min_supported_generation: 1,
      max_supported_generation: 1,
      last_started_at: '2026-06-01T12:00:00+08:00',
    })

    render(
      <MemoryRouter initialEntries={['/palaces/30/edit']}>
        <AppShell>
          <LocationEcho />
        </AppShell>
      </MemoryRouter>,
    )

    await screen.findAllByText(/Stable abcdef12/)
    fireEvent.click(screen.getAllByRole('link', { name: '创建' })[0]!)
    await waitFor(() => {
      expect(screen.getByText('/palaces/new')).toBeTruthy()
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
