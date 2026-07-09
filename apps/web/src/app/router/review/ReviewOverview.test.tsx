import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewOverview from '@/app/router/review/ReviewOverview'
import type { ReviewQueueResponse, ReviewStageProgressHealthResponse } from '@/shared/api/contracts'

const mocks = vi.hoisted(() => ({
  getReviewQueueApi: vi.fn(),
  getChapterReviewQueueApi: vi.fn(),
  getReviewStageProgressHealthApi: vi.fn(),
  repairReviewStageProgressApi: vi.fn(),
  previewSpreadOverdueApi: vi.fn(),
  spreadOverdueApi: vi.fn(),
  undoSpreadOverdueApi: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

vi.mock('@/features/review/api', () => ({
  getReviewQueueApi: (...args: unknown[]) => mocks.getReviewQueueApi(...args),
  getChapterReviewQueueApi: (...args: unknown[]) => mocks.getChapterReviewQueueApi(...args),
  getReviewStageProgressHealthApi: (...args: unknown[]) => mocks.getReviewStageProgressHealthApi(...args),
  repairReviewStageProgressApi: (...args: unknown[]) => mocks.repairReviewStageProgressApi(...args),
  previewSpreadOverdueApi: (...args: unknown[]) => mocks.previewSpreadOverdueApi(...args),
  spreadOverdueApi: (...args: unknown[]) => mocks.spreadOverdueApi(...args),
  undoSpreadOverdueApi: (...args: unknown[]) => mocks.undoSpreadOverdueApi(...args),
}))

vi.mock('@/features/review/components/ReviewLoadForecastCard', () => ({
  ReviewLoadForecastCard: () => <div data-testid="review-load-forecast" />,
}))

vi.mock('@/features/review/studyWarmup', () => ({
  prefetchStudySession: vi.fn(),
}))

const queue = {
  due_count: 0,
  overdue_count: 0,
  smoothed_count: 0,
  stats: {
    total: 0,
    review_count: 0,
    review_duration_seconds: 0,
  },
  chapter: null,
  reviews: [],
} satisfies ReviewQueueResponse

const unhealthy = {
  ok: true,
  orphan_progress_count: 1,
  orphan_study_session_count: 1,
  stage_gap_palace_count: 1,
  total_issues: 3,
  needs_repair: true,
} satisfies ReviewStageProgressHealthResponse

const healthy = {
  ok: true,
  orphan_progress_count: 0,
  orphan_study_session_count: 0,
  stage_gap_palace_count: 0,
  total_issues: 0,
  needs_repair: false,
} satisfies ReviewStageProgressHealthResponse

describe('ReviewOverview', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.getReviewQueueApi.mockResolvedValue(queue)
    mocks.getChapterReviewQueueApi.mockResolvedValue({
      ...queue,
      chapter: { id: 12, name: 'Chapter', subject_id: 1, subject: { id: 1, name: 'Subject' } },
    })
    mocks.getReviewStageProgressHealthApi.mockResolvedValue(healthy)
    mocks.repairReviewStageProgressApi.mockResolvedValue({
      ok: true,
      palace_count: 2,
      segment_count: 0,
    })
  })

  it('shows stage-progress health issues and repairs through the existing repair API', async () => {
    mocks.getReviewStageProgressHealthApi
      .mockResolvedValueOnce(unhealthy)
      .mockResolvedValueOnce(healthy)

    render(
      <MemoryRouter initialEntries={['/review']}>
        <ReviewOverview />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/检测到 3 处复习进度异常/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '一键修复' }))

    await waitFor(() => expect(mocks.repairReviewStageProgressApi).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.getReviewStageProgressHealthApi).toHaveBeenCalledTimes(2))
    expect(mocks.getReviewQueueApi).toHaveBeenCalledTimes(2)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('修复完成：重建 2 个宫殿')
  })

  it('does not request stage-progress health in chapter review mode', async () => {
    render(
      <MemoryRouter initialEntries={['/review?chapterId=12']}>
        <ReviewOverview />
      </MemoryRouter>,
    )

    expect(await screen.findByText('章节复习：Subject / Chapter')).toBeTruthy()
    expect(mocks.getChapterReviewQueueApi).toHaveBeenCalledWith(12)
    expect(mocks.getReviewStageProgressHealthApi).not.toHaveBeenCalled()
  })
})
