import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/router/appRoutes'

vi.mock('@/pages/insights/InsightsPage', () => ({
  default: function PendingDashboardPage() {
    throw new Promise<void>(() => undefined)
  },
}))

describe('AppRoutes dashboard fallback', () => {
  it('shows the insights skeleton instead of a blank main pane while the page chunk loads', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '仪表盘' })).toBeTruthy()
    expect(screen.getByText('正在加载学习概览...')).toBeTruthy()
    expect(screen.queryByText('正在加载页面…')).toBeNull()
  })
})
