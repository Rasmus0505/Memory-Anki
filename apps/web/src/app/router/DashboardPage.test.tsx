import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from '@/app/router/DashboardPage'
import type { DashboardResponse } from '@/shared/api/contracts'

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

const getDashboardApi = vi.fn()

function buildDashboardResponse(
  payload: Partial<DashboardResponse> & {
    stats?: Partial<DashboardResponse['stats']>
    english_stats?: Partial<DashboardResponse['english_stats']>
  },
): DashboardResponse {
  const { stats, english_stats, ...rest } = payload
  return {
    due_count: 0,
    due_later_today_count: 0,
    needs_practice_count: 0,
    reviews: [],
    stats: {
      total: 0,
      review_count: 0,
      review_duration_seconds: 0,
      ...stats,
    },
    today_review_duration_seconds: 0,
    weekly_review_duration_seconds: 0,
    today_total_review_duration_seconds: 0,
    monthly_total_review_duration_seconds: 0,
    selected_total_review_duration_seconds: 0,
    weekly_total_review_duration_seconds: 0,
    weekly_formal_review_duration_seconds: 0,
    english_stats: {
      total_courses: 0,
      unfinished_courses: 0,
      completed_courses: 0,
      today_practice_seconds: 0,
      weekly_practice_seconds: 0,
      total_practice_seconds: 0,
      ...english_stats,
    },
    today_learning_palaces: [],
    today_new_palace_count: 0,
    today_new_palaces: [],
    recent_palaces: [],
    ...rest,
  }
}

vi.mock('@/shared/api/modules/dashboard', () => ({
  getDashboardApi: async (...args: unknown[]) => buildDashboardResponse(await getDashboardApi(...args)),
}))

vi.mock('@/features/profile/hooks/useTimeRecordsDashboard', () => ({
  useTimeRecordsDashboard: () => ({
    thresholdInput: '0',
    setThresholdInput: vi.fn(),
    showBelowThreshold: false,
    setShowBelowThreshold: vi.fn(),
    showDeleted: false,
    setShowDeleted: vi.fn(),
    kindFilter: 'all',
    setKindFilter: vi.fn(),
    keyword: '',
    setKeyword: vi.fn(),
    selectedRecordIds: [],
    dialogMode: 'create',
    dialogOpen: false,
    formState: {},
    formError: null,
    isSubmittingRecord: false,
    deletingRecordId: null,
    restoringRecordId: null,
    isBulkDeleting: false,
    summary: {},
    trend: [],
    breakdown: [],
    visibleRecords: [],
    hasSelectableRecords: false,
    allSelectableChecked: false,
    hasSelectedRecords: false,
    refreshRecords: vi.fn(),
    applyThreshold: vi.fn(),
    openCreateDialog: vi.fn(),
    openEditDialog: vi.fn(),
    handleDeleteRecord: vi.fn(),
    handleRestoreRecord: vi.fn(),
    toggleRecordSelection: vi.fn(),
    toggleSelectAllVisible: vi.fn(),
    handleBulkDelete: vi.fn(),
    onDialogOpenChange: vi.fn(),
    onFormChange: vi.fn(),
    handleSubmitRecord: vi.fn(),
  }),
}))

vi.mock('@/features/profile/components/TimeRecordsTrendChart', () => ({
  TimeRecordsTrendChart: () => <div data-testid="trend-chart" />,
}))

vi.mock('@/features/profile/components/TimeRecordsBreakdownChart', () => ({
  TimeRecordsBreakdownChart: () => <div data-testid="breakdown-chart" />,
}))

vi.mock('@/features/profile/components/TimeRecordsTable', () => ({
  TimeRecordsTable: () => <div data-testid="records-table" />,
}))

vi.mock('@/features/profile/components/TimeRecordDialog', () => ({
  TimeRecordDialog: () => null,
}))

describe('DashboardPage', () => {
  beforeEach(() => {
    getDashboardApi.mockReset()
    window.localStorage.clear()
  })

  it('renders learning breakdown and today new palace hierarchy', async () => {
    getDashboardApi.mockResolvedValue({
      due_count: 2,
      due_later_today_count: 1,
      needs_practice_count: 3,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 5400,
      monthly_total_review_duration_seconds: 14400,
      selected_total_review_duration_seconds: 14400,
      weekly_total_review_duration_seconds: 7200,
      weekly_formal_review_duration_seconds: 3600,
      recent_palaces: [],
      today_learning_palaces: [
        {
          palace_id: 1,
          palace_title: '第五节 陈鹤琴的“活教育”探索',
          total_seconds: 3600,
          review_seconds: 1200,
          practice_seconds: 900,
          palace_edit_seconds: 1500,
        },
      ],
      today_new_palace_count: 2,
      today_new_palaces: [
        {
          subject: { id: 1, name: '中国教育史', color: '#6366f1' },
          chapter_groups: [
            {
              source_chapter: { id: 10, name: '第五章 现代教育实验', subject_id: 1, parent_id: null },
              palaces: [
                {
                  id: 1,
                  title: '第五节 陈鹤琴的“活教育”探索',
                  created_at: '2026-05-23T09:00:00',
                  primary_chapter: { id: 11, name: '第五节', subject_id: 1, parent_id: 10 },
                  resolved_parent_chapter: { id: 10, name: '第五章 现代教育实验', subject_id: 1, parent_id: null },
                },
              ],
            },
          ],
          ungrouped_palaces: [],
        },
      ],
    })

    render(<DashboardPage />)

    expect(await screen.findByText('今日学习')).toBeTruthy()
    expect(screen.getByText('英语练习')).toBeTruthy()
    expect(screen.getByText('宫殿编辑')).toBeTruthy()
    expect(screen.getByText('练习')).toBeTruthy()
    expect(screen.getByText('复习')).toBeTruthy()
    expect(screen.getAllByText('第五节 陈鹤琴的“活教育”探索').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1小时 0分').length).toBeGreaterThan(0)
    expect(screen.getByText('新增章节数量：2')).toBeTruthy()
    expect(screen.getByText('第五章 现代教育实验')).toBeTruthy()
    expect(screen.queryByText('第五节')).toBeNull()
    expect(screen.getByText('总时长')).toBeTruthy()
    expect(screen.getByText('4小时 0分')).toBeTruthy()
    expect(screen.getByText('本周时长')).toBeTruthy()
    expect(screen.getByDisplayValue(/\d{4}-\d{2}/)).toBeTruthy()
  })

  it('renders dashboard triage counts and review link gating', async () => {
    getDashboardApi.mockResolvedValue({
      due_count: 2,
      due_later_today_count: 1,
      needs_practice_count: 4,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 5400,
      monthly_total_review_duration_seconds: 14400,
      selected_total_review_duration_seconds: 14400,
      weekly_total_review_duration_seconds: 7200,
      weekly_formal_review_duration_seconds: 3600,
      recent_palaces: [],
      today_learning_palaces: [],
      today_new_palace_count: 0,
      today_new_palaces: [],
    })

    render(<DashboardPage />)

    expect(await screen.findByText('今日待处理')).toBeTruthy()
    expect(screen.getByText('立即复习')).toBeTruthy()
    expect(screen.getByText('今日稍后')).toBeTruthy()
    expect(screen.getByText('要练习')).toBeTruthy()
    expect(screen.getByRole('link', { name: /开始复习/i })).toBeTruthy()
  })

  it('shows learning tooltip immediately on hover', async () => {
    getDashboardApi.mockResolvedValue({
      due_count: 0,
      due_later_today_count: 0,
      needs_practice_count: 0,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 3600,
      monthly_total_review_duration_seconds: 5400,
      selected_total_review_duration_seconds: 5400,
      weekly_total_review_duration_seconds: 3600,
      weekly_formal_review_duration_seconds: 1200,
      recent_palaces: [],
      today_learning_palaces: [
        {
          palace_id: 8,
          palace_title: '第四节 梁漱溟的乡村教育建设',
          total_seconds: 1800,
          review_seconds: 600,
          practice_seconds: 300,
          palace_edit_seconds: 900,
        },
      ],
      today_new_palace_count: 0,
      today_new_palaces: [],
    })

    render(<DashboardPage />)

    const progressBar = await screen.findByRole('img', { name: '第四节 梁漱溟的乡村教育建设 学习时长结构' })
    fireEvent.mouseEnter(progressBar)

    expect(screen.getByText('总时长：30分 0秒')).toBeTruthy()
    expect(screen.getByText('宫殿编辑：15分 0秒')).toBeTruthy()
    expect(screen.getByText('练习：5分 0秒')).toBeTruthy()
    expect(screen.getByText('复习：10分 0秒')).toBeTruthy()
  })

  it('renders empty states for both middle cards', async () => {
    getDashboardApi.mockResolvedValue({
      due_count: 0,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 0,
      monthly_total_review_duration_seconds: 0,
      selected_total_review_duration_seconds: 0,
      weekly_total_review_duration_seconds: 0,
      weekly_formal_review_duration_seconds: 0,
      recent_palaces: [],
      today_learning_palaces: [],
      today_new_palace_count: 0,
      today_new_palaces: [],
    })

    render(<DashboardPage />)

    expect(await screen.findByText('今天还没有产生学习时长记录。')).toBeTruthy()
    expect(screen.getByText('今天还没有新增记忆宫殿。')).toBeTruthy()
  })

  it('uses current month by default and does not request selected duration again without persisted filters', async () => {
    getDashboardApi.mockResolvedValue({
      due_count: 0,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 1200,
      monthly_total_review_duration_seconds: 7200,
      selected_total_review_duration_seconds: 7200,
      weekly_total_review_duration_seconds: 3600,
      weekly_formal_review_duration_seconds: 1800,
      recent_palaces: [],
      today_learning_palaces: [],
      today_new_palace_count: 0,
      today_new_palaces: [],
    })

    render(<DashboardPage />)

    expect(await screen.findByLabelText('选择月份')).toBeTruthy()
    await waitFor(() => {
      expect(getDashboardApi).toHaveBeenCalledTimes(1)
    })
    expect(getDashboardApi).toHaveBeenCalledWith()
  })

  it('restores persisted month filter on reopen', async () => {
    window.localStorage.setItem(
      'memory_anki_dashboard_total_duration_filter',
      JSON.stringify({
        mode: 'month',
        month: '2026-05',
        startDate: '',
        endDate: '',
      }),
    )

    getDashboardApi.mockImplementation(async (query?: { duration_mode?: string; month?: string }) => {
      if (query?.duration_mode === 'month' && query.month === '2026-05') {
        return {
          due_count: 0,
          reviews: [],
          stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
          today_review_duration_seconds: 0,
          weekly_review_duration_seconds: 0,
          today_total_review_duration_seconds: 1200,
          monthly_total_review_duration_seconds: 7200,
          selected_total_review_duration_seconds: 3600,
          weekly_total_review_duration_seconds: 3600,
          weekly_formal_review_duration_seconds: 1800,
          recent_palaces: [],
          today_learning_palaces: [],
          today_new_palace_count: 0,
          today_new_palaces: [],
        }
      }
      return {
        due_count: 0,
        reviews: [],
        stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
        today_review_duration_seconds: 0,
        weekly_review_duration_seconds: 0,
        today_total_review_duration_seconds: 1200,
        monthly_total_review_duration_seconds: 7200,
        selected_total_review_duration_seconds: 7200,
        weekly_total_review_duration_seconds: 3600,
        weekly_formal_review_duration_seconds: 1800,
        recent_palaces: [],
        today_learning_palaces: [],
        today_new_palace_count: 0,
        today_new_palaces: [],
      }
    })

    render(<DashboardPage />)

    await waitFor(() => {
      expect(getDashboardApi).toHaveBeenCalledWith({
        duration_mode: 'month',
        month: '2026-05',
      })
    })
    expect((screen.getByLabelText('选择月份') as HTMLInputElement).value).toBe('2026-05')
    expect(screen.getByText('2026-05')).toBeTruthy()
  })

  it('restores persisted custom range filter on reopen', async () => {
    window.localStorage.setItem(
      'memory_anki_dashboard_total_duration_filter',
      JSON.stringify({
        mode: 'range',
        month: '2026-06',
        startDate: '2026-06-01',
        endDate: '2026-06-15',
      }),
    )

    getDashboardApi.mockImplementation(async (query?: { duration_mode?: string; start_date?: string; end_date?: string }) => {
      if (query?.duration_mode === 'range' && query.start_date === '2026-06-01' && query.end_date === '2026-06-15') {
        return {
          due_count: 0,
          reviews: [],
          stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
          today_review_duration_seconds: 0,
          weekly_review_duration_seconds: 0,
          today_total_review_duration_seconds: 1200,
          monthly_total_review_duration_seconds: 7200,
          selected_total_review_duration_seconds: 1800,
          weekly_total_review_duration_seconds: 3600,
          weekly_formal_review_duration_seconds: 1800,
          recent_palaces: [],
          today_learning_palaces: [],
          today_new_palace_count: 0,
          today_new_palaces: [],
        }
      }
      return {
        due_count: 0,
        reviews: [],
        stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
        today_review_duration_seconds: 0,
        weekly_review_duration_seconds: 0,
        today_total_review_duration_seconds: 1200,
        monthly_total_review_duration_seconds: 7200,
        selected_total_review_duration_seconds: 7200,
        weekly_total_review_duration_seconds: 3600,
        weekly_formal_review_duration_seconds: 1800,
        recent_palaces: [],
        today_learning_palaces: [],
        today_new_palace_count: 0,
        today_new_palaces: [],
      }
    })

    render(<DashboardPage />)

    await waitFor(() => {
      expect(getDashboardApi).toHaveBeenCalledWith({
        duration_mode: 'range',
        start_date: '2026-06-01',
        end_date: '2026-06-15',
      })
    })
    expect((screen.getByLabelText('开始日期') as HTMLInputElement).value).toBe('2026-06-01')
    expect((screen.getByLabelText('结束日期') as HTMLInputElement).value).toBe('2026-06-15')
    expect(screen.getByText('2026-06-01 至 2026-06-15')).toBeTruthy()
  })

  it('restores persisted all filter on reopen and hides date inputs', async () => {
    window.localStorage.setItem(
      'memory_anki_dashboard_total_duration_filter',
      JSON.stringify({
        mode: 'all',
        month: '2026-06',
        startDate: '2026-06-01',
        endDate: '2026-06-15',
      }),
    )

    getDashboardApi.mockImplementation(async (query?: { duration_mode?: string }) => {
      if (query?.duration_mode === 'all') {
        return {
          due_count: 0,
          reviews: [],
          stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
          today_review_duration_seconds: 0,
          weekly_review_duration_seconds: 0,
          today_total_review_duration_seconds: 1200,
          monthly_total_review_duration_seconds: 7200,
          selected_total_review_duration_seconds: 9600,
          weekly_total_review_duration_seconds: 3600,
          weekly_formal_review_duration_seconds: 1800,
          recent_palaces: [],
          today_learning_palaces: [],
          today_new_palace_count: 0,
          today_new_palaces: [],
        }
      }
      return {
        due_count: 0,
        reviews: [],
        stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
        today_review_duration_seconds: 0,
        weekly_review_duration_seconds: 0,
        today_total_review_duration_seconds: 1200,
        monthly_total_review_duration_seconds: 7200,
        selected_total_review_duration_seconds: 7200,
        weekly_total_review_duration_seconds: 3600,
        weekly_formal_review_duration_seconds: 1800,
        recent_palaces: [],
        today_learning_palaces: [],
        today_new_palace_count: 0,
        today_new_palaces: [],
      }
    })

    render(<DashboardPage />)

    await waitFor(() => {
      expect(getDashboardApi).toHaveBeenCalledWith({
        duration_mode: 'all',
      })
    })
    expect(screen.getByText('全部')).toBeTruthy()
    expect(screen.queryByLabelText('选择月份')).toBeNull()
    expect(screen.queryByLabelText('开始日期')).toBeNull()
    expect(screen.queryByLabelText('结束日期')).toBeNull()
  })

  it('falls back to default current month when persisted filter is invalid', async () => {
    window.localStorage.setItem('memory_anki_dashboard_total_duration_filter', '{"mode":"weekly","month":5}')

    getDashboardApi.mockResolvedValue({
      due_count: 0,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 1200,
      monthly_total_review_duration_seconds: 7200,
      selected_total_review_duration_seconds: 7200,
      weekly_total_review_duration_seconds: 3600,
      weekly_formal_review_duration_seconds: 1800,
      recent_palaces: [],
      today_learning_palaces: [],
      today_new_palace_count: 0,
      today_new_palaces: [],
    })

    render(<DashboardPage />)

    const monthInput = await screen.findByLabelText('选择月份')
    expect((monthInput as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}$/)
    await waitFor(() => {
      expect(getDashboardApi).toHaveBeenCalledTimes(1)
    })
  })

  it('requests selected total duration for a different month', async () => {
    getDashboardApi.mockImplementation(async (query?: { duration_mode?: string; month?: string }) => {
      if (query?.duration_mode === 'month' && query.month === '2026-05') {
        return {
          due_count: 1,
          reviews: [],
          stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
          today_review_duration_seconds: 0,
          weekly_review_duration_seconds: 0,
          today_total_review_duration_seconds: 1200,
          monthly_total_review_duration_seconds: 7200,
          selected_total_review_duration_seconds: 3600,
          weekly_total_review_duration_seconds: 3600,
          weekly_formal_review_duration_seconds: 1800,
          recent_palaces: [],
          today_learning_palaces: [],
          today_new_palace_count: 0,
          today_new_palaces: [],
        }
      }
      return {
        due_count: 1,
        reviews: [],
        stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
        today_review_duration_seconds: 0,
        weekly_review_duration_seconds: 0,
        today_total_review_duration_seconds: 1200,
        monthly_total_review_duration_seconds: 7200,
        selected_total_review_duration_seconds: 7200,
        weekly_total_review_duration_seconds: 3600,
        weekly_formal_review_duration_seconds: 1800,
        recent_palaces: [],
        today_learning_palaces: [],
        today_new_palace_count: 0,
        today_new_palaces: [],
      }
    })

    render(<DashboardPage />)

    const monthInput = await screen.findByLabelText('选择月份')
    fireEvent.change(monthInput, { target: { value: '2026-05' } })

    await waitFor(() => {
      expect(getDashboardApi).toHaveBeenCalledWith({
        duration_mode: 'month',
        month: '2026-05',
      })
    })
    expect(screen.getByText('2026-05')).toBeTruthy()
    expect(screen.getByLabelText('选择月份')).toBeTruthy()
  })

  it('requests selected total duration for a custom range', async () => {
    getDashboardApi.mockImplementation(async (query?: { duration_mode?: string; start_date?: string; end_date?: string }) => {
      if (query?.duration_mode === 'range' && query.start_date === '2026-06-01' && query.end_date === '2026-06-15') {
        return {
          due_count: 0,
          reviews: [],
          stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
          today_review_duration_seconds: 0,
          weekly_review_duration_seconds: 0,
          today_total_review_duration_seconds: 1200,
          monthly_total_review_duration_seconds: 7200,
          selected_total_review_duration_seconds: 1800,
          weekly_total_review_duration_seconds: 3600,
          weekly_formal_review_duration_seconds: 1800,
          recent_palaces: [],
          today_learning_palaces: [],
          today_new_palace_count: 0,
          today_new_palaces: [],
        }
      }
      return {
        due_count: 0,
        reviews: [],
        stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
        today_review_duration_seconds: 0,
        weekly_review_duration_seconds: 0,
        today_total_review_duration_seconds: 1200,
        monthly_total_review_duration_seconds: 7200,
        selected_total_review_duration_seconds: 7200,
        weekly_total_review_duration_seconds: 3600,
        weekly_formal_review_duration_seconds: 1800,
        recent_palaces: [],
        today_learning_palaces: [],
        today_new_palace_count: 0,
        today_new_palaces: [],
      }
    })

    render(<DashboardPage />)

    fireEvent.click(await screen.findByRole('button', { name: '自定义范围' }))
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-06-15' } })

    await waitFor(() => {
      expect(getDashboardApi).toHaveBeenCalledWith({
        duration_mode: 'range',
        start_date: '2026-06-01',
        end_date: '2026-06-15',
      })
    })
    expect(await screen.findByText('30分 0秒')).toBeTruthy()
    expect(screen.getByText('2026-06-01 至 2026-06-15')).toBeTruthy()
  })

  it('requests selected total duration for all history and hides filter inputs', async () => {
    getDashboardApi.mockImplementation(
      async (query?: { duration_mode?: string; month?: string; start_date?: string; end_date?: string }) => {
        if (query?.duration_mode === 'all') {
          return {
            due_count: 0,
            reviews: [],
            stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
            today_review_duration_seconds: 0,
            weekly_review_duration_seconds: 0,
            today_total_review_duration_seconds: 1200,
            monthly_total_review_duration_seconds: 7200,
            selected_total_review_duration_seconds: 9600,
            weekly_total_review_duration_seconds: 3600,
            weekly_formal_review_duration_seconds: 1800,
            recent_palaces: [],
            today_learning_palaces: [],
            today_new_palace_count: 0,
            today_new_palaces: [],
          }
        }
        return {
          due_count: 0,
          reviews: [],
          stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
          today_review_duration_seconds: 0,
          weekly_review_duration_seconds: 0,
          today_total_review_duration_seconds: 1200,
          monthly_total_review_duration_seconds: 7200,
          selected_total_review_duration_seconds: 7200,
          weekly_total_review_duration_seconds: 3600,
          weekly_formal_review_duration_seconds: 1800,
          recent_palaces: [],
          today_learning_palaces: [],
          today_new_palace_count: 0,
          today_new_palaces: [],
        }
      },
    )

    render(<DashboardPage />)

    fireEvent.click(await screen.findByRole('button', { name: '显示全部' }))

    await waitFor(() => {
      expect(getDashboardApi).toHaveBeenCalledWith({
        duration_mode: 'all',
      })
    })
    expect(await screen.findByText('2小时 40分')).toBeTruthy()
    expect(screen.getByText('全部')).toBeTruthy()
    expect(screen.queryByLabelText('选择月份')).toBeNull()
    expect(screen.queryByLabelText('开始日期')).toBeNull()
    expect(screen.queryByLabelText('结束日期')).toBeNull()
  })

  it('preserves entered filters when switching back from all mode', async () => {
    getDashboardApi.mockResolvedValue({
      due_count: 0,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 1200,
      monthly_total_review_duration_seconds: 7200,
      selected_total_review_duration_seconds: 7200,
      weekly_total_review_duration_seconds: 3600,
      weekly_formal_review_duration_seconds: 1800,
      recent_palaces: [],
      today_learning_palaces: [],
      today_new_palace_count: 0,
      today_new_palaces: [],
    })

    render(<DashboardPage />)

    const monthInput = await screen.findByLabelText('选择月份')
    fireEvent.change(monthInput, { target: { value: '2026-05' } })
    fireEvent.click(screen.getByRole('button', { name: '自定义范围' }))
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-06-15' } })
    fireEvent.click(screen.getByRole('button', { name: '显示全部' }))

    expect(screen.queryByLabelText('选择月份')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '月份' }))
    expect((screen.getByLabelText('选择月份') as HTMLInputElement).value).toBe('2026-05')

    fireEvent.click(screen.getByRole('button', { name: '自定义范围' }))
    expect((screen.getByLabelText('开始日期') as HTMLInputElement).value).toBe('2026-06-01')
    expect((screen.getByLabelText('结束日期') as HTMLInputElement).value).toBe('2026-06-15')
    await waitFor(() => {
      expect(getDashboardApi.mock.calls.length).toBeGreaterThan(1)
    })
  })

  it('does not request custom range duration when dates are invalid', async () => {
    getDashboardApi.mockResolvedValue({
      due_count: 0,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 1200,
      monthly_total_review_duration_seconds: 7200,
      selected_total_review_duration_seconds: 7200,
      weekly_total_review_duration_seconds: 3600,
      weekly_formal_review_duration_seconds: 1800,
      recent_palaces: [],
      today_learning_palaces: [],
      today_new_palace_count: 0,
      today_new_palaces: [],
    })

    render(<DashboardPage />)

    expect(await screen.findByRole('button', { name: '显示全部' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: '自定义范围' }))
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-06-20' } })
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-06-10' } })

    expect(screen.getByText('开始日期不能晚于结束日期。')).toBeTruthy()
    expect(getDashboardApi).toHaveBeenCalledTimes(1)
  })
})
