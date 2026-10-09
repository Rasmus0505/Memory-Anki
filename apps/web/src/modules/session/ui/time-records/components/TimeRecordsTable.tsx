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
import { displayTimeRecordTitle, formatTableDateTime } from '@/modules/session/ui/time-records/model/time-record-form'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Pagination } from '@/shared/components/ui/pagination'
import { EmptyState } from '@/shared/components/state-placeholders'
import { cn } from '@/shared/lib/utils'

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
  className?: string
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
  className,
}: TimeRecordsTableProps) {
  const actionInProgress = isBulkDeleting || deletingRecordId !== null
  const visibleStart = totalRecords === 0 ? 0 : (page - 1) * pageSize + 1
  const visibleEnd = Math.min(page * pageSize, totalRecords)
  const customRangeInvalid =
    filter.rangeMode === 'custom' &&
    Boolean(filter.startDate && filter.endDate && filter.startDate > filter.endDate)

  return (
    <Card className={cn('flex min-h-0 flex-col rounded-lg border-border/70', className)}>
      <CardHeader className="shrink-0 gap-2 space-y-0 p-3 pb-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <CardTitle className="text-base">时间记录列表</CardTitle>
          <div className="order-last flex w-full min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto md:order-none md:w-auto md:flex-1 md:flex-wrap md:overflow-visible">
            <SummaryValue label="当前筛选总时长" seconds={sourceSummary.totalEffectiveSeconds} />
            <SummaryValue label="电脑端" seconds={sourceSummary.desktopEffectiveSeconds} />
            <SummaryValue label="PWA 端" seconds={sourceSummary.pwaEffectiveSeconds} />
            <SummaryValue label="未知端" seconds={sourceSummary.unknownEffectiveSeconds} />
          </div>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <Button variant="outline" size="sm" className="h-8" onClick={onCreateRecord} disabled={actionInProgress}>
              <Plus className="mr-1.5 size-4" />
              快速记一笔
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={onBulkDelete}
              disabled={bulkDeleteDisabled || isBulkDeleting}
            >
              <Trash2 className="size-4 sm:mr-1.5" />
              <span className="sr-only sm:not-sr-only">{isBulkDeleting ? '删除中...' : '批量删除所选'}</span>
            </Button>
          </div>
        </div>

        <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5 lg:flex-wrap lg:overflow-visible">
          <span className="mr-1 shrink-0 text-xs text-muted-foreground">统一时间范围</span>
          <RangeButton active={filter.rangeMode === 'today'} onClick={() => onRangeModeChange('today')}>
            今天
          </RangeButton>
          <RangeButton active={filter.rangeMode === 'yesterday'} onClick={() => onRangeModeChange('yesterday')}>
            昨天
          </RangeButton>
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
          {filter.rangeMode === 'month' ? (
            <Input
              aria-label="选择月份"
              className="h-8 w-40 shrink-0"
              type="month"
              value={filter.month}
              onChange={(event) => onMonthChange(event.target.value)}
            />
          ) : null}
          {filter.rangeMode === 'custom' ? (
            <>
              <Input
                aria-label="开始日期"
                className="h-8 w-36 shrink-0"
                type="date"
                value={filter.startDate}
                onChange={(event) => onStartDateChange(event.target.value)}
              />
              <span className="shrink-0 text-xs text-muted-foreground">至</span>
              <Input
                aria-label="结束日期"
                className="h-8 w-36 shrink-0"
                type="date"
                value={filter.endDate}
                onChange={(event) => onEndDateChange(event.target.value)}
              />
            </>
          ) : null}
        </div>
        {customRangeInvalid ? (
          <p className="text-xs text-destructive">开始日期不能晚于结束日期。</p>
        ) : null}

        <div className="grid grid-cols-3 gap-1.5 md:grid-cols-[minmax(0,1fr)_150px_150px_110px]">
          <Input
            aria-label="搜索时间记录"
            placeholder="搜索标题"
            className="col-span-3 h-8 md:col-span-1"
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
          />
          <select
            aria-label="标签筛选"
            className={SELECT_CLASS}
            value={kindFilter}
            onChange={(event) => onKindFilterChange(event.target.value as 'all' | TimeRecordKind)}
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            aria-label="排序字段"
            className={SELECT_CLASS}
            value={sortBy}
            onChange={(event) => onSortByChange(event.target.value as TimeRecordFilterState['sortBy'])}
          >
            <option value="started_at">按开始时间</option>
            <option value="effective_seconds">按有效时长</option>
            <option value="title">按标题</option>
          </select>
          <select
            aria-label="排序方向"
            className={SELECT_CLASS}
            value={sortOrder}
            onChange={(event) => onSortOrderChange(event.target.value as TimeRecordFilterState['sortOrder'])}
          >
            <option value="desc">降序</option>
            <option value="asc">升序</option>
          </select>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-3 pt-0">
        {recordsError ? (
          <div className="mb-2 shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {recordsError}
          </div>
        ) : null}
        {visibleRecords.length === 0 && !isLoadingRecords ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
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
          </div>
        ) : (
          <div className={`min-h-0 flex-1 overflow-auto rounded-2xl border border-border/70 transition-opacity ${isLoadingRecords ? 'opacity-60' : ''}`} aria-busy={isLoadingRecords}>
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="sticky top-0 z-10 whitespace-nowrap bg-muted text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2"><input aria-label="全选当前记录" type="checkbox" checked={allSelectableChecked} onChange={(event) => onToggleSelectAllVisible(event.target.checked)} disabled={!hasSelectableRecords || isBulkDeleting} /></th>
                  <th className="px-3 py-2">标题</th>
                  <th className="px-3 py-2">标签</th>
                  <th className="px-3 py-2">端来源</th>
                  <th className="px-3 py-2">开始时间</th>
                  <th className="px-3 py-2">有效时长</th>
                  <th className="px-3 py-2">完成方式</th>
                  <th className="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/80 bg-background">
                {visibleRecords.map((record) => {
                  const isDeleting = deletingRecordId === record.id
                  return (
                    <tr key={record.id} className="transition-colors hover:bg-muted/80">
                      <td className="px-3 py-2 align-top"><input aria-label={`选择记录 ${record.title}`} type="checkbox" checked={selectedRecordIds.includes(record.id)} disabled={isBulkDeleting || isDeleting} onChange={(event) => onToggleRecordSelection(record.id, event.target.checked)} /></td>
                      <td className="px-3 py-2">
                        <div className="min-w-[180px] max-w-[320px]">
                          <div className="font-medium text-foreground">{displayTimeRecordTitle(record)}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>来源：{formatSessionSource(record)}</span>
                            {record.importedFrom ? (
                              <span className="rounded border border-amber-300/70 bg-amber-50 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                                历史导入 · {formatImportedFrom(record.importedFrom)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatTimeRecordTagLabel(record)}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className="rounded-md border border-border/70 bg-secondary/70 px-2 py-0.5 text-xs">{formatClientSource(record.clientSource)}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatTableDateTime(record.startedAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium">{formatDuration(record.effectiveSeconds)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{record.status === 'active' ? '进行中' : formatCompletionMethod(record.completionMethod)}</td>
                      <td className="px-3 py-2"><div className="flex gap-1.5 whitespace-nowrap">
                        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => onEditRecord(record)} disabled={actionInProgress}><Pencil className="mr-1 size-3.5" />编辑</Button>
                        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => void onDeleteRecord(record)} disabled={actionInProgress}><Trash2 className="mr-1 size-3.5" />{isDeleting ? '删除中...' : '删除'}</Button>
                      </div></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-2 flex shrink-0 items-center justify-between gap-2 border-t border-border/70 pt-2">
          <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
            <span className="truncate">共 {totalRecords} 条<span className="hidden sm:inline">，当前显示 {visibleStart}-{visibleEnd}</span></span>
            <label className="flex items-center gap-1.5">每页
              <select aria-label="每页条数" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={pageSize} disabled={isLoadingRecords} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
                <option value={20}>20</option><option value={50}>50</option><option value={100}>100</option>
              </select>条
            </label>
          </div>
          <Pagination className="shrink-0 flex-nowrap" page={page} totalPages={totalPages} onPageChange={onPageChange} disabled={isLoadingRecords || actionInProgress} />
        </div>
      </CardContent>
    </Card>
  )
}

const SELECT_CLASS = 'flex h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm'

function SummaryValue({ label, seconds }: { label: string; seconds: number }) {
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap rounded-full border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">
      {label}
      <span className="text-xs font-semibold text-foreground tabular-nums">{formatDuration(seconds)}</span>
    </span>
  )
}

function RangeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <Button type="button" size="sm" variant={active ? 'default' : 'outline'} className="h-7 shrink-0 px-2.5 text-xs" onClick={onClick}>{children}</Button>
}

function formatImportedFrom(source: string) {
  if (source === 'time_records') return '旧时间记录'
  if (source === 'review_logs') return '旧复习日志'
  if (source === 'session_progress') return '旧会话进度'
  return source
}
