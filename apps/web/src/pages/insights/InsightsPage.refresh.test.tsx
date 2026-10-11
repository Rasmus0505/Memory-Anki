import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getDashboardApi,
  invalidateDashboardApi,
  renderDashboardPage,
  setupDashboardPageTest,
} from '@/pages/insights/InsightsPage.test-support'

describe('DashboardPage refresh behavior', () => {
  beforeEach(() => {
    setupDashboardPageTest()
    getDashboardApi.mockResolvedValue({
      due_count: 0,
      reviews: [],
      recent_palaces: [],
      today_new_palace_count: 0,
      today_new_palaces: [],
    })
  })

  it('loads the dashboard overview once', async () => {
    renderDashboardPage()

    await waitFor(() => expect(getDashboardApi).toHaveBeenCalledTimes(1))
    expect(getDashboardApi).toHaveBeenCalledWith()
    expect(await screen.findByText('仪表盘')).toBeTruthy()
  })

  it('does not refresh on window focus', async () => {
    renderDashboardPage()

    await waitFor(() => expect(getDashboardApi).toHaveBeenCalledTimes(1))
    expect(invalidateDashboardApi).not.toHaveBeenCalled()

    act(() => window.dispatchEvent(new Event('focus')))

    expect(getDashboardApi).toHaveBeenCalledTimes(1)
  })

  it('does not refresh when returning from the background', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    visibility.mockReturnValue('hidden')
    renderDashboardPage()

    await waitFor(() => expect(getDashboardApi).toHaveBeenCalledTimes(1))
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(getDashboardApi).toHaveBeenCalledTimes(1)

    visibility.mockReturnValue('visible')
    act(() => document.dispatchEvent(new Event('visibilitychange')))

    expect(getDashboardApi).toHaveBeenCalledTimes(1)
    visibility.mockRestore()
  })
})
