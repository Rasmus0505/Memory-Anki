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
    const monthButton = screen.getByRole('button', { name: '月份' })
    expect(todayButton.compareDocumentPosition(monthButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(todayButton)
    expect(props.onRangeModeChange).toHaveBeenCalledWith('today')
  })
})
