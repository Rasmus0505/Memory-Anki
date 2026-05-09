import { TimeRecordDialog } from '@/features/profile/components/TimeRecordDialog'
import { TimeRecordsBreakdownChart } from '@/features/profile/components/TimeRecordsBreakdownChart'
import { TimeRecordsSummaryCards } from '@/features/profile/components/TimeRecordsSummaryCards'
import { TimeRecordsTable } from '@/features/profile/components/TimeRecordsTable'
import { TimeRecordsTrendChart } from '@/features/profile/components/TimeRecordsTrendChart'
import { useTimeRecordsDashboard } from '@/features/profile/hooks/useTimeRecordsDashboard'
import { ProfileNav } from '@/features/profile/ProfileNav'

export default function ProfileTimeRecordsPage() {
  const dashboard = useTimeRecordsDashboard()

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <TimeRecordsSummaryCards summary={dashboard.summary} />
        <ProfileNav />
      </div>

      <div className="space-y-6">
        <TimeRecordsTrendChart trend={dashboard.trend} />
        <TimeRecordsBreakdownChart breakdown={dashboard.breakdown} />
        <TimeRecordsTable
          thresholdInput={dashboard.thresholdInput}
          onThresholdInputChange={dashboard.setThresholdInput}
          onThresholdBlur={() => void dashboard.applyThreshold()}
          keyword={dashboard.keyword}
          onKeywordChange={dashboard.setKeyword}
          kindFilter={dashboard.kindFilter}
          onKindFilterChange={dashboard.setKindFilter}
          showDeleted={dashboard.showDeleted}
          onShowDeletedChange={dashboard.setShowDeleted}
          onCreateRecord={dashboard.openCreateDialog}
          onBulkDelete={() => void dashboard.handleBulkDelete()}
          bulkDeleteDisabled={!dashboard.hasSelectedRecords}
          visibleRecords={dashboard.visibleRecords}
          hasSelectableRecords={dashboard.hasSelectableRecords}
          allSelectableChecked={dashboard.allSelectableChecked}
          selectedRecordIds={dashboard.selectedRecordIds}
          onToggleSelectAllVisible={dashboard.toggleSelectAllVisible}
          onToggleRecordSelection={dashboard.toggleRecordSelection}
          onEditRecord={dashboard.openEditDialog}
          onDeleteRecord={dashboard.handleDeleteRecord}
          onRestoreRecord={dashboard.handleRestoreRecord}
        />
      </div>

      <TimeRecordDialog
        open={dashboard.dialogOpen}
        mode={dashboard.dialogMode}
        form={dashboard.formState}
        error={dashboard.formError}
        onOpenChange={dashboard.onDialogOpenChange}
        onChange={dashboard.onFormChange}
        onSubmit={(event) => void dashboard.handleSubmitRecord(event)}
      />
    </div>
  )
}
