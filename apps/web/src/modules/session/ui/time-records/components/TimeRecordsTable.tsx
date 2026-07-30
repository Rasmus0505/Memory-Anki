import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  formatClientSource,
  formatCompletionMethod,
  formatDuration,
  formatSessionSource,
  formatTimeRecordTagLabel,
  type TimeRecordSourceSummary,
  type TimeSessionRecord,
} from '@/modules/session/domain/session-entity/model'
import type { TimeRecordKind } from '@/modules/session/domain/study-session-entity/api'
import type { TimeRecordFilterState } from '@/modules/session/ui/time-records/model/time-record-filter'
import { formatTableDateTime } from '@/modules/session/ui/time-records/model/time-record-form'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Pagination } from '@/shared/components/ui/pagination'
import { EmptyState } from '@/shared/components/state-placeholders'

const KIND_OPTIONS: Array<{ value: 'all' | TimeRecordKind; label: string }> = [
  { value: 'all', label: '全部标签' },
  { value: 'review', label: '复习' },
  { value: 'practice', label: '练习' },
  { value: 'quiz', label: '做题' },
  { value: 'palace_edit', label: '宫殿编辑' },
  { value: 'english', label: '英语' },
  { value: 'english_reading', label: '英语阅读' },
  { value: 'custom', label: '自定义标签' },
]

interface TimeRecordsTableProps {
  filter: TimeRecordFilterState
  onRangeModeChange: (value: TimeRecordFilterState['rangeMode']) => void
  onMonthChange: (value: string) => void
  onRollingDaysChange: (value: 7 | 30 | 90) => void
  onStartDateChange: (value: string) => void
  onEndDateChange: (value: string) => void
  keyword: string
  onKeywordChange: (value: string) => void
  kindFilter: 'all' | TimeRecordKind
  onKindFilterChange: (value: 'all' | TimeRecordKind) => void
  sortBy: TimeRecordFilterState['sortBy']
  onSortByChange: (value: TimeRecordFilterState['sortBy']) => void
  sortOrder: TimeRecordFilterState['sortOrder']
  onSortOrderChange: (value: TimeRecordFilterState['sortOrder']) => void
  sourceSummary: TimeRecordSourceSummary
  page: number
  pageSize: number
  totalRecords: number
  totalPages: number
  onPageChange: (value: number) => void
  onPageSizeChange: (value: number) => void
  isLoadingRecords: boolean
  recordsError: string | null
  onCreateRecord: () => void
  onBulkDelete: () => void | Promise<void>
  bulkDeleteDisabled: boolean
  isBulkDeleting: boolean
  deletingRecordId: string | null
  visibleRecords: TimeSessionRecord[]
  hasSelectableRecords: boolean
  allSelectableChecked: boolean
  selectedRecordIds: string[]
  onToggleSelectAllVisible: (checked: boolean) => void
  onToggleRecordSelection: (recordId: string, checked: boolean) => void
  onEditRecord: (record: TimeSessionRecord) => void
  onDeleteRecord: (record: TimeSessionRecord) => void | Promise<void>
}

export function TimeRecordsTable({
  filter,
  onRangeModeChange,
  onMonthChange,
  onRollingDaysChange,
  onStartDateChange,
  onEndDateChange,
  keyword,
  onKeywordChange,
  kindFilter,
  onKindFilterChange,
  sortBy,
  onSortByChange,
  sortOrder,
  onSortOrderChange,
  sourceSummary,
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
  const customRangeInvalid =
    filter.rangeMode === 'custom' &&
    Boolean(filter.startDate && filter.endDate && filter.startDate > filter.endDate)

  return (
    <Card className="rounded-lg border-border/70">
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <CardTitle className="text-lg">时间记录列表</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onCreateRecord} disabled={actionInProgress}>
              <Plus className="mr-2 size-4" />
              快速记一笔
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onBulkDelete}
              disabled={bulkDeleteDisabled || isBulkDeleting}
            >
              <Trash2 className="mr-2 size-4" />
              {isBulkDeleting ? '删除中...' : '批量删除所选'}
            </Button>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryValue label="当前筛选总时长" seconds={sourceSummary.totalEffectiveSeconds} />
          <SummaryValue label="电脑端" seconds={sourceSummary.desktopEffectiveSeconds} />
          <SummaryValue label="PWA 端" seconds={sourceSummary.pwaEffectiveSeconds} />
          <SummaryValue label="未知端" seconds={sourceSummary.unknownEffectiveSeconds} />
        </div>

        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/15 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs text-muted-foreground">统一时间范围</span>
            <RangeButton active={filter.rangeMode === 'month'} onClick={() => onRangeModeChange('month')}>
              月份
            </RangeButton>
            {([7, 30, 90] as const).map((days) => (
              <RangeButton
                key={days}
                active={filter.rangeMode === 'rolling' && filter.rollingDays === days}
                onClick={() => {
                  onRollingDaysChange(days)
                  onRangeModeChange('rolling')
                }}
              >
                最近 {days} 天
              </RangeButton>
            ))}
            <RangeButton active={filter.rangeMode === 'custom'} onClick={() => onRangeModeChange('custom')}>
              自定义
            </RangeButton>
            <RangeButton active={filter.rangeMode === 'all'} onClick={() => onRangeModeChange('all')}>
              全部历史
            </RangeButton>
          </div>

          {filter.rangeMode === 'month' ? (
            <Input
              aria-label="选择月份"
              className="max-w-xs"
              type="month"
              value={filter.month}
              onChange={(event) => onMonthChange(event.target.value)}
            />
          ) : null}
          {filter.rangeMode === 'custom' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                开始日期
                <Input
                  aria-label="开始日期"
                  type="date"
                  value={filter.startDate}
                  onChange={(event) => onStartDateChange(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                结束日期
                <Input
                  aria-label="结束日期"
                  type="date"
                  value={filter.endDate}
                  onChange={(event) => onEndDateChange(event.target.value)}
                />
              </label>
              {customRangeInvalid ? (
                <p className="text-xs text-destructive md:col-span-2">开始日期不能晚于结束日期。</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_180px_180px_140px]">
          <Input
            aria-label="搜索时间记录"
            placeholder="搜索标题"
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
          />
          <select
            aria-label="标签筛选"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={kindFilter}
            onChange={(event) => onKindFilterChange(event.target.value as 'all' | TimeRecordKind)}
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            aria-label="排序字段"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={sortBy}
            onChange={(event) => onSortByChange(event.target.value as TimeRecordFilterState['sortBy'])}
          >
            <option value="started_at">按开始时间</option>
            <option value="effective_seconds">按有效时长</option>
            <option value="title">按标题</option>
          </select>
          <select
            aria-label="排序方向"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={sortOrder}
            onChange={(event) => onSortOrderChange(event.target.value as TimeRecordFilterState['sortOrder'])}
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
            title={keyword || kindFilter !== 'all' ? '没有匹配的学习记录' : '当前范围没有学习记录'}
            description="范围、标签、关键词、顶部总时长和图表现在使用完全相同的统计口径。"
            action={keyword || kindFilter !== 'all' ? null : (
              <Button variant="outline" size="sm" onClick={onCreateRecord}>
                <Plus className="mr-2 size-4" />快速记一笔
              </Button>
            )}
          />
        ) : (
          <div className={`overflow-x-auto rounded-[24px] border border-border/70 transition-opacity ${isLoadingRecords ? 'opacity-60' : ''}`} aria-busy={isLoadingRecords}>
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted/80 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3"><input aria-label="全选当前记录" type="checkbox" checked={allSelectableChecked} onChange={(event) => onToggleSelectAllVisible(event.target.checked)} disabled={!hasSelectableRecords || isBulkDeleting} /></th>
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
                    <tr key={record.id} className="transition-colors hover:bg-muted/80">
                      <td className="px-4 py-4 align-top"><input aria-label={`选择记录 ${record.title}`} type="checkbox" checked={selectedRecordIds.includes(record.id)} disabled={isBulkDeleting || isDeleting} onChange={(event) => onToggleRecordSelection(record.id, event.target.checked)} /></td>
                      <td className="px-4 py-4">
                        <div className="min-w-[220px]">
                          <div className="font-medium text-foreground">{record.title}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>来源：{formatSessionSource(record)}</span>
                            {record.importedFrom ? (
                              <span className="rounded border border-amber-300/70 bg-amber-50 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                                历史导入 · {formatImportedFrom(record.importedFrom)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">{formatTimeRecordTagLabel(record)}</td>
                      <td className="px-4 py-4 whitespace-nowrap"><span className="rounded-md border border-border/70 bg-secondary/70 px-2 py-1 text-xs">{formatClientSource(record.clientSource)}</span></td>
                      <td className="px-4 py-4 whitespace-nowrap">{formatTableDateTime(record.startedAt)}</td>
                      <td className="px-4 py-4 whitespace-nowrap font-medium">{formatDuration(record.effectiveSeconds)}</td>
                      <td className="px-4 py-4">{formatCompletionMethod(record.completionMethod)}</td>
                      <td className="px-4 py-4"><div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => onEditRecord(record)} disabled={actionInProgress}><Pencil className="mr-2 size-4" />编辑</Button>
                        <Button size="sm" variant="outline" onClick={() => void onDeleteRecord(record)} disabled={actionInProgress}><Trash2 className="mr-2 size-4" />{isDeleting ? '删除中...' : '删除'}</Button>
                      </div></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex flex-col gap-3 border-t border-border/70 pt-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>共 {totalRecords} 条，当前显示 {visibleStart}-{visibleEnd}</span>
            <label className="flex items-center gap-2">每页
              <select aria-label="每页条数" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={pageSize} disabled={isLoadingRecords} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
                <option value={20}>20</option><option value={50}>50</option><option value={100}>100</option>
              </select>条
            </label>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} disabled={isLoadingRecords || actionInProgress} />
        </div>
      </CardContent>
    </Card>
  )
}

function SummaryValue({ label, seconds }: { label: string; seconds: number }) {
  return <div className="rounded-md border border-border/60 bg-background/80 px-3 py-2"><div className="text-[11px] text-muted-foreground">{label}</div><div className="mt-1 text-base font-semibold">{formatDuration(seconds)}</div></div>
}

function RangeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <Button type="button" size="sm" variant={active ? 'default' : 'outline'} className="h-8" onClick={onClick}>{children}</Button>
}

function formatImportedFrom(source: string) {
  if (source === 'time_records') return '旧时间记录'
  if (source === 'review_logs') return '旧复习日志'
  if (source === 'session_progress') return '旧会话进度'
  return source
}
