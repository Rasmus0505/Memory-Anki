import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PalaceListPage from '@/app/router/PalaceListPage'
import { PALACE_LIST_VIEW_SETTINGS_KEY } from '@/app/router/palace-view-settings'

const navigate = vi.fn()
const searchParams = new URLSearchParams()
const setSearchParams = vi.fn()

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => navigate,
  useSearchParams: () => [searchParams, setSearchParams],
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/app/router/palace-list/PalaceStageProgress', () => ({
  PalaceStageProgress: () => <div data-testid="stage-progress" />,
  formatStageDateTime: () => '',
  toDateTimeLocalValue: () => '',
}))

const getPalacesGroupedApi = vi.fn()
const submitSegmentReviewSessionApi = vi.fn()

vi.mock('@/shared/api/modules/palaces', () => ({
  deletePalaceApi: vi.fn(),
  getPalaceReviewPlanApi: vi.fn(),
  getPalacesGroupedApi: (...args: unknown[]) => getPalacesGroupedApi(...args),
  updateDefaultSegmentReviewProgressApi: vi.fn(),
  updatePalaceSegmentReviewProgressApi: vi.fn(),
}))

vi.mock('@/shared/api/modules/reviews', () => ({
  submitReviewSessionApi: vi.fn(),
  submitSegmentReviewSessionApi: (...args: unknown[]) => submitSegmentReviewSessionApi(...args),
}))

const duePalace = {
  id: 1,
  title: '第四节 收回教育权运动与教会教育的变革',
  resolved_title: '第四节 收回教育权运动与教会教育的变革',
  description: '',
  created_at: '2026-05-11T00:00:00',
  chapters: [],
  mastered: false,
  has_due_review: false,
  current_review_schedule_id: null,
  next_review_at: null,
  review_stage_completed: 0,
  review_stage_total: 9,
  review_stage_progress: 0,
  review_stages: [],
  stage_labels: [],
  title_mode: 'sync',
  manual_title: '',
  grouping_mode: 'auto',
  manual_group_chapter_id: null,
  resolved_subject: { id: 1, name: '中国近代史', color: '#6366f1' },
  resolved_parent_chapter: { id: 2, name: '第四节', subject_id: 1, parent_id: null },
  binding_status: 'ok',
  primary_chapter_id: 3,
  primary_chapter: { id: 3, name: '收回教育权运动', subject_id: 1, parent_id: 2 },
  group_id: null,
  group: null,
  group_sort_order: 0,
  segments: [
    {
      id: 10,
      palace_id: 1,
      name: '第 1 部分',
      display_name: '第 1 部分',
      color: '#14b8a6',
      node_count: 49,
      sort_order: 0,
      is_virtual_default: false,
      has_due_review: true,
      current_review_schedule_id: 88,
      next_review_at: '2026-05-11T00:00:00',
      estimated_review_seconds: 100,
      review_stage_completed: 0,
      review_stage_total: 9,
      review_stage_progress: 0,
      review_stages: [],
      stage_labels: [],
    },
  ],
}

const reviewedPalace = {
  ...duePalace,
  segments: [
    {
      ...duePalace.segments[0],
      has_due_review: false,
      current_review_schedule_id: null,
    },
  ],
}

const RealDate = Date

function buildLaterTodayPalace() {
  return {
    ...duePalace,
    id: 2,
    title: '第五节 今日稍后复习',
    resolved_title: '第五节 今日稍后复习',
    needs_practice: true,
    segments: [
      {
        ...duePalace.segments[0],
        id: 20,
        palace_id: 2,
        has_due_review: false,
        current_review_schedule_id: 188,
        next_review_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      },
    ],
  }
}

describe('PalaceListPage', () => {
  beforeEach(() => {
    const fixedNow = new RealDate('2026-05-11T10:00:00Z')
    class MockDate extends RealDate {
      constructor(value?: string | number | Date) {
        super(value ?? fixedNow)
      }

      static now() {
        return fixedNow.getTime()
      }
    }

    vi.stubGlobal('Date', MockDate as unknown as DateConstructor)
    navigate.mockReset()
    getPalacesGroupedApi.mockReset()
    submitSegmentReviewSessionApi.mockReset()
    searchParams.set('subjectId', '1')
    searchParams.delete('search')
    searchParams.delete('uncategorized')
    window.localStorage.clear()
    getPalacesGroupedApi
      .mockResolvedValueOnce({
        groups: [],
        ungrouped: [],
        subjects: [
          {
            subject: { id: 1, name: '中国近代史', color: '#6366f1' },
            chapter_groups: [
              {
                source_chapter: { id: 2, name: '第四节', subject_id: 1, parent_id: null },
                palaces: [duePalace],
              },
            ],
            ungrouped_palaces: [],
          },
        ],
      })
      .mockResolvedValue({
        groups: [],
        ungrouped: [],
        subjects: [
          {
            subject: { id: 1, name: '中国近代史', color: '#6366f1' },
            chapter_groups: [
              {
                source_chapter: { id: 2, name: '第四节', subject_id: 1, parent_id: null },
                palaces: [reviewedPalace],
              },
            ],
            ungrouped_palaces: [],
          },
        ],
    })
    submitSegmentReviewSessionApi.mockResolvedValue({ ok: true, next_id: 89, score: 5 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders single-segment palaces in compact two-line mode without default segment label', async () => {
    render(<PalaceListPage />)

    expect(await screen.findByText('第四节 收回教育权运动与教会教育的变革')).toBeTruthy()
    expect(screen.getByText('当前书架：中国近代史')).toBeTruthy()
    expect(screen.queryByText('第 1 部分')).toBeNull()
    expect(screen.getByText('预计 1分 40秒')).toBeTruthy()
    expect(screen.getByRole('button', { name: '开始复习' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '练习' })).toBeTruthy()
  })

  it('renders later-today review in yellow and highlights practice button when needs practice', async () => {
    const laterTodayPalace = buildLaterTodayPalace()
    getPalacesGroupedApi.mockReset()
    getPalacesGroupedApi.mockResolvedValue({
      groups: [],
      ungrouped: [],
      subjects: [
        {
          subject: { id: 1, name: '中国近代史', color: '#6366f1' },
          chapter_groups: [
            {
              source_chapter: { id: 2, name: '第五节', subject_id: 1, parent_id: null },
              palaces: [laterTodayPalace],
            },
          ],
          ungrouped_palaces: [],
        },
      ],
    })

    render(<PalaceListPage />)

    const reviewButton = await screen.findByRole('button', { name: /小时|分钟/ })
    expect(reviewButton.className).toContain('bg-amber-100')
    const practiceButton = screen.getByRole('button', { name: '练习' })
    expect(practiceButton.className).toContain('bg-emerald-600')
  })

  it('defaults to chapter-double and keeps local view settings after switching', async () => {
    render(<PalaceListPage />)

    await screen.findByText('第四节 收回教育权运动与教会教育的变革')
    expect(screen.getByTestId('list-layout-root').dataset.layoutMode).toBe('chapter-double')

    fireEvent.click(screen.getByRole('button', { name: '章节卡片双列' }))
    fireEvent.click(screen.getByRole('button', { name: '紧凑' }))

    expect(screen.getByTestId('list-layout-root').dataset.layoutMode).toBe('chapter-card-grid')
    expect(screen.getByTestId('list-layout-root').dataset.densityMode).toBe('compact')
    expect(window.localStorage.getItem(PALACE_LIST_VIEW_SETTINGS_KEY)).toContain('"layoutMode":"chapter-card-grid"')
  })

  it('clears search without dropping current subject context', async () => {
    searchParams.set('search', '教育')
    render(<PalaceListPage />)

    await screen.findByText('第四节 收回教育权运动与教会教育的变革')
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))

    await waitFor(() => {
      expect(setSearchParams).toHaveBeenCalled()
    })
  })
})
