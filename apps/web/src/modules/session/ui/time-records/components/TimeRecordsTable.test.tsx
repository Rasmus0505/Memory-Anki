import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TimeRecordsTable } from './TimeRecordsTable'
import { createDefaultTimeRecordFilter } from '@/modules/session/ui/time-records/model/time-record-filter'

function buildProps() {
  return {
    filter: { ...createDefaultTimeRecordFilter(), rangeMode: 'month' as const },
    onRangeModeChange: vi.fn(),
    onMonthChange: vi.fn(),
    onRollingDaysChange: vi.fn(),
    onStartDateChange: vi.fn(),
    onEndDateChange: vi.fn(),
    keyword: '',
    onKeywordChange: vi.fn(),
    kindFilter: 'all' as const,
    onKindFilterChange: vi.fn(),
    sortBy: 'started_at' as const,
    onSortByChange: vi.fn(),
    sortOrder: 'desc' as const,
    onSortOrderChange: vi.fn(),
    sourceSummary: {
      totalEffectiveSeconds: 0,
      desktopEffectiveSeconds: 0,
      pwaEffectiveSeconds: 0,
      unknownEffectiveSeconds: 0,
    },
    page: 1,
    pageSize: 20,
    totalRecords: 0,
    totalPages: 1,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    isLoadingRecords: false,
    recordsError: null,
    onCreateRecord: vi.fn(),
    onBulkDelete: vi.fn(),
    bulkDeleteDisabled: true,
    isBulkDeleting: false,
    deletingRecordId: null,
    visibleRecords: [],
    hasSelectableRecords: false,
    allSelectableChecked: false,
    selectedRecordIds: [],
    onToggleSelectAllVisible: vi.fn(),
    onToggleRecordSelection: vi.fn(),
    onEditRecord: vi.fn(),
    onDeleteRecord: vi.fn(),
  }
}

describe('TimeRecordsTable range controls', () => {
  it('puts today first and selects it when clicked', () => {
    const props = buildProps()
    render(<TimeRecordsTable {...props} />)

    const todayButton = screen.getByRole('button', { name: '今天' })
    const yesterdayButton = screen.getByRole('button', { name: '昨天' })
    const monthButton = screen.getByRole('button', { name: '月份' })
    expect(todayButton.compareDocumentPosition(yesterdayButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(yesterdayButton.compareDocumentPosition(monthButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(todayButton)
    expect(props.onRangeModeChange).toHaveBeenCalledWith('today')
    fireEvent.click(yesterdayButton)
    expect(props.onRangeModeChange).toHaveBeenCalledWith('yesterday')
  })

  it('labels an in-progress dwell checkpoint as 进行中', () => {
    const props = buildProps()
    render(<TimeRecordsTable {...props} totalRecords={1} hasSelectableRecords visibleRecords={[{
      id: 'dwell-live',
      kind: 'quiz',
      palaceId: null,
      title: '09:12 学习时段',
      startedAt: '2026-09-22T01:12:00.000Z',
      endedAt: '2026-09-22T01:12:00.000Z',
      effectiveSeconds: 90,
      pauseCount: 0,
      completionMethod: 'saved',
      status: 'active',
      durationEdited: false,
      events: [],
    }]} />)

    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.queryByText('保存结束')).toBeNull()
  })
})
