import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '@/app/shell/AppShell'
import { enqueueMutation, resetMutationQueueForTest } from '@/shared/persistence/mutationQueue'

const getRuntimeInfoApi = vi.fn()

vi.mock('@/shared/api/modules/runtime', () => ({
  getRuntimeInfoApi: () => getRuntimeInfoApi(),
}))

describe('AppShell', () => {
  beforeEach(async () => {
    await resetMutationQueueForTest()
    getRuntimeInfoApi.mockReset()
  })

  afterEach(async () => {
    await resetMutationQueueForTest()
    vi.restoreAllMocks()
  })

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
})
