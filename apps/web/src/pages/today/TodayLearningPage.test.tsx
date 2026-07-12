import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TodayLearningPage from '@/pages/today/TodayLearningPage'

const getDashboardApi = vi.fn()

vi.mock('@/features/dashboard/api', () => ({
  getDashboardApi: (...args: unknown[]) => getDashboardApi(...args),
}))

describe('TodayLearningPage', () => {
  beforeEach(() => {
    getDashboardApi.mockReset()
    getDashboardApi.mockResolvedValue({
      due_count: 3,
      due_later_today_count: 2,
      needs_practice_count: 4,
      reviews: [{
        id: 7,
        palace_id: 9,
        scheduled_date: '2026-07-11',
        interval_days: 1,
        algorithm_used: 'anki',
        completed: false,
        review_number: 1,
        review_type: '1d',
        schedule_count: 12,
        overdue_schedule_count: 1,
        next_due_date: '2026-07-11',
        palace: { id: 9, title: '机器学习', description: '', archived: false, mastered: false, editor_doc: null, pegs: [], attachments: [], chapters: [] },
      }],
      stats: { total: 10, review_count: 3, review_duration_seconds: 1200 },
      today_review_duration_seconds: 1200,
      weekly_review_duration_seconds: 3600,
      today_total_review_duration_seconds: 5400,
      monthly_total_review_duration_seconds: 12000,
      selected_total_review_duration_seconds: 12000,
      weekly_total_review_duration_seconds: 10000,
      weekly_formal_review_duration_seconds: 3600,
      english_stats: { total_courses: 0, unfinished_courses: 0, completed_courses: 0, today_reading_seconds: 0, weekly_reading_seconds: 0, total_reading_seconds: 0, today_practice_seconds: 0, weekly_practice_seconds: 0, total_practice_seconds: 0, today_total_seconds: 0, weekly_total_seconds: 0, total_seconds: 0 },
      today_learning_palaces: [{ palace_id: 9, palace_title: '机器学习', total_seconds: 5400, review_seconds: 1200, practice_seconds: 1800, quiz_seconds: 1200, palace_edit_seconds: 1200 }],
      today_new_palace_count: 0,
      today_new_palaces: [],
      recent_palaces: [{ id: 9, title: '机器学习', description: '', peg_count: 12, created_at: '2026-07-11T00:00:00' }],
    })
  })

  it('composes the learning overview and keeps immersive training separate', async () => {
    render(<MemoryRouter><TodayLearningPage /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: '今日学习' })).toBeTruthy()
    expect(screen.getAllByText('机器学习').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /进入沉浸训练/ }).getAttribute('href')).toBe('/freestyle/session')
    expect(screen.getByText('待复习队列')).toBeTruthy()
    expect(screen.getByText('知识图谱')).toBeTruthy()
    await waitFor(() => expect(getDashboardApi).toHaveBeenCalledTimes(1))
  })
})
