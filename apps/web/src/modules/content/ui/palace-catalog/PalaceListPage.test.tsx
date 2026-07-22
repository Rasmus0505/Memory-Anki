import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PalaceListPage from '@/modules/content/ui/palace-catalog/PalaceListPage'
import { PALACE_LIST_VIEW_SETTINGS_KEY } from '@/modules/settings/public'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { updateClientPreferencesApi } from '@/modules/settings/public'
import { buildPalaceCatalogGroupedQueryKey } from '@/modules/content/ui/palace-catalog/model/palaceCatalog'

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


const getPalacesGroupedApi = vi.fn()
let queryClient: QueryClient

vi.mock('@/modules/content/domain/palace-entity/api', () => ({
  buildPalaceCatalogGroupedQueryKey: (params: Record<string, string>) => ['palace-catalog', 'grouped', params],
  getPalacesGroupedApi: (...args: unknown[]) => getPalacesGroupedApi(...args),
  PALACE_CATALOG_GROUPED_QUERY_KEY: ['palace-catalog', 'grouped'],
  PALACE_CATALOG_INVALIDATED_EVENT: 'palace-catalog:invalidated',
}))

vi.mock('@/modules/content/domain/palace-entity/api', () => ({
  buildPalaceCatalogGroupedQueryKey: (params: Record<string, string>) => ['palace-catalog', 'grouped', params],
  deletePalaceApi: vi.fn(),
  getPalaceReviewPlanApi: vi.fn(),
  getPalacesGroupedApi: (...args: unknown[]) => getPalacesGroupedApi(...args),
  PALACE_CATALOG_GROUPED_QUERY_KEY: ['palace-catalog', 'grouped'],
  PALACE_CATALOG_INVALIDATED_EVENT: 'palace-catalog:invalidated',
}))

vi.mock('@/modules/content/domain/palace-segment-entity/api', () => ({
  updateDefaultSegmentReviewProgressApi: vi.fn(),
  updatePalaceSegmentReviewProgressApi: vi.fn(),
}))

vi.mock('@/modules/settings/public', () => ({
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
      name: '第 1 学习组',
      display_name: '第 1 学习组',
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

function renderPalaceListPage() {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <PalaceListPage />
    </QueryClientProvider>,
  )
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
  })

  afterEach(() => {
    queryClient?.clear()
    vi.unstubAllGlobals()
  })

  it('renders single-segment palaces in compact two-line mode without default segment label', async () => {
    renderPalaceListPage()

    expect(await screen.findByText('第四节 收回教育权运动与教会教育的变革')).toBeTruthy()
    expect(queryClient.getQueryData(buildPalaceCatalogGroupedQueryKey({ subject_id: '1' }))).toMatchObject({
      subjects: [{ subject: { id: 1, name: '中国近代史' } }],
    })
    expect(screen.getByText('记忆宫殿')).toBeTruthy()
    expect(screen.queryByText('第 1 部分')).toBeNull()
    expect(screen.getAllByText('预计 1分 40秒').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /开始复习/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: '做题' })).toBeTruthy()
  })

  it('refreshes palace cards when the catalog invalidation event fires', async () => {
    renderPalaceListPage()

    expect(await screen.findByRole('button', { name: /开始复习/ })).toBeTruthy()
    window.dispatchEvent(new CustomEvent('palace-catalog:invalidated'))

    await waitFor(() => expect(getPalacesGroupedApi).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('button', { name: /开始复习/ })).toBeNull())
    expect(queryClient.getQueryState(buildPalaceCatalogGroupedQueryKey({ subject_id: '1' }))?.dataUpdateCount).toBe(2)
  })

  it('opens formal review sessions for virtual default palace progress', async () => {
    getPalacesGroupedApi.mockReset()
    getPalacesGroupedApi.mockResolvedValue({
      groups: [],
      ungrouped: [],
      subjects: [
        {
          subject: { id: 1, name: '中国近代史', color: '#6366f1' },
          chapter_groups: [
            {
              source_chapter: { id: 2, name: '第四节', subject_id: 1, parent_id: null },
              palaces: [
                {
                  ...duePalace,
                  segments: [
                    {
                      ...duePalace.segments[0],
                      id: 0,
                      is_virtual_default: true,
                      current_review_schedule_id: 88,
                      has_due_review: true,
                      active_review_progress: 0.5,
                    },
                  ],
                },
              ],
            },
          ],
          ungrouped_palaces: [],
        },
      ],
    })

    renderPalaceListPage()

    const startButton = await screen.findByRole('button', { name: /开始复习/ })
    expect(screen.getByRole('progressbar', { name: '复习进度 50%' })).toBeTruthy()
    fireEvent.click(startButton)

    expect(navigate).toHaveBeenCalledWith('/review/session/88')
  })

  it('defaults to chapter-double and keeps local view settings after switching', async () => {
    renderPalaceListPage()

    await screen.findByText('第四节 收回教育权运动与教会教育的变革')
    expect(screen.getByTestId('list-layout-root').dataset.layoutMode).toBe('chapter-double')

    fireEvent.click(screen.getByRole('button', { name: '章节知识点双列' }))
    fireEvent.click(screen.getByRole('button', { name: '紧凑' }))

    expect(screen.getByTestId('list-layout-root').dataset.layoutMode).toBe('chapter-card-grid')
    expect(screen.getByTestId('list-layout-root').dataset.densityMode).toBe('compact')
    expect(window.localStorage.getItem(PALACE_LIST_VIEW_SETTINGS_KEY)).toBeNull()
    await waitFor(() => {
      expect(mockUpdateClientPreferencesApi).toHaveBeenLastCalledWith({
        palace_list_view_settings: {
          layoutMode: 'chapter-card-grid',
          densityMode: 'compact',
        },
      })
    })
  })

  it('clears search without dropping current subject context', async () => {
    searchParams.set('search', '教育')
    renderPalaceListPage()

    const highlights = await screen.findAllByText('教育')
    expect(highlights.some((highlight) => highlight.tagName === 'MARK')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))

    await waitFor(() => {
      expect(setSearchParams).toHaveBeenCalled()
    })
  })
})
