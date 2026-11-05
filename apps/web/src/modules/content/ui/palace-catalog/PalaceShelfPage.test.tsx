import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PalaceShelfPage from '@/modules/content/ui/palace-catalog/PalaceShelfPage'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { resetPalaceDirectoryViewState } from '@/modules/content/ui/palace-edit/model/palaceDirectoryViewState'

const navigate = vi.fn()
const searchParams = new URLSearchParams()
const setSearchParams = vi.fn()
const getPalaceSubjectShelfApi = vi.fn()
const getPalacesGroupedApi = vi.fn()

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string } & Record<string, unknown>) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => navigate,
  useSearchParams: () => [searchParams, setSearchParams],
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
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
  }
})

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
                review_status: 'marking_required',
                review_unit_count: 0,
                due_review_unit_count: 0,
                permanent_mark_count: 0,
                next_review_date: null,
                mastered: false,
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

// Shelf cards embed the subject memory ladder, which fetches through
// react-query; the real app mounts a QueryClientProvider at the root.
function renderShelfPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PalaceShelfPage />
    </QueryClientProvider>,
  )
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
    resetPalaceDirectoryViewState()
  })

  it('lists subjects as tree rows with their due counts and the way into the subject', async () => {
    renderShelfPage()

    expect(await screen.findByText('中国近代史')).toBeTruthy()
    expect(screen.getByTestId('shelf-tree')).toBeTruthy()
    expect(screen.getByText('3 座宫殿')).toBeTruthy()
    expect(screen.getByTitle('1 个现在可以复习')).toBeTruthy()
    expect(screen.getByRole('link', { name: '打开 中国近代史 书架' }).getAttribute('href')).toBe('/palaces/list?subjectId=1')
    // Folded by default: palaces show once their subject is opened.
    expect(screen.queryByText('中国教育史宫殿')).toBeNull()
  })

  it('opens a subject to show its chapters and palaces, and a palace opens its editor', async () => {
    renderShelfPage()

    fireEvent.click(await screen.findByRole('button', { name: '展开中国近代史' }))
    // A chapter holding a single palace is shown as that palace's row.
    expect(screen.queryByRole('button', { name: '展开第一章' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '中国教育史宫殿' }))
    expect(navigate).toHaveBeenCalledWith('/palaces/101/edit')
  })

  it('starts marking from the palace row and keeps 做题 and the row menu beside it', async () => {
    renderShelfPage()

    fireEvent.click(await screen.findByRole('button', { name: '展开中国近代史' }))
    fireEvent.click(screen.getByRole('button', { name: '开始标记' }))
    expect(navigate).toHaveBeenCalledWith('/palaces/101/edit?mode=permanent-mark')
    expect(screen.getByRole('link', { name: /做题/ }).getAttribute('href')).toBe('/palaces/101/quiz')

    fireEvent.keyDown(screen.getByRole('button', { name: /更多操作/ }), { key: 'Enter' })
    expect(await screen.findByRole('menuitem', { name: '删除' })).toBeTruthy()
  })

  it('keeps uncategorized palaces in their own bucket with a way into the list', async () => {
    getPalacesGroupedApi.mockResolvedValue({
      groups: [],
      ungrouped: [],
      subjects: [{
        subject: null,
        chapter_groups: [],
        ungrouped_palaces: [{ ...buildGroupedResponse().subjects[0].chapter_groups[0].palaces[0], id: 202, title: '散页', resolved_title: '散页' }],
      }],
    })
    getPalaceSubjectShelfApi.mockResolvedValue({ items: [buildShelfItem({ subject: null })] })

    renderShelfPage()

    expect(await screen.findByText('未分类')).toBeTruthy()
    expect(screen.getByRole('link', { name: '打开 未分类 书架' }).getAttribute('href')).toBe('/palaces/list?uncategorized=true')
  })

  it('passes search text to both shelf apis and opens every fold for the results', async () => {
    searchParams.set('search', '教育')
    renderShelfPage()

    expect(await screen.findByRole('button', { name: '中国教育史宫殿' })).toBeTruthy()
    expect(getPalaceSubjectShelfApi).toHaveBeenCalledWith({ search: '教育' })
    expect(getPalacesGroupedApi).toHaveBeenCalledWith({ search: '教育' })
    const marks = screen.getAllByText('教育').filter((node) => node.tagName === 'MARK')
    expect(marks.length).toBeGreaterThan(0)

    fireEvent.change(screen.getByPlaceholderText('搜索学科或宫殿...'), { target: { value: '历史' } })
    await waitFor(() => expect(setSearchParams).toHaveBeenCalled())
  })

  it('refreshes shelf and palace data when the catalog is invalidated', async () => {
    renderShelfPage()

    await screen.findByText('中国近代史')
    await waitFor(() => expect(getPalacesGroupedApi).toHaveBeenCalledTimes(1))
    window.dispatchEvent(new CustomEvent('palace-catalog:invalidated'))

    await waitFor(() => {
      expect(getPalaceSubjectShelfApi).toHaveBeenCalledTimes(2)
      expect(getPalacesGroupedApi).toHaveBeenCalledTimes(2)
    })
  })

  it('folds everything back with 全部收起', async () => {
    renderShelfPage()

    fireEvent.click(await screen.findByRole('button', { name: '展开中国近代史' }))
    expect(screen.getByRole('button', { name: '中国教育史宫殿' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '全部收起' }))
    expect(screen.queryByRole('button', { name: '中国教育史宫殿' })).toBeNull()
  })
})
