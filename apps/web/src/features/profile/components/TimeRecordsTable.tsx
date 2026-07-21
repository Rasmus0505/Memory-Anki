import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  formatClientSource,
  formatCompletionMethod,
  formatDuration,
  formatSessionKind,
  formatSessionSource,
  formatTimeRecordTagLabel,
  type SessionKind,
  type TimeRecordSortBy,
  type TimeRecordSortOrder,
  type TimeSessionRecord,
} from '@/entities/session/model'
import {
  formatTableDateTime,
  sessionKindOptions,
} from '@/features/profile/model/time-record-form'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Pagination } from '@/shared/components/ui/pagination'
import { EmptyState } from '@/shared/components/state-placeholders'

interface TimeRecordsTableProps {
  thresholdInput: string
  onThresholdInputChange: (value: string) => void
  onThresholdBlur: () => void | Promise<void>
  showBelowThreshold: boolean
  onShowBelowThresholdChange: (value: boolean) => void
  keyword: string
  onKeywordChange: (value: string) => void
  kindFilter: 'all' | SessionKind
  onKindFilterChange: (value: 'all' | SessionKind) => void
  sortBy: TimeRecordSortBy
  onSortByChange: (value: TimeRecordSortBy) => void
  sortOrder: TimeRecordSortOrder
  onSortOrderChange: (value: TimeRecordSortOrder) => void
  page: number
  pageSize: number
  totalRecords: number
  totalPages: number
  onPageChange: (value: number) => void
  onPageSizeChange: (value: number) => void
  isLoadingRecords: boolean
  recordsError: string | null
  showDeleted: boolean
  onShowDeletedChange: (value: boolean) => void
  onCreateRecord: () => void
  onBulkDelete: () => void | Promise<void>
  bulkDeleteDisabled: boolean
  isBulkDeleting: boolean
  deletingRecordId: string | null
  visibleRecords: TimeSessionRecord[]
  pendingRecoveryRecords: []
  hasSelectableRecords: boolean
  allSelectableChecked: boolean
  selectedRecordIds: string[]
  onToggleSelectAllVisible: (checked: boolean) => void
  onToggleRecordSelection: (recordId: string, checked: boolean) => void
  onEditRecord: (record: TimeSessionRecord) => void
  onDeleteRecord: (record: TimeSessionRecord) => void | Promise<void>
  onReplayPendingRecovery: (recordId: string) => void | Promise<void>
  onDismissPendingRecovery: (recordId: string) => void
}

export function TimeRecordsTable({
  keyword,
  onKeywordChange,
  kindFilter,
  onKindFilterChange,
  sortBy,
  onSortByChange,
  sortOrder,
  onSortOrderChange,
  page,
  pageSize,
  totalRecords,
  totalPages,
  onPageChange,
  onPageSizeChange,
  isLoadingRecords,
  recordsError,
  onCreateRecord,
  onBulkDelete,
  bulkDeleteDisabled,
  isBulkDeleting,
  deletingRecordId,
  visibleRecords,
  hasSelectableRecords,
  allSelectableChecked,
  selectedRecordIds,
  onToggleSelectAllVisible,
  onToggleRecordSelection,
  onEditRecord,
  onDeleteRecord,
}: TimeRecordsTableProps) {
  const actionInProgress = isBulkDeleting || deletingRecordId !== null
  const visibleStart = totalRecords === 0 ? 0 : (page - 1) * pageSize + 1
  const visibleEnd = Math.min(page * pageSize, totalRecords)

  return (
    <Card className="rounded-lg border-border/70">
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-lg">时间记录列表</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="active:scale-[0.98]"
              onClick={onCreateRecord}
              disabled={actionInProgress}
            >
              <Plus className="mr-2 size-4" />
              快速记一笔
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="active:scale-[0.98]"
              onClick={onBulkDelete}
              disabled={bulkDeleteDisabled || isBulkDeleting}
            >
              <Trash2 className="mr-2 size-4" />
              {isBulkDeleting ? '删除中...' : '批量删除所选'}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_180px_180px_140px]">
          <Input
            placeholder="搜索标题"
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
          />
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={kindFilter}
            onChange={(event) =>
              onKindFilterChange(event.target.value as 'all' | SessionKind)
            }
          >
            <option value="all">全部标签</option>
            {sessionKindOptions.map((kind) => (
              <option key={kind} value={kind}>
                {formatSessionKind(kind)}
              </option>
            ))}
          </select>
          <select
            aria-label="排序字段"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={sortBy}
            onChange={(event) =>
              onSortByChange(event.target.value as TimeRecordSortBy)
            }
          >
            <option value="started_at">按开始时间</option>
            <option value="effective_seconds">按有效时长</option>
            <option value="title">按标题</option>
          </select>
          <select
            aria-label="排序方向"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={sortOrder}
            onChange={(event) =>
              onSortOrderChange(event.target.value as TimeRecordSortOrder)
            }
          >
            <option value="desc">降序</option>
            <option value="asc">升序</option>
          </select>
        </div>
      </CardHeader>

      <CardContent>
        {recordsError ? (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {recordsError}
          </div>
        ) : null}
        {visibleRecords.length === 0 && !isLoadingRecords ? (
          <EmptyState
            variant={keyword || kindFilter !== 'all' ? 'search' : 'create'}
            title={keyword || kindFilter !== 'all' ? '没有匹配的学习记录' : '还没有学习记录'}
            description={
              keyword || kindFilter !== 'all'
                ? '换个关键词或切回全部类型，看看是否有被筛选掉的记录。'
                : '开始一次学习、复习或手动新增一条记录后，这里会显示有效学习时长。'
            }
            action={
              keyword || kindFilter !== 'all' ? null : (
                <Button variant="outline" size="sm" onClick={onCreateRecord}>
                  <Plus className="mr-2 size-4" />
                  快速记一笔
                </Button>
              )
            }
          />
        ) : (
          <div
            className={`overflow-x-auto rounded-[24px] border border-border/70 transition-opacity ${
              isLoadingRecords ? 'opacity-60' : ''
            }`}
            aria-busy={isLoadingRecords}
          >
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted/80 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      aria-label="全选当前记录"
                      type="checkbox"
                      checked={allSelectableChecked}
                      onChange={(event) =>
                        onToggleSelectAllVisible(event.target.checked)
                      }
                      disabled={!hasSelectableRecords || isBulkDeleting}
                    />
                  </th>
                  <th className="px-4 py-3">标题</th>
                  <th className="px-4 py-3">标签</th>
                  <th className="px-4 py-3">端来源</th>
                  <th className="px-4 py-3">开始时间</th>
                  <th className="px-4 py-3">有效时长</th>
                  <th className="px-4 py-3">完成方式</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/80 bg-background">
                {visibleRecords.map((record) => {
                  const isDeleting = deletingRecordId === record.id
                  return (
                    <tr
                      key={record.id}
                      className={`transition-colors hover:bg-muted/80 active:bg-muted ${
                        ''
                      }`}
                    >
                      <td className="px-4 py-4 align-top">
                        <input
                          aria-label={`选择记录 ${record.title}`}
                          type="checkbox"
                          checked={selectedRecordIds.includes(record.id)}
                          disabled={isBulkDeleting || isDeleting}
                          onChange={(event) =>
                            onToggleRecordSelection(
                              record.id,
                              event.target.checked,
                            )
                          }
                        />
                      </td>
                      <td className="px-4 py-4">
                        <div className="min-w-[220px]">
                          <div className="font-medium text-foreground">
                            {record.title}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            来源：{formatSessionSource(record)}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {formatTimeRecordTagLabel(record)}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <span className="rounded-md border border-border/70 bg-secondary/70 px-2 py-1 text-xs text-foreground">
                          {formatClientSource(record.clientSource)}
                        </span>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        {formatTableDateTime(record.startedAt)}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap font-medium text-foreground">
                        {formatDuration(record.effectiveSeconds)}
                      </td>
                      <td className="px-4 py-4">
                        {formatCompletionMethod(record.completionMethod)}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="active:scale-[0.98]"
                            onClick={() => onEditRecord(record)}
                            disabled={actionInProgress}
                          >
                            <Pencil className="mr-2 size-4" />
                            编辑
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="active:scale-[0.98]"
                            onClick={() => void onDeleteRecord(record)}
                            disabled={actionInProgress}
                          >
                            <Trash2 className="mr-2 size-4" />
                            {isDeleting ? '删除中...' : '删除'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex flex-col gap-3 border-t border-border/70 pt-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>
              共 {totalRecords} 条，当前显示 {visibleStart}-{visibleEnd}
            </span>
            <label className="flex items-center gap-2">
              每页
              <select
                aria-label="每页条数"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                value={pageSize}
                disabled={isLoadingRecords}
                onChange={(event) => onPageSizeChange(Number(event.target.value))}
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              条
            </label>
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
            disabled={isLoadingRecords || actionInProgress}
          />
        </div>
      </CardContent>
    </Card>
  )
}
