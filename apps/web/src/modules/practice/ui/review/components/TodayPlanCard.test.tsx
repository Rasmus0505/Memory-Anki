import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
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
      review_quota: 200,
      new_quota: 20,
      review_pending: 4,
      review_done: 6,
      review_deferred: 2,
      new_pending: 1,
      new_done: 2,
      deferred: [
        { item_key: 'review:n1', palace_id: 1, defer_reason: 'over_review_quota' },
      ],
      backlog_new: 15,
      completed: false,
      palaces: [
        {
          palace_id: 1,
          title: '解剖学',
          review_pending: 4,
          review_done: 6,
          review_deferred: 2,
          new_pending: 1,
          new_done: 2,
        },
      ],
      deferred_details: [
        {
          palace_id: 1,
          palace_title: '解剖学',
          node_uid: 'n1',
          defer_reason: 'over_review_quota',
        },
        {
          palace_id: 1,
          palace_title: '解剖学',
          node_uid: 'n2',
          defer_reason: 'over_review_quota',
        },
      ],
      ...overrides,
    },
  }
}

describe('TodayPlanCard', () => {
  beforeEach(() => {
    getTodayPlanMock.mockReset()
  })

  it('renders the daily quota summary, backlog hint and deferred details', async () => {
    getTodayPlanMock.mockResolvedValue(planItem())
    renderCard()

    expect(await screen.findByText('今日任务：复习 10 张 + 新学 3 张')).toBeTruthy()
    expect(screen.getByText(/还有 15 张新卡待逐日放出/)).toBeTruthy()

    fireEvent.click(screen.getByText(/因今日复习额度已满，2 张顺延至明天/))
    expect(screen.getAllByText('解剖学').length).toBeGreaterThan(0)
    expect(screen.getAllByText('今日复习额度已满').length).toBe(2)
  })

  it('shows the completed badge when today is done', async () => {
    getTodayPlanMock.mockResolvedValue(
      planItem({
        completed: true,
        review_pending: 0,
        new_pending: 0,
        review_deferred: 0,
        deferred: [],
        deferred_details: [],
        backlog_new: 0,
      }),
    )
    renderCard()

    expect(await screen.findByText('今日打卡完成')).toBeTruthy()
    expect(screen.queryByText(/顺延至明天/)).toBeNull()
  })

  it('maps defer reasons to Chinese labels', () => {
    expect(formatDeferReason('over_review_quota')).toBe('今日复习额度已满')
    expect(formatDeferReason(null)).toBe('已顺延')
  })
})
