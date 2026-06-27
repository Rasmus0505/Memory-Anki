import * as React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PalaceListPage from '@/features/palace-catalog/PalaceListPage'
import { PALACE_LIST_VIEW_SETTINGS_KEY } from '@/entities/preferences/model/palaceViewSettings'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { updateClientPreferencesApi } from '@/entities/preferences/api/clientPreferencesApi'

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

vi.mock('@/features/palace-catalog/components/palace-list/PalaceStageProgress', () => ({
  PalaceStageProgress: () => <div data-testid="stage-progress" />,
  formatStageDateTime: () => '',
  toDateTimeLocalValue: () => '',
}))

const getPalacesGroupedApi = vi.fn()
const submitSegmentReviewSessionApi = vi.fn()

vi.mock('@/entities/palace/api/catalogApi', () => ({
  getPalacesGroupedApi: (...args: unknown[]) => getPalacesGroupedApi(...args),
  PALACE_CATALOG_INVALIDATED_EVENT: 'palace-catalog:invalidated',
}))

vi.mock('@/entities/palace/api', () => ({
  deletePalaceApi: vi.fn(),
  getPalaceReviewPlanApi: vi.fn(),
  getPalacesGroupedApi: (...args: unknown[]) => getPalacesGroupedApi(...args),
  PALACE_CATALOG_INVALIDATED_EVENT: 'palace-catalog:invalidated',
  updatePalaceMiniReviewModeApi: vi.fn(),
}))

vi.mock('@/entities/palace-segment/api', () => ({
  updateDefaultSegmentReviewProgressApi: vi.fn(),
  updatePalaceSegmentReviewProgressApi: vi.fn(),
}))

vi.mock('@/features/review/api/reviewApi', () => ({
  submitReviewSessionApi: vi.fn(),
  submitSegmentReviewSessionApi: (...args: unknown[]) => submitSegmentReviewSessionApi(...args),
}))

vi.mock('@/entities/preferences/api/clientPreferencesApi', () => ({
  getClientPreferencesApi: vi.fn(async () => ({ items: {} })),
  updateClientPreferencesApi: vi.fn(async (data: Record<string, unknown>) => ({ items: data })),
}))

const mockUpdateClientPreferencesApi = vi.mocked(updateClientPreferencesApi)

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
  mini_review_mode: 'independent',
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
      active_review_progress: 0.5,
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
        next_review_at: null,
        active_review_progress: null,
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
        active_review_progress: 0.5,
      },
    ],
  }
}

function buildSleepReviewPalace() {
  return {
    ...duePalace,
    id: 3,
    title: '第二节 新教教育',
    resolved_title: '第二节 新教教育',
    segments: [
      {
        ...duePalace.segments[0],
        id: 30,
        palace_id: 3,
        current_review_type: 'sleep',
        next_review_at: '2026-05-11T09:00:00Z',
        review_stage_completed: 1,
        active_review_progress: 0.5,
        stage_labels: ['1小时', '睡前', '1天'],
      },
    ],
  }
}

function buildMultiSegmentPalace() {
  return {
    ...duePalace,
    id: 5,
    title: '第六节 多块复习',
    resolved_title: '第六节 多块复习',
    segments: [
      {
        ...duePalace.segments[0],
        id: 50,
        palace_id: 5,
        name: '第 1 部分',
        display_name: '第 1 部分',
        active_review_progress: 0.5,
      },
      {
        ...duePalace.segments[0],
        id: 51,
        palace_id: 5,
        name: '第 2 部分',
        display_name: '第 2 部分',
        next_review_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        has_due_review: false,
        current_review_schedule_id: 189,
        active_review_progress: 0.75,
      },
    ],
  }
}

function buildDisabledStartReviewPalace() {
  return {
    ...duePalace,
    id: 6,
    title: '第七节 禁用复习',
    resolved_title: '第七节 禁用复习',
    segments: [
      {
        ...duePalace.segments[0],
        id: 60,
        palace_id: 6,
        current_review_schedule_id: null,
        active_review_progress: 0.5,
      },
    ],
  }
}

function buildMiniOnlyPalace() {
  const dueIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const laterTodayIso = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  return {
    ...duePalace,
    id: 4,
    title: '第一节人文主义教育',
    resolved_title: '第一节人文主义教育',
    mini_review_mode: 'mini_only',
    mini_palaces: [
      {
        id: 401,
        palace_id: 4,
        name: '小宫殿 A',
        node_uids: ['mini-a-1'],
        node_count: 6,
        sort_order: 0,
        created_at: '2026-05-11T00:00:00',
        updated_at: '2026-05-11T00:00:00',
        is_empty: false,
        needs_practice: false,
        estimated_review_seconds: 90,
        review_stage_total: 9,
        review_stage_completed: 0,
        review_stage_progress: 0,
        stage_labels: [],
        review_stages: [],
        next_review_at: dueIso,
        has_due_review: true,
        current_review_schedule_id: 901,
        current_review_type: null,
        active_review_progress: 0.5,
      },
      {
        id: 402,
        palace_id: 4,
        name: '小宫殿 B',
        node_uids: ['mini-b-1'],
        node_count: 4,
        sort_order: 1,
        created_at: '2026-05-11T00:00:00',
        updated_at: '2026-05-11T00:00:00',
        is_empty: false,
        needs_practice: false,
        estimated_review_seconds: 80,
        review_stage_total: 9,
        review_stage_completed: 1,
        review_stage_progress: 0.1,
        stage_labels: ['1小时', '睡前', '1天'],
        review_stages: [],
        next_review_at: laterTodayIso,
        has_due_review: false,
        current_review_schedule_id: 902,
        current_review_type: 'sleep',
        active_review_progress: 0.75,
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
    resetClientPreferenceCacheForTest()
    mockUpdateClientPreferencesApi.mockClear()
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
    expect(screen.getByText('记忆宫殿')).toBeTruthy()
    expect(screen.queryByText('第 1 部分')).toBeNull()
    expect(screen.getByText('预计 1分 40秒')).toBeTruthy()
    expect(screen.getByRole('button', { name: '开始复习' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '做题' })).toBeTruthy()
  })

  it('refreshes palace cards when the catalog invalidation event fires', async () => {
    render(<PalaceListPage />)

    expect(await screen.findByRole('button', { name: '开始复习' })).toBeTruthy()
    window.dispatchEvent(new CustomEvent('palace-catalog:invalidated'))

    await waitFor(() => expect(getPalacesGroupedApi).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('button', { name: '未排入复习' })).toBeTruthy()
  })

  it('shows saved incomplete progress inside the single-segment start review button without changing size', async () => {
    render(<PalaceListPage />)

    const reviewButton = await screen.findByRole('button', { name: '开始复习' })
    const progressFill = within(reviewButton).getByTestId('review-action-progress-fill')
    expect(progressFill).toBeTruthy()
    expect((progressFill as HTMLElement).style.width).toBe('50%')
    expect(reviewButton.className).toContain('h-8')
    expect(reviewButton.className).toContain('min-w-[104px]')
    expect(reviewButton.className).toContain('max-w-[132px]')
  })

  it('does not reuse palace-level practice highlighting for a single segment button', async () => {
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
    expect(reviewButton.className).not.toContain('bg-success')
    expect(within(reviewButton).queryByTestId('review-action-progress-fill')).toBeNull()
    const quizButton = screen.getByRole('button', { name: '做题' })
    expect(quizButton.className).not.toContain('bg-success')
  })

  it('keeps refreshed segment actions out of practice highlight after marking reviewed', async () => {
    const multiSegmentPalace = {
      ...buildMultiSegmentPalace(),
      needs_practice: true,
    }
    const refreshedMultiSegmentPalace = {
      ...multiSegmentPalace,
      needs_practice: false,
      segments: [
        {
          ...multiSegmentPalace.segments[0],
          has_due_review: false,
          current_review_schedule_id: 288,
          next_review_at: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
        },
        {
          ...multiSegmentPalace.segments[1],
          has_due_review: false,
          current_review_schedule_id: 289,
          next_review_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        },
      ],
    }
    getPalacesGroupedApi.mockReset()
    getPalacesGroupedApi
      .mockResolvedValueOnce({
        groups: [],
        ungrouped: [],
        subjects: [
          {
            subject: { id: 1, name: '中国近代史', color: '#6366f1' },
            chapter_groups: [
              {
                source_chapter: { id: 2, name: '第六节', subject_id: 1, parent_id: null },
                palaces: [multiSegmentPalace],
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
                source_chapter: { id: 2, name: '第六节', subject_id: 1, parent_id: null },
                palaces: [refreshedMultiSegmentPalace],
              },
            ],
            ungrouped_palaces: [],
          },
        ],
      })
    submitSegmentReviewSessionApi.mockResolvedValue({ ok: true, next_id: 289, score: 5 })

    render(<PalaceListPage />)

    await screen.findByRole('button', { name: '开始复习' })
    const markReviewedButton = screen
      .getAllByRole('button', { name: '标记已复习' })
      .find((button) => !(button as HTMLButtonElement).disabled)
    expect(markReviewedButton).toBeTruthy()
    fireEvent.click(markReviewedButton as HTMLButtonElement)

    await waitFor(() => {
      const refreshedButton = screen.getByRole('button', { name: /小时|分钟/ })
      expect(refreshedButton.className).not.toContain('bg-success')
    })
  })

  it('renders sleep review action with fixed blue sleep copy', async () => {
    const sleepReviewPalace = buildSleepReviewPalace()
    getPalacesGroupedApi.mockReset()
    getPalacesGroupedApi.mockResolvedValue({
      groups: [],
      ungrouped: [],
      subjects: [
        {
          subject: { id: 1, name: '中国近代史', color: '#6366f1' },
          chapter_groups: [
            {
              source_chapter: { id: 2, name: '第二节', subject_id: 1, parent_id: null },
              palaces: [sleepReviewPalace],
            },
          ],
          ungrouped_palaces: [],
        },
      ],
    })

    render(<PalaceListPage />)

    const reviewButton = await screen.findByRole('button', { name: '睡前复习' })
    expect(reviewButton.className).toContain('bg-info')
    expect(within(reviewButton).queryByTestId('review-action-progress-fill')).toBeNull()
    expect(screen.queryByRole('button', { name: '开始复习' })).toBeNull()
  })

  it('shows the internal progress fill only on the due-now segment button in multi-segment mode', async () => {
    const multiSegmentPalace = buildMultiSegmentPalace()
    getPalacesGroupedApi.mockReset()
    getPalacesGroupedApi.mockResolvedValue({
      groups: [],
      ungrouped: [],
      subjects: [
        {
          subject: { id: 1, name: '中国近代史', color: '#6366f1' },
          chapter_groups: [
            {
              source_chapter: { id: 2, name: '第六节', subject_id: 1, parent_id: null },
              palaces: [multiSegmentPalace],
            },
          ],
          ungrouped_palaces: [],
        },
      ],
    })

    render(<PalaceListPage />)

    expect(await screen.findByText('第六节 多块复习')).toBeTruthy()
    expect(screen.getAllByTestId('review-action-progress-fill')).toHaveLength(1)
    const startReviewButton = screen.getByRole('button', { name: '开始复习' })
    expect(within(startReviewButton).getByTestId('review-action-progress-fill')).toBeTruthy()
    const laterTodayButton = screen.getByRole('button', { name: /小时|分钟/ })
    expect(within(laterTodayButton).queryByTestId('review-action-progress-fill')).toBeNull()
  })

  it('does not show the internal progress fill for a disabled start review button', async () => {
    const disabledPalace = buildDisabledStartReviewPalace()
    getPalacesGroupedApi.mockReset()
    getPalacesGroupedApi.mockResolvedValue({
      groups: [],
      ungrouped: [],
      subjects: [
        {
          subject: { id: 1, name: '中国近代史', color: '#6366f1' },
          chapter_groups: [
            {
              source_chapter: { id: 2, name: '第七节', subject_id: 1, parent_id: null },
              palaces: [disabledPalace],
            },
          ],
          ungrouped_palaces: [],
        },
      ],
    })

    render(<PalaceListPage />)

    const reviewButton = await screen.findByRole('button', { name: '开始复习' })
    expect((reviewButton as HTMLButtonElement).disabled).toBe(true)
    expect(within(reviewButton).queryByTestId('review-action-progress-fill')).toBeNull()
  })

  it('keeps the single-segment review button compact so long titles stay visible', async () => {
    render(<PalaceListPage />)

    const reviewButton = await screen.findByRole('button', { name: '开始复习' })
    expect(reviewButton.className).toContain('min-w-[104px]')
    expect(reviewButton.className).toContain('max-w-[132px]')
  })

  it('opens config from the overflow menu', async () => {
    render(<PalaceListPage />)

    await screen.findByText('第四节 收回教育权运动与教会教育的变革')
    fireEvent.click(screen.getByLabelText(/更多操作/))
    fireEvent.click(screen.getByRole('button', { name: '配置' }))

    expect(await screen.findByText('配置小宫殿复习归属')).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存配置' })).toBeTruthy()
  })

  it('hides main palace review presentation when mini palaces take over review', async () => {
    const miniOnlyPalace = buildMiniOnlyPalace()
    getPalacesGroupedApi.mockReset()
    getPalacesGroupedApi.mockResolvedValue({
      groups: [],
      ungrouped: [],
      subjects: [
        {
          subject: { id: 1, name: '中国近代史', color: '#6366f1' },
          chapter_groups: [
            {
              source_chapter: { id: 2, name: '第一节', subject_id: 1, parent_id: null },
              palaces: [miniOnlyPalace],
            },
          ],
          ungrouped_palaces: [],
        },
      ],
    })

    render(<PalaceListPage />)

    expect(await screen.findByText('第一节人文主义教育')).toBeTruthy()
    expect(screen.queryByText('小宫殿已接管正式复习，主宫殿复习进度在这里不再单独提示。')).toBeNull()
    expect(screen.queryByText('第 1 部分')).toBeNull()
    expect(screen.queryByText('49 节点')).toBeNull()
    expect(screen.getAllByRole('button', { name: '开始复习' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: '睡前复习' })).toBeTruthy()
    const miniStartReviewButton = screen.getByRole('button', { name: '开始复习' })
    const miniProgressFill = within(miniStartReviewButton).getByTestId('review-action-progress-fill')
    expect((miniProgressFill as HTMLElement).style.width).toBe('50%')
  })

  it('defaults to chapter-double and keeps local view settings after switching', async () => {
    render(<PalaceListPage />)

    await screen.findByText('第四节 收回教育权运动与教会教育的变革')
    expect(screen.getByTestId('list-layout-root').dataset.layoutMode).toBe('chapter-double')

    fireEvent.click(screen.getByRole('button', { name: '章节卡片双列' }))
    fireEvent.click(screen.getByRole('button', { name: '紧凑' }))

    expect(screen.getByTestId('list-layout-root').dataset.layoutMode).toBe('chapter-card-grid')
    expect(screen.getByTestId('list-layout-root').dataset.densityMode).toBe('compact')
    expect(window.localStorage.getItem(PALACE_LIST_VIEW_SETTINGS_KEY)).toBeNull()
    expect(mockUpdateClientPreferencesApi).toHaveBeenLastCalledWith({
      palace_list_view_settings: {
        layoutMode: 'chapter-card-grid',
        densityMode: 'compact',
      },
    })
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


