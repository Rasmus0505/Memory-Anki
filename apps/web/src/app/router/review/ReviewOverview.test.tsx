import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewOverview from '@/app/router/review/ReviewOverview'

const queue = vi.fn()
vi.mock('@/features/review/api', () => ({
  getReviewQueueApi: () => queue(), getChapterReviewQueueApi: () => queue(),
  getReviewSessionApi: vi.fn(), getReviewSessionProgressApi: vi.fn(),
}))
vi.mock('@/shared/api/studySessionWarmup', () => ({ prefetchStudySession: vi.fn() }))
vi.mock('@/features/review/components/ReviewLoadForecastCard', () => ({ ReviewLoadForecastCard: () => <div>负荷预测</div> }))

function palaceRow(
  id: number,
  title: string,
  nextDue: string,
  dueNodes: number,
  overdueNodes: number,
  todayReviewCount = 0,
) {
  return {
    id,
    palace_id: id,
    algorithm_used: 'FSRS',
    completed: false,
    review_type: 'fsrs',
    due_at: nextDue,
    next_due_at: nextDue,
    due_node_count: dueNodes,
    overdue_node_count: overdueNodes,
    schedule_count: dueNodes,
    overdue_schedule_count: overdueNodes,
    next_due_date: nextDue.slice(0, 10),
    today_review_count: todayReviewCount,
    palace: {
      id,
      title,
      description: '',
      archived: false,
      mastered: false,
      editor_doc: null,
      pegs: [],
      attachments: [],
      chapters: [],
    },
  }
}

describe('ReviewOverview FSRS queue', () => {
  beforeEach(() => {
    queue.mockResolvedValue({
      due_count: 6,
      later_today_count: 0,
      overdue_count: 4,
      smoothed_count: 0,
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      chapter: null,
      later_today_reviews: [],
      // Deliberately reverse of due order — UI must re-sort earliest first.
      reviews: [
        palaceRow(9, '较新逾期', '2026-07-18T10:00:00Z', 1, 1),
        palaceRow(7, '拖最久', '2026-07-01T10:00:00Z', 3, 3),
        palaceRow(8, '中间', '2026-07-10T10:00:00Z', 2, 0),
      ],
    })
  })

  it('shows node counts and today review ordinal instead of stages and intervals', async () => {
    queue.mockResolvedValueOnce({
      due_count: 3,
      later_today_count: 0,
      overdue_count: 3,
      smoothed_count: 0,
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      chapter: null,
      later_today_reviews: [],
      reviews: [palaceRow(7, '拖最久', '2026-07-01T10:00:00Z', 3, 3, 2)],
    })
    render(<MemoryRouter><ReviewOverview /></MemoryRouter>)
    expect(await screen.findByText('拖最久')).toBeTruthy()
    expect(screen.getByText(/到期 3 · 逾期 3/)).toBeTruthy()
    expect(screen.getByText('今日第 3 次')).toBeTruthy()
    expect(screen.queryByText(/间隔/)).toBeNull()
  })

  it('lists earliest-due palace first by default', async () => {
    render(<MemoryRouter><ReviewOverview /></MemoryRouter>)
    await screen.findByText('拖最久')
    const titles = screen.getAllByText(/拖最久|中间|较新逾期/).map((node) => node.textContent)
    expect(titles[0]).toBe('拖最久')
    expect(titles.indexOf('拖最久')).toBeLessThan(titles.indexOf('中间'))
    expect(titles.indexOf('中间')).toBeLessThan(titles.indexOf('较新逾期'))
    expect(screen.getByTestId('review-queue-sort')).toBeTruthy()
  })
})
