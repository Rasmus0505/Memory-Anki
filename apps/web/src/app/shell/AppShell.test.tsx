import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '@/app/shell/AppShell'

const getRuntimeInfoApi = vi.fn()

vi.mock('@/shared/api/modules/runtime', () => ({
  getRuntimeInfoApi: () => getRuntimeInfoApi(),
}))

describe('AppShell', () => {
  beforeEach(() => {
    getRuntimeInfoApi.mockReset()
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
})
