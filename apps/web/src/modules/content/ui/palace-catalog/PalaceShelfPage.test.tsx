import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PalaceShelfPage from '@/modules/content/ui/palace-catalog/PalaceShelfPage'
import { PALACE_SHELF_VIEW_SETTINGS_KEY } from '@/modules/settings/public'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { updateClientPreferencesApi } from '@/modules/settings/public'

const navigate = vi.fn()
const searchParams = new URLSearchParams()
const setSearchParams = vi.fn()
const getPalaceSubjectShelfApi = vi.fn()
const getPalacesGroupedApi = vi.fn()

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


vi.mock('@/modules/content/domain/palace-entity/api', () => ({
  getPalaceSubjectShelfApi: (...args: unknown[]) => getPalaceSubjectShelfApi(...args),
  getPalacesGroupedApi: (...args: unknown[]) => getPalacesGroupedApi(...args),
  getPalaceEditorApi: vi.fn(),
  getPracticeSessionProgressApi: vi.fn(),
  getSegmentPracticeSessionProgressApi: vi.fn(),
  PALACE_CATALOG_INVALIDATED_EVENT: 'palace-catalog:invalidated',
  deletePalaceApi: vi.fn(),
}))
vi.mock('@/modules/content/domain/palace-segment-entity/api', () => ({
  updateDefaultSegmentReviewProgressApi: vi.fn(),
  updatePalaceSegmentReviewProgressApi: vi.fn(),
}))

vi.mock('@/modules/settings/public', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/settings/public')>()
  return {
    ...actual,
    getClientPreferencesApi: vi.fn(async () => ({ items: {} })),
    updateClientPreferencesApi: vi.fn(async (data: Record<string, unknown>) => ({ items: data })),
  }
})

const mockUpdateClientPreferencesApi = vi.mocked(updateClientPreferencesApi)

function buildShelfItem(overrides: Record<string, unknown> = {}) {
  return {
    subject: { id: 1, name: '中国近代史', color: '#6366f1' },
    palace_count: 3,
    chapter_count: 5,
    review_status: 'due_now',
    has_due_review: true,
    has_due_later_today: false,
    due_now_count: 1,
    due_later_today_count: 0,
    needs_practice_count: 0,
    ...overrides,
  }
}

function buildGroupedResponse() {
  const dueIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const laterTodayIso = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  return {
    groups: [],
    ungrouped: [],
    subjects: [
      {
        subject: { id: 1, name: '中国近代史', color: '#6366f1' },
        chapter_groups: [
          {
            source_chapter: { id: 11, name: '第一章', subject_id: 1, parent_id: null },
            palaces: [
              {
                id: 101,
                title: '中国教育史宫殿',
                resolved_title: '中国教育史宫殿',
                manual_title: '',
                title_mode: 'sync',
                grouping_mode: 'auto',
                manual_group_chapter_id: null,
                binding_status: 'bound',
                primary_chapter_id: 11,
                primary_chapter: { id: 11, name: '第一章', subject_id: 1, parent_id: null },
                resolved_subject: { id: 1, name: '中国近代史', color: '#6366f1' },
                resolved_parent_chapter: null,
                group_id: null,
                group_sort_order: 0,
                created_at: '2026-06-03T09:00:00',
                description: '',
                archived: false,
                mastered: false,
                needs_practice: true,
                next_scheduled_date: '2026-06-03',
                next_review_at: dueIso,
                has_due_review: false,
                current_review_schedule_id: null,
                review_stage_total: 9,
                review_stage_completed: 0,
                review_stage_progress: 0,
                stage_labels: [],
                review_stages: [],
                pegs: [],
                attachments: [],
                chapters: [{ id: 11, name: '第一章', subject_id: 1, parent_id: null }],
                segments: [
                  {
                    id: 201,
                    palace_id: 101,
                    name: '第 1 学习组',
                    display_name: '第 1 学习组',
                    color: '#14b8a6',
                    node_count: 49,
                    sort_order: 0,
                    is_virtual_default: false,
                    has_due_review: true,
                    current_review_schedule_id: 501,
                    next_review_at: dueIso,
                    estimated_review_seconds: 100,
                    review_stage_completed: 0,
                    review_stage_total: 9,
                    review_stage_progress: 0,
                    review_stages: [],
                    stage_labels: [],
                  },
                ],
                mini_palaces: [
                  {
                    id: 301,
                    palace_id: 101,
                    name: '迷你宫殿训练 A',
                    node_uids: ['mini-a-1'],
                    node_count: 12,
                    sort_order: 0,
                    created_at: '2026-06-03T09:00:00',
                    updated_at: '2026-06-03T10:00:00',
                    is_empty: false,
                    needs_practice: true,
                    estimated_review_seconds: 90,
                    review_stage_total: 9,
                    review_stage_completed: 0,
                    review_stage_progress: 0,
                    stage_labels: [],
                    review_stages: [],
                    next_review_at: dueIso,
                    has_due_review: true,
                    current_review_schedule_id: 701,
                    current_review_type: null,
                  },
                  {
                    id: 302,
                    palace_id: 101,
                    name: '迷你宫殿训练 B',
                    node_uids: ['mini-b-1'],
                    node_count: 8,
                    sort_order: 1,
                    created_at: '2026-06-03T09:00:00',
                    updated_at: '2026-06-03T10:00:00',
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
                    current_review_schedule_id: 702,
                    current_review_type: 'sleep',
                  },
                ],
              },
            ],
          },
        ],
        ungrouped_palaces: [],
      },
    ],
  }
}

describe('PalaceShelfPage', () => {
  beforeEach(() => {
    navigate.mockReset()
    setSearchParams.mockReset()
    getPalaceSubjectShelfApi.mockReset()
    getPalacesGroupedApi.mockReset()
    getPalaceSubjectShelfApi.mockResolvedValue({ items: [buildShelfItem()] })
    getPalacesGroupedApi.mockResolvedValue(buildGroupedResponse())
    searchParams.delete('search')
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
    mockUpdateClientPreferencesApi.mockClear()
  })

  it('renders subject shelf cards and navigates by subject id', async () => {
    render(<PalaceShelfPage />)

    const title = await screen.findByText('中国近代史')
    expect(getPalacesGroupedApi).not.toHaveBeenCalled()
    fireEvent.click(title.closest('button') as HTMLButtonElement)
    expect(navigate).toHaveBeenCalledWith('/palaces/list?subjectId=1')
    expect(screen.getByText('立即复习')).toBeTruthy()
  })

  it('renders uncategorized shelf and navigates to uncategorized list', async () => {
    getPalaceSubjectShelfApi.mockResolvedValue({
      items: [
        buildShelfItem({
          subject: null,
          palace_count: 2,
          chapter_count: 0,
          review_status: 'idle',
          has_due_review: false,
          has_due_later_today: false,
          due_now_count: 0,
          due_later_today_count: 0,
          needs_practice_count: 0,
        }),
      ],
    })

    render(<PalaceShelfPage />)

    const title = await screen.findByText('未分类')
    fireEvent.click(title.closest('button') as HTMLButtonElement)
    expect(navigate).toHaveBeenCalledWith('/palaces/list?uncategorized=true')
    expect(screen.getByText('当前没有紧急复习')).toBeTruthy()
  })

  it('passes search text to both shelf apis', async () => {
    getPalaceSubjectShelfApi.mockResolvedValue({ items: [] })
    getPalacesGroupedApi.mockResolvedValue({ groups: [], ungrouped: [], subjects: [] })

    render(<PalaceShelfPage />)

    fireEvent.change(screen.getByPlaceholderText('搜索学科或宫殿...'), { target: { value: '历史' } })
    await waitFor(() => {
      expect(setSearchParams).toHaveBeenCalled()
    })
  })

  it('uses double layout by default and persists custom shelf view settings', async () => {
    render(<PalaceShelfPage />)

    await screen.findByText('中国近代史')
    expect(screen.getByTestId('shelf-grid').dataset.layoutMode).toBe('double')
    fireEvent.click(screen.getByRole('button', { name: '单列' }))
    fireEvent.click(screen.getByRole('button', { name: '紧凑' }))

    expect(screen.getByTestId('shelf-grid').dataset.layoutMode).toBe('single')
    expect(screen.getByTestId('shelf-grid').dataset.densityMode).toBe('compact')
    expect(window.localStorage.getItem(PALACE_SHELF_VIEW_SETTINGS_KEY)).toBeNull()
    expect(mockUpdateClientPreferencesApi).toHaveBeenLastCalledWith({
      palace_shelf_view_settings: {
        displayMode: 'shelf',
        layoutMode: 'single',
        expandedLayoutMode: 'chapter-double',
        densityMode: 'compact',
      },
    })
  })

  it('switches to expanded mode and persists expanded layout settings', async () => {
    render(<PalaceShelfPage />)

    await screen.findByText('中国近代史')
    expect(getPalacesGroupedApi).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '展开' }))
    await screen.findByText('中国教育史宫殿')

    expect(getPalacesGroupedApi).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('list-layout-root').dataset.layoutMode).toBe('chapter-double')
    expect(screen.getAllByRole('button', { name: '开始复习' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: '做题' }).length).toBeGreaterThan(0)
    expect(screen.getByLabelText(/编辑宫殿/)).toBeTruthy()
    expect(screen.getByLabelText(/更多操作/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: '开始复习' })[0])
    expect(navigate).toHaveBeenCalledWith('/review/session/501')
    fireEvent.click(screen.getByRole('button', { name: '知识点流' }))

    expect(screen.getByTestId('list-layout-root').dataset.layoutMode).toBe('flow')
    expect(window.localStorage.getItem(PALACE_SHELF_VIEW_SETTINGS_KEY)).toBeNull()
    expect(mockUpdateClientPreferencesApi).toHaveBeenLastCalledWith({
      palace_shelf_view_settings: {
        displayMode: 'expanded',
        layoutMode: 'double',
        expandedLayoutMode: 'flow',
        densityMode: 'standard',
      },
    })
  })


  it('refreshes shelf and expanded palace data when the catalog is invalidated', async () => {
    render(<PalaceShelfPage />)

    await screen.findByText('中国近代史')
    fireEvent.click(screen.getByRole('button', { name: '展开' }))
    await screen.findByText('中国教育史宫殿')

    window.dispatchEvent(new CustomEvent('palace-catalog:invalidated'))

    await waitFor(() => {
      expect(getPalaceSubjectShelfApi).toHaveBeenCalledTimes(2)
      expect(getPalacesGroupedApi).toHaveBeenCalledTimes(2)
    })
  })

  it('reveals delete inside the overflow menu in expanded mode', async () => {
    render(<PalaceShelfPage />)

    await screen.findByText('中国近代史')
    fireEvent.click(screen.getByRole('button', { name: '展开' }))
    await screen.findByText('中国教育史宫殿')

    fireEvent.click(screen.getByLabelText(/更多操作/))
    expect(screen.getByRole('button', { name: '删除' })).toBeTruthy()
  })
})
