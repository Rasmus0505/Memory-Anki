import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getDashboardApi,
  invalidateDashboardApi,
  renderDashboardPage,
  setupDashboardPageTest,
} from '@/pages/insights/InsightsPage.test-support'

describe('DashboardPage unified time-record filters', () => {
  beforeEach(() => {
    setupDashboardPageTest()
    getDashboardApi.mockResolvedValue({
      due_count: 0,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 1200,
      monthly_total_review_duration_seconds: 140400,
      weekly_total_review_duration_seconds: 3600,
      weekly_formal_review_duration_seconds: 1800,
      recent_palaces: [],
      today_learning_palaces: [],
      today_new_palace_count: 0,
      today_new_palaces: [],
    })
  })

  it('renders the top total from the unified Session summary, not the dashboard compatibility field', async () => {
    renderDashboardPage()

    expect(await screen.findByText('74小时 15分')).toBeTruthy()
    expect(screen.queryByText('39小时 0分')).toBeNull()
  })

  it('uses the same persisted range label for the top card, charts, and list', async () => {
    renderDashboardPage()

    expect(await screen.findByText('时长趋势 · 2026-07')).toBeTruthy()
    expect(screen.getByText('标签时长分布 · 2026-07')).toBeTruthy()
    expect(screen.getByTestId('records-table').textContent).toBe('month:2026-07')
    expect(screen.getByText('2026-07')).toBeTruthy()
  })

  it('loads the dashboard overview once without issuing selected-duration wrapper requests', async () => {
    renderDashboardPage()

    await waitFor(() => expect(getDashboardApi).toHaveBeenCalledTimes(1))
    expect(getDashboardApi).toHaveBeenCalledWith()
  })

  it('invalidates the dashboard cache before loading and refreshes after window focus', async () => {
    renderDashboardPage()

    await waitFor(() => expect(invalidateDashboardApi).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(getDashboardApi).toHaveBeenCalledTimes(1))

    act(() => window.dispatchEvent(new Event('focus')))

    await waitFor(() => expect(invalidateDashboardApi).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(getDashboardApi).toHaveBeenCalledTimes(2))
  })

  it('refreshes after returning from the background', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    visibility.mockReturnValue('hidden')
    renderDashboardPage()

    await waitFor(() => expect(getDashboardApi).toHaveBeenCalledTimes(1))
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(getDashboardApi).toHaveBeenCalledTimes(1)

    visibility.mockReturnValue('visible')
    act(() => document.dispatchEvent(new Event('visibilitychange')))

    await waitFor(() => expect(getDashboardApi).toHaveBeenCalledTimes(2))
    visibility.mockRestore()
  })

  it('does not let a stale dashboard response overwrite a newer refresh', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve
    })
    getDashboardApi
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce({ today_total_review_duration_seconds: 120 })

    renderDashboardPage()
    await waitFor(() => expect(getDashboardApi).toHaveBeenCalledTimes(1))

    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(getDashboardApi).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('2分 0秒')).toBeTruthy()

    await act(async () => {
      resolveFirst?.({ today_total_review_duration_seconds: 3600 })
      await firstResponse
    })
    expect(screen.getByText('2分 0秒')).toBeTruthy()
    expect(screen.queryByText('1小时 0分')).toBeNull()
  })
})
