import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell, resetNavSectionHistoryForTest } from '@/app/shell/AppShell'
import { enqueueMutation, resetMutationQueueForTest } from '@/shared/persistence/mutationQueue'

const getRuntimeInfoApi = vi.fn()

vi.mock('@/shared/api/modules/runtime', () => ({
  getRuntimeInfoApi: () => getRuntimeInfoApi(),
}))

describe('AppShell', () => {
  beforeEach(async () => {
    await resetMutationQueueForTest()
    getRuntimeInfoApi.mockReset()
    resetNavSectionHistoryForTest()
  })

  afterEach(async () => {
    await resetMutationQueueForTest()
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

  it('activates only the quiz nav item on the palace quiz hub route', async () => {
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
      <MemoryRouter initialEntries={['/palaces/quiz']}>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    await screen.findAllByText(/Stable abcdef12/)

    const palaceLink = screen.getAllByRole('link', { name: '记忆宫殿' })[0]
    const quizLink = screen.getAllByRole('link', { name: '做题区' })[0]

    expect(quizLink.className).toContain('bg-primary')
    expect(palaceLink.className).not.toContain('bg-primary')
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
})
