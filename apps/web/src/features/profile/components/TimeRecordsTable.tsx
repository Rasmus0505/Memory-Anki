import { Pencil, Plus, Trash2, Undo2 } from 'lucide-react'
import {
  formatCompletionMethod,
  formatDuration,
  formatSessionKind,
  type SessionKind,
  type TimeSessionRecord,
} from '@/entities/session/model'
import {
  formatTableDateTime,
  formatTableDate,
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
  showDeleted: boolean
  onShowDeletedChange: (value: boolean) => void
  onCreateRecord: () => void
  onBulkDelete: () => void | Promise<void>
  bulkDeleteDisabled: boolean
  isBulkDeleting: boolean
  deletingRecordId: string | null
  restoringRecordId: string | null
  visibleRecords: TimeSessionRecord[]
  hasSelectableRecords: boolean
  allSelectableChecked: boolean
  selectedRecordIds: string[]
  onToggleSelectAllVisible: (checked: boolean) => void
  onToggleRecordSelection: (recordId: string, checked: boolean) => void
  onEditRecord: (record: TimeSessionRecord) => void
  onDeleteRecord: (record: TimeSessionRecord) => void | Promise<void>
  onRestoreRecord: (record: TimeSessionRecord) => void | Promise<void>
}

export function TimeRecordsTable({
  thresholdInput,
  onThresholdInputChange,
  onThresholdBlur,
  showBelowThreshold,
  onShowBelowThresholdChange,
  keyword,
  onKeywordChange,
  kindFilter,
  onKindFilterChange,
  showDeleted,
  onShowDeletedChange,
  onCreateRecord,
  onBulkDelete,
  bulkDeleteDisabled,
  isBulkDeleting,
  deletingRecordId,
  restoringRecordId,
  visibleRecords,
  hasSelectableRecords,
  allSelectableChecked,
  selectedRecordIds,
  onToggleSelectAllVisible,
  onToggleRecordSelection,
  onEditRecord,
  onDeleteRecord,
  onRestoreRecord,
}: TimeRecordsTableProps) {
  const actionInProgress =
    isBulkDeleting || deletingRecordId !== null || restoringRecordId !== null

  return (
    <Card className="rounded-[28px] border-border/70">
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-lg">时间记录列表</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm">
              <span className="text-muted-foreground">记录阈值</span>
              <Input
                aria-label="记录阈值（秒）"
                className="h-8 w-24 border-0 px-0 shadow-none focus-visible:ring-0"
                type="number"
                min="0"
                value={thresholdInput}
                onChange={(event) => onThresholdInputChange(event.target.value)}
                onBlur={onThresholdBlur}
              />
              <span className="text-muted-foreground">秒</span>
            </label>
            <Button
              variant="outline"
              size="sm"
              className="active:scale-[0.98]"
              onClick={onCreateRecord}
              disabled={actionInProgress}
            >
              <Plus className="mr-2 h-4 w-4" />
              手动新增记录
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="active:scale-[0.98]"
              onClick={onBulkDelete}
              disabled={bulkDeleteDisabled || isBulkDeleting}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {isBulkDeleting ? '删除中...' : '批量删除所选'}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
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
            <option value="all">全部类型</option>
            {sessionKindOptions.map((kind) => (
              <option key={kind} value={kind}>
                {formatSessionKind(kind)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={showBelowThreshold}
              onChange={(event) =>
                onShowBelowThresholdChange(event.target.checked)
              }
            />
            显示低于阈值记录
          </label>
          <label className="flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(event) => onShowDeletedChange(event.target.checked)}
            />
            显示已删除
          </label>
        </div>
      </CardHeader>

      <CardContent>
        {visibleRecords.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-border/80 py-10 text-center text-sm text-muted-foreground">
            还没有可展示的时间记录。
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[24px] border border-border/70">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-slate-50/80 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
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
                  <th className="px-4 py-3">类型</th>
                  <th className="px-4 py-3">开始时间</th>
                  <th className="px-4 py-3">有效时长</th>
                  <th className="px-4 py-3">完成方式</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/80 bg-white">
                {visibleRecords.map((record) => {
                  const isDeleting = deletingRecordId === record.id
                  const isRestoring = restoringRecordId === record.id

                  return (
                    <tr
                      key={record.id}
                      className={`transition-colors hover:bg-slate-50/80 active:bg-slate-100/70 ${
                        record.deletedAt
                          ? 'bg-slate-50/70 text-muted-foreground'
                          : ''
                      }`}
                    >
                      <td className="px-4 py-4 align-top">
                        {!record.deletedAt ? (
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
                        ) : null}
                      </td>
                      <td className="px-4 py-4">
                        <div className="min-w-[220px]">
                          <div
                            className={`font-medium ${
                              record.deletedAt
                                ? 'line-through'
                                : 'text-slate-950'
                            }`}
                          >
                            {record.title}
                          </div>
                          {record.deletedAt ? (
                            <div className="mt-1 text-xs">
                              已删除，时间 {formatTableDate(record.deletedAt)}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {formatSessionKind(record.kind)}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        {formatTableDateTime(record.startedAt)}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap font-medium text-slate-950">
                        {formatDuration(record.effectiveSeconds)}
                      </td>
                      <td className="px-4 py-4">
                        {formatCompletionMethod(record.completionMethod)}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          {!record.deletedAt ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="active:scale-[0.98]"
                                onClick={() => onEditRecord(record)}
                                disabled={actionInProgress}
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                编辑
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="active:scale-[0.98]"
                                onClick={() => void onDeleteRecord(record)}
                                disabled={actionInProgress}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                {isDeleting ? '删除中...' : '删除'}
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="active:scale-[0.98]"
                              onClick={() => void onRestoreRecord(record)}
                              disabled={actionInProgress}
                            >
                              <Undo2 className="mr-2 h-4 w-4" />
                              {isRestoring ? '恢复中...' : '恢复'}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
