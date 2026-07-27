import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TodayPlanCard, formatDeferReason } from './TodayPlanCard'

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TodayPlanCard />
    </QueryClientProvider>,
  )
}

const getTodayPlanMock = vi.fn()

vi.mock('@/modules/practice/ui/review/api/scheduleInsightApi', () => ({
  getReviewTodayPlanApi: (...args: unknown[]) => getTodayPlanMock(...args),
}))

function planItem(overrides: Record<string, unknown> = {}) {
  return {
    item: {
      local_date: '2026-07-26',
      new_quota: 20,
      review_pending: 4,
      review_done: 6,
      new_pending: 1,
      new_done: 2,
      deferred: [],
      backlog_new: 15,
      completed: false,
      palaces: [
        {
          palace_id: 1,
          title: '解剖学',
          review_pending: 4,
          review_done: 6,
          consolidate_pending: 2,
          consolidate_done: 1,
          new_pending: 1,
          new_done: 2,
        },
      ],
      deferred_details: [],
      ...overrides,
    },
  }
}

describe('TodayPlanCard', () => {
  beforeEach(() => {
    getTodayPlanMock.mockReset()
  })

  it('renders review batches, new-card quota, consolidation, and backlog', async () => {
    getTodayPlanMock.mockResolvedValue(planItem())
    renderCard()

    expect(await screen.findByText('今日任务：正式复习 10 张 + 新学 3 张')).toBeTruthy()
    expect(screen.getByText(/还有 15 张新卡待逐日放出/)).toBeTruthy()

    expect(screen.getByText(/按到期批次全部完成/)).toBeTruthy()
    expect(screen.getByText(/巩固 1\/3/)).toBeTruthy()
  })

  it('shows the completed badge when today is done', async () => {
    getTodayPlanMock.mockResolvedValue(
      planItem({
        completed: true,
        review_pending: 0,
        new_pending: 0,
        deferred: [],
        deferred_details: [],
        backlog_new: 0,
      }),
    )
    renderCard()

    expect(await screen.findByText('今日打卡完成')).toBeTruthy()
    expect(screen.queryByText(/顺延至明天/)).toBeNull()
  })

  it('keeps new-card defer reasons readable', () => {
    expect(formatDeferReason('over_new_quota')).toBe('今日新学额度已满')
    expect(formatDeferReason(null)).toBe('已顺延')
  })
})
