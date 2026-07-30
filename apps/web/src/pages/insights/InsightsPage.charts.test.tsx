import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getDashboardApi,
  renderDashboardPage,
  setupDashboardPageTest,
} from '@/pages/insights/InsightsPage.test-support'

describe('DashboardPage unified charts', () => {
  beforeEach(() => {
    setupDashboardPageTest()
    getDashboardApi.mockResolvedValue({
      due_count: 0,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 0,
      monthly_total_review_duration_seconds: 0,
      weekly_total_review_duration_seconds: 0,
      weekly_formal_review_duration_seconds: 0,
      recent_palaces: [],
      today_learning_palaces: [],
      today_new_palace_count: 0,
      today_new_palaces: [],
    })
  })

  it('renders trend and breakdown from the same unified response and range', async () => {
    renderDashboardPage()

    expect((await screen.findByTestId('trend-chart')).textContent).toBe('7/1')
    expect(screen.getByTestId('breakdown-chart').textContent).toBe('复习')
    expect(screen.getByText('时长趋势 · 2026-07')).toBeTruthy()
    expect(screen.getByText('标签时长分布 · 2026-07')).toBeTruthy()
  })

  it('does not expose independent chart-range controls', async () => {
    renderDashboardPage()
    await screen.findByTestId('trend-chart')
    expect(screen.queryByRole('button', { name: '30 天' })).toBeNull()
    expect(screen.queryByRole('button', { name: '90 天' })).toBeNull()
  })
})
