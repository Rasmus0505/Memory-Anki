import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalCommandPalette } from '@/app/shell/GlobalCommandPalette'
import { globalSearchApi } from '@/entities/search/api'

vi.mock('@/entities/palace/api', () => ({
  prefetchPalaceSubjectShelfApi: vi.fn(),
  prefetchPalacesGroupedSummaryApi: vi.fn(),
}))

vi.mock('@/features/dashboard/api', () => ({
  prefetchDashboardApi: vi.fn(),
}))

vi.mock('@/features/review/api', () => ({
  prefetchReviewQueueApi: vi.fn(),
}))

vi.mock('@/entities/search/api', () => ({
  globalSearchApi: vi.fn(),
}))

vi.mock('@/app/router/appRoutes', () => ({
  preloadPracticeRoutes: vi.fn(),
  preloadReviewRoutes: vi.fn(),
  preloadEnglishWorkspacePage: vi.fn(),
  preloadEnglishReadingPage: vi.fn(),
  preloadFreestylePage: vi.fn(),
  preloadFreestyleSessionPage: vi.fn(),
  preloadKnowledgePage: vi.fn(),
  preloadProfilePage: vi.fn(),
}))

function LocationEcho() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function NavigationButton({ to }: { to: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(to)}>
      go {to}
    </button>
  )
}

function renderPalette(initialPath = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <GlobalCommandPalette />
      <LocationEcho />
      <NavigationButton to="/review" />
      <input aria-label="editable" />
    </MemoryRouter>,
  )
}

function openPalette() {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
}

function waitForDebounce() {
  return new Promise((resolve) => window.setTimeout(resolve, 250))
}

describe('GlobalCommandPalette', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    Element.prototype.scrollIntoView = vi.fn()
    window.sessionStorage.clear()
    vi.mocked(globalSearchApi).mockReset()
  })

  it('opens with actions, all page navigation items, and only real shortcuts', async () => {
    renderPalette()

    openPalette()

    expect(await screen.findByText('操作')).toBeTruthy()
    expect(screen.getByText('页面')).toBeTruthy()
    expect(screen.getByText('开始今日复习')).toBeTruthy()
    expect(screen.getByText('新建宫殿')).toBeTruthy()
    expect(screen.getByText('搜索宫殿')).toBeTruthy()

    for (const label of ['今日学习', '知识库', '内容创作', '复习分析', '系统设置']) {
      expect(screen.getByText(label)).toBeTruthy()
    }

    expect(screen.getByText('Ctrl+N')).toBeTruthy()
    expect(screen.getByText('/')).toBeTruthy()
    expect(screen.queryByText('Review')).toBeNull()
    expect(screen.queryByText('Palaces')).toBeNull()
    expect(screen.queryByText('Dashboard')).toBeNull()
  })

  it('shows recent visits and filters out the current route', async () => {
    renderPalette('/palaces')

    fireEvent.click(screen.getByRole('button', { name: 'go /review' }))
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/review')
    })

    openPalette()

    expect(await screen.findByText('最近访问')).toBeTruthy()
    expect(screen.getByText('知识库 · /palaces')).toBeTruthy()
    expect(screen.queryByText('复习分析 · /review')).toBeNull()
  })

  it('does not trigger global shortcuts from editable fields', async () => {
    renderPalette('/dashboard')
    const editable = screen.getByLabelText('editable')
    editable.focus()

    fireEvent.keyDown(editable, { key: 'n', ctrlKey: true })
    fireEvent.keyDown(editable, { key: '/' })

    expect(screen.getByTestId('location').textContent).toBe('/dashboard')
  })

  it('opens the shortcut cheat sheet from the question mark key', async () => {
    renderPalette('/dashboard')

    fireEvent.keyDown(window, { key: '?' })

    expect(await screen.findByText('快捷键')).toBeTruthy()
    expect(screen.getByText('标记/取消专项知识点')).toBeTruthy()
    expect(screen.getAllByText('隐藏/取消子级知识点显示').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Shift+F')).toBeTruthy()
    expect(screen.getAllByText('Shift+H').length).toBeGreaterThanOrEqual(1)
  })

  it('queries remote search after two characters and navigates search hits', async () => {
    vi.mocked(globalSearchApi).mockResolvedValue({
      query: '线粒体',
      palaces: [{ id: 12, title: '线粒体宫殿', snippet: '含线粒体呼吸链' }],
      pegs: [
        {
          id: 301,
          palace_id: 12,
          palace_title: '线粒体宫殿',
          name: '厨房灶台',
          snippet: '灶台上的火等于线粒体产能',
        },
      ],
      questions: [{ id: 88, palace_id: 12, palace_title: '线粒体宫殿', snippet: '线粒体内膜上进行的是？' }],
      chapters: [{ id: 5, name: '线粒体与能量代谢', subject_name: '生物' }],
    })
    renderPalette('/dashboard')

    openPalette()
    const input = await screen.findByPlaceholderText('搜索操作、宫殿、记忆桩、题目、章节...（Ctrl+K）')
    fireEvent.change(input, { target: { value: '线' } })
    await waitForDebounce()
    expect(globalSearchApi).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '线粒体' } })

    await waitFor(() => {
      expect(globalSearchApi).toHaveBeenCalledWith('线粒体')
      expect(screen.getByText('宫殿')).toBeTruthy()
      expect(screen.getByText('记忆桩')).toBeTruthy()
      expect(screen.getByText('题目')).toBeTruthy()
      expect(screen.getByText('章节')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('厨房灶台'))

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/palaces/12/edit')
    })
  })
})
