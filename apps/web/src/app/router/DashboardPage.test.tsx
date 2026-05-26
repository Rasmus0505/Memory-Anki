import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from '@/app/router/DashboardPage'

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

const getDashboardApi = vi.fn()

vi.mock('@/shared/api/modules/dashboard', () => ({
  getDashboardApi: () => getDashboardApi(),
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
  })

  it('renders learning breakdown and today new palace hierarchy', async () => {
    getDashboardApi.mockResolvedValue({
      due_count: 2,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 5400,
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
    expect(screen.getByText('宫殿编辑')).toBeTruthy()
    expect(screen.getByText('练习')).toBeTruthy()
    expect(screen.getByText('复习')).toBeTruthy()
    expect(screen.getAllByText('第五节 陈鹤琴的“活教育”探索').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1小时 0分').length).toBeGreaterThan(0)
    expect(screen.getByText('新增章节数量：2')).toBeTruthy()
    expect(screen.getByText('第五章 现代教育实验')).toBeTruthy()
    expect(screen.queryByText('第五节')).toBeNull()
  })

  it('shows learning tooltip immediately on hover', async () => {
    getDashboardApi.mockResolvedValue({
      due_count: 0,
      reviews: [],
      stats: { total: 0, review_count: 0, review_duration_seconds: 0 },
      today_review_duration_seconds: 0,
      weekly_review_duration_seconds: 0,
      today_total_review_duration_seconds: 3600,
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
})
