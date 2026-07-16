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

describe('ReviewOverview FSRS queue', () => {
  beforeEach(() => queue.mockResolvedValue({ due_count: 3, later_today_count: 0, overdue_count: 1, smoothed_count: 0, stats: { total: 0, review_count: 0, review_duration_seconds: 0 }, chapter: null, later_today_reviews: [], reviews: [{ id: 7, palace_id: 7, algorithm_used: 'FSRS', completed: false, review_type: 'fsrs', due_at: '2026-07-15T10:00:00Z', next_due_at: '2026-07-15T10:00:00Z', due_node_count: 3, overdue_node_count: 1, schedule_count: 3, overdue_schedule_count: 1, next_due_date: '2026-07-15', palace: { id: 7, title: '测试宫殿', description: '', archived: false, mastered: false, editor_doc: null, pegs: [], attachments: [], chapters: [] } }] }))
  it('shows node counts instead of stages and intervals', async () => {
    render(<MemoryRouter><ReviewOverview /></MemoryRouter>)
    expect(await screen.findByText('测试宫殿')).toBeTruthy()
    expect(screen.getByText(/到期 3 · 逾期 1/)).toBeTruthy()
    expect(screen.queryByText(/第 1 次/)).toBeNull()
    expect(screen.queryByText(/间隔/)).toBeNull()
  })
})
