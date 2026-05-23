import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, Clock3, Plus, Sparkles, Timer, TrendingUp } from 'lucide-react'
import type { DashboardResponse } from '@/shared/api/contracts'
import { TimeRecordDialog } from '@/features/profile/components/TimeRecordDialog'
import { TimeRecordsBreakdownChart } from '@/features/profile/components/TimeRecordsBreakdownChart'
import { TimeRecordsTable } from '@/features/profile/components/TimeRecordsTable'
import { TimeRecordsTrendChart } from '@/features/profile/components/TimeRecordsTrendChart'
import { getTimeRecordChartColor } from '@/features/profile/model/time-record-chart'
import { useTimeRecordsDashboard } from '@/features/profile/hooks/useTimeRecordsDashboard'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Button } from '@/shared/components/ui/button'
import { formatDuration } from '@/entities/session/model'
import { getDashboardApi } from '@/shared/api/modules/dashboard'
import { cn } from '@/shared/lib/utils'

function formatReviewStage(reviewType: string, reviewNumber: number) {
  if (reviewType === '1h') return '首日 1 小时'
  if (reviewType === 'sleep') return '首日睡前'
  return `第 ${reviewNumber + 1} 次`
}

function formatLearningTooltip(item: DashboardResponse['today_learning_palaces'][number]) {
  return [
    `${item.palace_title || '未命名宫殿'}`,
    `总时长：${formatDuration(item.total_seconds)}`,
    `宫殿编辑：${formatDuration(item.palace_edit_seconds)}`,
    `练习：${formatDuration(item.practice_seconds)}`,
    `复习：${formatDuration(item.review_seconds)}`,
  ].join('\n')
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null)
  const loadDashboard = useCallback(async () => {
    const dashboard = await getDashboardApi()
    setData(dashboard)
  }, [])
  const timeRecordsDashboard = useTimeRecordsDashboard({
    onRecordsChanged: loadDashboard,
  })

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  if (!data) {
    return <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">正在加载仪表盘...</div>
  }

  const statCards: Array<{
    label: string
    value: string | number
    icon: typeof BookOpen
    color: string
    link?: string
    linkText?: string
    subtitle?: string
  }> = [
    {
      label: '今日到期',
      value: data.due_count,
      icon: BookOpen,
      color: data.due_count > 0 ? 'text-destructive' : 'text-emerald-500',
      link: '/review',
      linkText: '开始复习',
    },
    {
      label: '今日时长',
      value: formatDuration(data.today_total_review_duration_seconds),
      icon: TrendingUp,
      color: '',
    },
    {
      label: '本周时长',
      value: formatDuration(data.weekly_total_review_duration_seconds),
      icon: Clock3,
      color: '',
    },
    {
      label: '本周复习时长',
      value: formatDuration(data.weekly_formal_review_duration_seconds),
      icon: Timer,
      color: '',
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">仪表盘</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map(({ label, value, icon: Icon, color, link, linkText, subtitle }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${color}`}>{value}</div>
              {link && data.due_count > 0 ? (
                <Link to={link} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary">
                  {linkText}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              ) : subtitle ? (
                <p className="mt-2 text-xs text-muted-foreground">{subtitle}</p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">今日学习</CardTitle>
          </CardHeader>
          <CardContent>
            {data.today_learning_palaces.length > 0 ? (
              <div className="space-y-3">
                {data.today_learning_palaces.map((item) => {
                  const total = Math.max(1, item.total_seconds)
                  const segments = [
                    { key: 'palace_edit', seconds: item.palace_edit_seconds, color: getTimeRecordChartColor('palace_edit') },
                    { key: 'practice', seconds: item.practice_seconds, color: getTimeRecordChartColor('practice') },
                    { key: 'review', seconds: item.review_seconds, color: getTimeRecordChartColor('review') },
                  ].filter((segment) => segment.seconds > 0)
                  return (
                    <div key={item.palace_id} className="rounded-xl border border-border/60 bg-background/70 px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 truncate text-sm font-medium">{item.palace_title || '未命名宫殿'}</div>
                        <div className="shrink-0 text-xs text-muted-foreground">{formatDuration(item.total_seconds)}</div>
                      </div>
                      <div
                        className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-secondary/80"
                        title={formatLearningTooltip(item)}
                      >
                        {segments.map((segment) => (
                          <div
                            key={segment.key}
                            className="h-full"
                            style={{
                              width: `${(segment.seconds / total) * 100}%`,
                              backgroundColor: segment.color,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">今天还没有产生学习时长记录。</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{`新增章节数量：${data.today_new_palace_count}`}</CardTitle>
            <Link to="/palaces/new">
              <Button size="sm" variant="outline" className="h-8">
                <Plus className="h-3.5 w-3.5" />
                新建
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {data.today_new_palaces.some((subject) => subject.chapter_groups.length > 0 || subject.ungrouped_palaces.length > 0) ? (
              <div className="space-y-4">
                {data.today_new_palaces.map((subjectGroup, subjectIndex) => {
                  const hasAny = subjectGroup.chapter_groups.length > 0 || subjectGroup.ungrouped_palaces.length > 0
                  if (!hasAny) return null
                  const showSubjectTitle = data.today_new_palaces.filter((item) => item.subject).length > 1
                  return (
                    <div key={`${subjectGroup.subject?.id ?? 'ungrouped'}-${subjectIndex}`} className="space-y-2">
                      {showSubjectTitle && subjectGroup.subject ? (
                        <div className="text-xs font-medium text-muted-foreground">{subjectGroup.subject.name}</div>
                      ) : null}
                      {subjectGroup.chapter_groups.map((group) => (
                        <div key={group.source_chapter?.id ?? `group-${subjectIndex}`} className="space-y-1">
                          <div className="text-sm font-semibold">{group.source_chapter?.name ?? '未关联章节'}</div>
                          <div className="space-y-1.5 pl-4">
                            {group.palaces.map((palace) => (
                              <div key={palace.id} className="space-y-1">
                                {palace.resolved_parent_chapter && palace.primary_chapter ? (
                                  <div className="text-xs font-medium text-muted-foreground">{palace.primary_chapter.name}</div>
                                ) : null}
                                <Link
                                  to={`/palaces/${palace.id}/edit`}
                                  className={cn(
                                    'block truncate rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-secondary active:scale-[0.98]',
                                    (palace.resolved_parent_chapter || palace.primary_chapter) && 'ml-3',
                                  )}
                                >
                                  {palace.title || '未命名宫殿'}
                                </Link>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {subjectGroup.ungrouped_palaces.length > 0 ? (
                        <div className="space-y-1">
                          <div className="text-sm font-semibold text-muted-foreground">未关联章节</div>
                          <div className="space-y-1.5 pl-4">
                            {subjectGroup.ungrouped_palaces.map((palace) => (
                              <Link
                                key={palace.id}
                                to={`/palaces/${palace.id}/edit`}
                                className="block truncate rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-secondary active:scale-[0.98]"
                              >
                                {palace.title || '未命名宫殿'}
                              </Link>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                今天还没有新增记忆宫殿。
                <div className="mt-3">
                  <Link to="/palaces/new">
                    <Button variant="outline" size="sm">
                      <Sparkles className="mr-2 h-4 w-4" />
                      创建一个
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <TimeRecordsTrendChart trend={timeRecordsDashboard.trend} />
          <TimeRecordsBreakdownChart
            breakdown={timeRecordsDashboard.breakdown}
          />
        </div>

        <TimeRecordsTable
          thresholdInput={timeRecordsDashboard.thresholdInput}
          onThresholdInputChange={timeRecordsDashboard.setThresholdInput}
          onThresholdBlur={() => void timeRecordsDashboard.applyThreshold()}
          showBelowThreshold={timeRecordsDashboard.showBelowThreshold}
          onShowBelowThresholdChange={timeRecordsDashboard.setShowBelowThreshold}
          keyword={timeRecordsDashboard.keyword}
          onKeywordChange={timeRecordsDashboard.setKeyword}
          kindFilter={timeRecordsDashboard.kindFilter}
          onKindFilterChange={timeRecordsDashboard.setKindFilter}
          showDeleted={timeRecordsDashboard.showDeleted}
          onShowDeletedChange={timeRecordsDashboard.setShowDeleted}
          onCreateRecord={timeRecordsDashboard.openCreateDialog}
          onBulkDelete={() => void timeRecordsDashboard.handleBulkDelete()}
          bulkDeleteDisabled={!timeRecordsDashboard.hasSelectedRecords}
          isBulkDeleting={timeRecordsDashboard.isBulkDeleting}
          deletingRecordId={timeRecordsDashboard.deletingRecordId}
          restoringRecordId={timeRecordsDashboard.restoringRecordId}
          visibleRecords={timeRecordsDashboard.visibleRecords}
          hasSelectableRecords={timeRecordsDashboard.hasSelectableRecords}
          allSelectableChecked={timeRecordsDashboard.allSelectableChecked}
          selectedRecordIds={timeRecordsDashboard.selectedRecordIds}
          onToggleSelectAllVisible={
            timeRecordsDashboard.toggleSelectAllVisible
          }
          onToggleRecordSelection={timeRecordsDashboard.toggleRecordSelection}
          onEditRecord={timeRecordsDashboard.openEditDialog}
          onDeleteRecord={timeRecordsDashboard.handleDeleteRecord}
          onRestoreRecord={timeRecordsDashboard.handleRestoreRecord}
        />
      </div>

      <TimeRecordDialog
        open={timeRecordsDashboard.dialogOpen}
        mode={timeRecordsDashboard.dialogMode}
        form={timeRecordsDashboard.formState}
        error={timeRecordsDashboard.formError}
        isSubmitting={timeRecordsDashboard.isSubmittingRecord}
        onOpenChange={timeRecordsDashboard.onDialogOpenChange}
        onChange={timeRecordsDashboard.onFormChange}
        onSubmit={(event) => void timeRecordsDashboard.handleSubmitRecord(event)}
      />
    </div>
  )
}
